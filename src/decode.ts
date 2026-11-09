import exifr from 'exifr';
import type { ExifInfo, ImageSource } from './types';

export const RAW_EXT = [
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl',
  'dng', 'pef', 'srw', '3fr', 'fff', 'iiq', 'x3f', 'erf', 'mos', 'mrw', 'kdc', 'dcr',
];
export const ACCEPT = [
  'image/*', '.heic', '.heif', '.avif', '.tif', '.tiff', '.jxl',
  ...RAW_EXT.map((e) => '.' + e),
].join(',');

export interface Decoded {
  source: ImageSource;
  width: number;
  height: number;
  exif: ExifInfo;
  note?: string;
}

function ext(name: string) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

// ---------- Exif ----------

const fmtNum = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d);

export function formatShutter(t: number): string {
  if (!t || !isFinite(t)) return '';
  if (t >= 1) return `${fmtNum(t, 1)}s`;
  const inv = 1 / t;
  return `1/${inv >= 10 ? Math.round(inv) : fmtNum(inv, 1)}s`;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatDate(d: unknown): string {
  if (d instanceof Date && !isNaN(d.getTime())) {
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (typeof d === 'string') {
    const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})/.exec(d);
    if (m) return `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}`;
  }
  return '';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toExifInfo(raw: any): ExifInfo {
  raw = raw || {};
  const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\0/g, '').trim() : '');
  const num = (v: unknown) => (typeof v === 'number' ? v : Array.isArray(v) ? Number(v[0]) : Number(v));
  const focal = num(raw.FocalLength);
  const focal35 = num(raw.FocalLengthIn35mmFormat);
  const fn = num(raw.FNumber ?? raw.ApertureValue);
  const iso = num(raw.ISO ?? raw.ISOSpeedRatings ?? raw.PhotographicSensitivity);
  let lens = str(raw.LensModel) || str(raw.Lens) || str(raw.LensInfo && typeof raw.LensInfo === 'string' ? raw.LensInfo : '');
  if (/^-+$|^unknown/i.test(lens)) lens = '';
  return {
    make: str(raw.Make),
    model: str(raw.Model),
    lens,
    focal: focal > 0 ? `${fmtNum(focal, 0)}mm` : focal35 > 0 ? `${fmtNum(focal35, 0)}mm` : '',
    aperture: fn > 0 ? `f/${fmtNum(fn, 1)}` : '',
    shutter: formatShutter(num(raw.ExposureTime)),
    iso: iso > 0 ? `ISO${Math.round(iso)}` : '',
    date: formatDate(raw.DateTimeOriginal ?? raw.CreateDate ?? raw.DateTime ?? raw.ModifyDate),
    artist: str(raw.Artist),
  };
}

async function readExif(input: Blob | ArrayBuffer): Promise<{ info: ExifInfo; orientation: number }> {
  try {
    const raw = await exifr.parse(input as any, {
      tiff: true,
      exif: true,
      ifd0: true,
      gps: false,
      xmp: true,
      makerNote: false,
      translateValues: false,
      reviveValues: true,
      mergeOutput: true,
    } as any);
    return { info: toExifInfo(raw), orientation: Number(raw?.Orientation) || 1 };
  } catch {
    return { info: toExifInfo(null), orientation: 1 };
  }
}

// ---------- 画像デコード ----------

async function bitmapFromBlob(blob: Blob, orientation: 'from-image' | 'none' = 'from-image'): Promise<ImageSource> {
  try {
    return await createImageBitmap(blob, { imageOrientation: orientation });
  } catch {
    // createImageBitmap 非対応形式は <img> 経由で試す
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

export function sourceSize(s: ImageSource): [number, number] {
  if (s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
  return [s.width, s.height];
}

/** EXIF Orientation (1-8) を手動で適用 */
function applyOrientation(src: ImageSource, o: number): ImageSource {
  if (o <= 1 || o > 8) return src;
  const [w, h] = sourceSize(src);
  const swap = o >= 5;
  const c = document.createElement('canvas');
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d')!;
  switch (o) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
  }
  ctx.drawImage(src, 0, 0);
  return c;
}

/** RAWファイル内に埋め込まれたJPEGプレビューを探す（最大解像度のもの順） */
export function findEmbeddedJpegs(buf: Uint8Array): { start: number; w: number; h: number }[] {
  const out: { start: number; w: number; h: number }[] = [];
  const n = buf.length;
  const r16 = (p: number) => (buf[p] << 8) | buf[p + 1];
  for (let i = 0; i < n - 4; i++) {
    if (buf[i] !== 0xff || buf[i + 1] !== 0xd8 || buf[i + 2] !== 0xff) continue;
    let p = i + 2;
    for (let guard = 0; guard < 64 && p + 9 < n; guard++) {
      if (buf[p] !== 0xff) break;
      const m = buf[p + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
        const h = r16(p + 5), w = r16(p + 7);
        if (w > 0 && h > 0) out.push({ start: i, w, h });
        break;
      }
      if ((m >= 0xc3 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) || m === 0xda) break;
      const len = r16(p + 2);
      if (len < 2) break;
      p += 2 + len;
    }
  }
  return out.sort((a, b) => b.w * b.h - a.w * a.h);
}

async function decodeRaw(file: File): Promise<{ src: ImageSource; jpeg?: Blob } | null> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const cands = findEmbeddedJpegs(buf).filter((c) => c.w * c.h >= 160 * 120 && c.w <= 20000 && c.h <= 20000);
  for (const c of cands.slice(0, 8)) {
    const blob = new Blob([buf.subarray(c.start)], { type: 'image/jpeg' });
    try {
      const src = await createImageBitmap(blob, { imageOrientation: 'none' });
      return { src, jpeg: blob };
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

async function decodeTiff(file: File): Promise<ImageSource> {
  const UTIF = (await import('utif')).default as any;
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  // 最大のページを使う
  let best = ifds[0];
  for (const ifd of ifds) {
    const w = ifd.t256?.[0] ?? 0, h = ifd.t257?.[0] ?? 0;
    if (w * h > (best.t256?.[0] ?? 0) * (best.t257?.[0] ?? 0)) best = ifd;
  }
  UTIF.decodeImage(buf, best);
  const rgba: Uint8Array = UTIF.toRGBA8(best);
  const c = document.createElement('canvas');
  c.width = best.width;
  c.height = best.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), best.width, best.height), 0, 0);
  return c;
}

/**
 * HEIC/HEIF の画像本体は HEVC（特許のある動画方式）で圧縮されているため、
 * アプリ内にデコーダーを同梱せず、OS・ブラウザに標準搭載されたデコーダーだけを使う。
 *  - Safari（iPhone / Mac）: ブラウザがそのまま表示できる
 *  - Androidアプリ版: Android標準の ImageDecoder で JPEG に変換（HeicConverter プラグイン）
 *  - それ以外のブラウザ: 対応していない旨を表示
 */
async function decodeHeic(file: File): Promise<ImageSource> {
  try {
    return await bitmapFromBlob(file, 'from-image');
  } catch {
    /* ブラウザ非対応 → 次へ */
  }
  const { heicToJpegNative } = await import('./native');
  let jpeg: Blob | null = null;
  try {
    jpeg = await heicToJpegNative(file);
  } catch (e) {
    console.error(e);
    throw new Error('この端末ではHEICを読み込めませんでした。JPEGに変換してから読み込んでください');
  }
  if (jpeg) return bitmapFromBlob(jpeg, 'from-image');
  throw new Error(
    'このブラウザはHEICに対応していません。iPhone/MacのSafari、Androidアプリ版を使うか、JPEGに変換してから読み込んでください',
  );
}

/** WebP の RIFF コンテナから EXIF チャンク（TIFF形式）を取り出す */
async function webpExif(file: File): Promise<ArrayBuffer | null> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const tag = (p: number) => String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
  if (buf.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  let p = 12;
  while (p + 8 <= buf.length) {
    const size = (buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16) | (buf[p + 7] << 24)) >>> 0;
    if (tag(p) === 'EXIF') {
      let start = p + 8;
      // "Exif\0\0" が先頭に付いている場合がある
      if (buf[start] === 0x45 && buf[start + 1] === 0x78 && buf[start + 2] === 0x69 && buf[start + 3] === 0x66) start += 6;
      return buf.slice(start, p + 8 + size).buffer;
    }
    p += 8 + size + (size & 1);
  }
  return null;
}

export async function decodeFile(file: File): Promise<Decoded> {
  const e = ext(file.name);
  let { info, orientation } = await readExif(file);
  if (!info.make && (e === 'webp' || file.type === 'image/webp')) {
    const tiff = await webpExif(file);
    if (tiff) ({ info, orientation } = await readExif(tiff));
  }
  let src: ImageSource;
  let note: string | undefined;
  let exif = info;

  if (RAW_EXT.includes(e)) {
    const r = await decodeRaw(file);
    if (!r) throw new Error('RAWファイル内にプレビュー画像が見つかりませんでした');
    note = 'RAW内蔵プレビューを使用';
    src = r.src;
    // 埋め込みJPEG側のExifも参照（CR3/RAFなどで本体の解析に失敗した場合の補完）
    let o = orientation;
    if (r.jpeg) {
      const j = await readExif(r.jpeg.slice(0, 256 * 1024));
      if (!exif.make && j.info.make) exif = { ...j.info };
      if (o <= 1 && j.orientation > 1) o = j.orientation;
    }
    const rotated = applyOrientation(src, o);
    if (rotated !== src && src instanceof ImageBitmap) src.close();
    src = rotated;
  } else if (e === 'heic' || e === 'heif' || /hei[cf]/.test(file.type)) {
    src = await decodeHeic(file);
  } else if (e === 'tif' || e === 'tiff' || file.type === 'image/tiff') {
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (!src.width || !src.height) throw new Error('empty');
    } catch {
      src = applyOrientation(await decodeTiff(file), orientation);
    }
  } else {
    src = await bitmapFromBlob(file, 'from-image');
  }
  const [width, height] = sourceSize(src);
  if (!width || !height) throw new Error('画像を読み込めませんでした');
  return { source: src, width, height, exif, note };
}

export async function makeThumb(src: ImageSource, w: number, h: number, size = 240): Promise<string> {
  const k = Math.min(1, size / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8));
  return blob ? URL.createObjectURL(blob) : c.toDataURL();
}
