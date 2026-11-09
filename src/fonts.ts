// 利用者が読み込んだフォント（TTF / OTF / WOFF / WOFF2）の管理。
// フォントファイルはこの端末の IndexedDB にだけ保存し、外部には送信しない。

export const BUILTIN_FONTS = ['Inter', 'Montserrat', 'Playfair Display', 'Cormorant Garamond', 'Oswald', 'JetBrains Mono', 'Noto Sans JP'];

const DB = 'exif-frame-fonts';
const STORE = 'fonts';
const MAX_BYTES = 40 * 1024 * 1024;
const EXTS = ['ttf', 'otf', 'woff', 'woff2', 'ttc'];

interface StoredFont {
  family: string;
  data: ArrayBuffer;
  file: string;
  addedAt: number;
}

const loaded = new Map<string, FontFace>();

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'family' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

async function req<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error ?? r.error);
    t.onabort = () => reject(t.error ?? r.error);
  });
}

/** キャンバスのフォント指定を壊す文字を取り除いたフォント名 */
export function cleanFamily(name: string) {
  return name.replace(/["'\\;{}<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** 読み込み済みのフォント名（読み込んだ順） */
export function userFonts(): string[] {
  return [...loaded.keys()];
}

/** 描画に使えるフォントか（内蔵フォント、または読み込み済みのフォント） */
export function isFontAvailable(family: string) {
  return !!family && (BUILTIN_FONTS.includes(family) || loaded.has(family));
}

async function register(family: string, data: ArrayBuffer) {
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  loaded.set(family, face);
}

/** 起動時：保存してあるフォントを登録 */
export async function loadUserFonts(): Promise<string[]> {
  let list: StoredFont[] = [];
  try {
    list = await req<StoredFont[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFont[]>);
  } catch {
    return [];
  }
  list.sort((a, b) => a.addedAt - b.addedAt);
  for (const f of list) {
    try {
      await register(f.family, f.data);
    } catch (e) {
      console.warn('フォントを登録できませんでした', f.family, e);
    }
  }
  return userFonts();
}

/** フォントファイルを読み込んで保存。登録したフォント名を返す */
export async function importFont(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!EXTS.includes(ext) && !/font/.test(file.type)) throw new Error('TTF / OTF / WOFF / WOFF2 のフォントファイルを選んでください');
  if (file.size > MAX_BYTES) throw new Error('ファイルが大きすぎます（40MBまで）');
  const data = await file.arrayBuffer();
  let base = cleanFamily(file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')) || 'My Font';
  // 内蔵フォントや既存のフォントと名前が重ならないように
  if (BUILTIN_FONTS.some((b) => b.toLowerCase() === base.toLowerCase())) base += ' (読込)';
  let family = base;
  for (let i = 2; loaded.has(family); i++) family = `${base} ${i}`;
  try {
    await register(family, data.slice(0));
  } catch {
    throw new Error('フォントとして読み込めませんでした（壊れているか、対応していない形式です）');
  }
  try {
    await req('readwrite', (s) => s.put({ family, data, file: file.name, addedAt: Date.now() } satisfies StoredFont));
  } catch {
    /* 保存できなくてもこのセッション中は使える */
  }
  return family;
}

export async function removeFont(family: string) {
  const face = loaded.get(family);
  if (face) document.fonts.delete(face);
  loaded.delete(family);
  try {
    await req('readwrite', (s) => s.delete(family));
  } catch {
    /* noop */
  }
}
