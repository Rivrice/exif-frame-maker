// メーカーロゴ画像の管理。
// 1) ユーザーがアプリ内でアップロードした画像（IndexedDBに保存）
// 2) public/logos/<key>.svg / .png（デプロイする人が配置した画像）
// の順で探し、どちらも無ければワードマーク（文字）で描画します。

import type { LogoAsset } from './types';

const DB = 'exif-frame-logos';
const STORE = 'logos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const cache = new Map<string, LogoAsset | null>();
const origin = new Map<string, 'user' | 'bundled'>();

async function blobToAsset(blob: Blob): Promise<LogoAsset> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  let w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) {
    // width/height 指定の無いSVG
    const text = await blob.text();
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    const ar = vb ? Number(vb[1]) / Number(vb[2]) : 3;
    w = 1200;
    h = Math.round(1200 / ar);
  }
  // SVGはラスタライズして高解像度で保持
  const scale = blob.type.includes('svg') ? Math.max(1, 1600 / w) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return { image: c, width: c.width, height: c.height };
}

export async function getLogo(key: string): Promise<LogoAsset | null> {
  if (!key || key === 'other') return null;
  if (cache.has(key)) return cache.get(key)!;
  let asset: LogoAsset | null = null;
  try {
    const blob = await tx<Blob | undefined>('readonly', (s) => s.get(key) as IDBRequest<Blob | undefined>);
    if (blob) {
      asset = await blobToAsset(blob);
      origin.set(key, 'user');
    }
  } catch {
    /* IndexedDB 非対応 */
  }
  if (!asset) {
    for (const ext of ['svg', 'png', 'webp']) {
      try {
        const res = await fetch(`./logos/${key}.${ext}`);
        const type = res.headers.get('content-type') || '';
        if (res.ok && type.startsWith('image/')) {
          asset = await blobToAsset(await res.blob());
          origin.set(key, 'bundled');
          break;
        }
      } catch {
        /* 無ければ次 */
      }
    }
  }
  cache.set(key, asset);
  return asset;
}

export function cachedLogo(key: string): LogoAsset | null {
  return cache.get(key) ?? null;
}

export function logoOrigin(key: string): 'user' | 'bundled' | null {
  return cache.get(key) ? origin.get(key) ?? null : null;
}

export async function setUserLogo(key: string, blob: Blob) {
  const asset = await blobToAsset(blob);
  try {
    await tx('readwrite', (s) => s.put(blob, key));
  } catch {
    /* 保存できなくてもこのセッション中は使う */
  }
  cache.set(key, asset);
  origin.set(key, 'user');
}

export async function removeUserLogo(key: string) {
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    /* noop */
  }
  cache.delete(key);
  origin.delete(key);
  await getLogo(key);
}
