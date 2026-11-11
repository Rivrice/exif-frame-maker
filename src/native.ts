// Androidアプリ（Capacitor）として動いているときの保存・共有処理。
// ブラウザ版ではこのモジュールの関数は使われません。
import { Capacitor, registerPlugin } from '@capacitor/core';

export const IS_NATIVE = Capacitor.isNativePlatform();

/** Androidの「戻る」ボタン。handler が true を返したら処理済み、false ならアプリを終了 */
export async function onBackButton(handler: () => boolean) {
  if (!IS_NATIVE) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    if (!handler()) void App.exitApp();
  });
}

interface HeicConverterPlugin {
  toJpeg(opts: { data: string; maxPixels: number }): Promise<{ data: string; width: number; height: number }>;
}
// android/app/src/main/java/.../HeicConverterPlugin.java（Android標準のデコーダーを使用）
const HeicConverter = registerPlugin<HeicConverterPlugin>('HeicConverter');

/** Androidアプリ版のみ: OS標準デコーダーでHEICをJPEGに変換。ブラウザでは null */
export async function heicToJpegNative(file: Blob): Promise<Blob | null> {
  if (!IS_NATIVE || Capacitor.getPlatform() !== 'android') return null;
  const res = await HeicConverter.toJpeg({ data: await toBase64(file), maxPixels: 16_000_000 });
  const bin = atob(res.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 共有シートを開く（Googleフォトやギャラリーへの保存、SNSへの送信など） */
export async function nativeShare(files: File[]) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const uris: string[] = [];
  for (const f of files) {
    const res = await Filesystem.writeFile({
      path: `share/${f.name}`,
      data: await toBase64(f),
      directory: Directory.Cache,
      recursive: true,
    });
    uris.push(res.uri);
  }
  await Share.share({ files: uris, dialogTitle: '画像を保存・共有' });
}

/** 端末の Documents/ExifFrameMaker フォルダに保存 */
export async function nativeSave(files: File[]): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    const perm = await Filesystem.checkPermissions();
    if (perm.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch {
    /* Android 10 以降は不要 */
  }
  for (const f of files) {
    await Filesystem.writeFile({
      path: `ExifFrameMaker/${f.name}`,
      data: await toBase64(f),
      directory: Directory.Documents,
      recursive: true,
    });
  }
  return 'Documents/ExifFrameMaker';
}

interface IncomingImagePlugin {
  take(): Promise<{ files: { data: string; name: string; mime: string }[] }>;
  addListener(event: 'received', cb: () => void): Promise<{ remove: () => Promise<void> }>;
}
// android/app/src/main/java/.../IncomingImagePlugin.java
const IncomingImage = registerPlugin<IncomingImagePlugin>('IncomingImage');

/**
 * Androidアプリ版のみ: ほかのアプリ（Photo Tile Maker・ギャラリーなど）から共有された画像を受け取る。
 * 起動時に渡された画像と、開いている間に新しく届いた画像の両方を onFiles に渡す。
 */
export async function listenSharedImages(onFiles: (files: File[]) => void) {
  if (!IS_NATIVE || Capacitor.getPlatform() !== 'android') return;
  const take = async () => {
    try {
      const { files } = await IncomingImage.take();
      if (!files?.length) return;
      onFiles(
        files.map((f) => {
          const bin = atob(f.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new File([bytes], f.name || 'shared.jpg', { type: f.mime || 'image/jpeg' });
        }),
      );
    } catch (e) {
      console.error(e);
    }
  };
  await IncomingImage.addListener('received', () => void take());
  await take();
}
