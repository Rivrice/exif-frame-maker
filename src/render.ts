import type { PhotoItem, Settings } from './types';
import { buildInfo, canvas, padToAspect, parseAspect, type RC } from './draw';
import { getLayout } from './layouts';
import { getLogo } from './logos';

const FAMILIES = ['Inter', 'Montserrat', 'Playfair Display', 'JetBrains Mono', 'Cormorant Garamond', 'Oswald'];
const WEIGHTS = [400, 500, 600, 700, 800];

export async function preloadFonts() {
  const jobs: Promise<unknown>[] = [];
  for (const f of FAMILIES) {
    for (const w of WEIGHTS) {
      jobs.push(document.fonts.load(`${w} 32px "${f}"`, 'Aa0'));
      jobs.push(document.fonts.load(`italic ${w} 32px "${f}"`, 'Aa0'));
    }
  }
  await Promise.allSettled(jobs);
}

const NON_LATIN = /[^\u0000-ɏ -⁯·α]/;
const loadedText = new Set<string>();

/** 日本語など、まだ読み込んでいない文字のフォントを読み込む */
async function ensureGlyphs(texts: string[]) {
  const t = texts.join('');
  if (!NON_LATIN.test(t)) return;
  const chars = [...new Set(t)].filter((c) => !loadedText.has(c)).join('');
  if (!chars) return;
  await Promise.allSettled([400, 500, 700].map((w) => document.fonts.load(`${w} 32px "Noto Sans JP"`, chars)));
  for (const c of chars) loadedText.add(c);
}

export const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MAX_AREA = IS_IOS ? 16_000_000 : 120_000_000;

async function context(p: PhotoItem, s: Settings): Promise<RC> {
  const info = buildInfo(p, s);
  await ensureGlyphs([info.model, info.lens, info.date, info.artist, ...info.params, info.maker?.display ?? '']);
  const logo = s.show.logo && info.maker ? await getLogo(info.maker.key) : null;
  return { info, s, logo, font: getLayout(s.layoutId).font };
}

/** k = 写真の描画倍率 */
function renderWith(p: PhotoItem, s: Settings, rc: RC, k: number): HTMLCanvasElement {
  const layout = getLayout(s.layoutId);
  const iw = Math.max(1, Math.round(p.width * k));
  const ih = Math.max(1, Math.round(p.height * k));
  let out = layout.render(p.source, iw, ih, rc);
  const aspect = parseAspect(s.aspect);
  if (aspect && !layout.canvasAspect) out = padToAspect(out, aspect, s.colors.bg);
  return out;
}

/** 写真の長辺を targetLong px にして描画（プレビュー用） */
export async function renderPreview(p: PhotoItem, s: Settings, targetLong: number) {
  const rc = await context(p, s);
  const k = Math.min(1, targetLong / Math.max(p.width, p.height));
  return renderWith(p, s, rc, k);
}

/** 出力サイズ（長辺 maxEdge）を指定して描画 */
export async function renderOutput(p: PhotoItem, s: Settings, maxEdge = s.export.maxEdge) {
  const rc = await context(p, s);
  // 小さく描いて出力の大きさを見積もる
  const probeK = 400 / Math.max(p.width, p.height);
  const probe = renderWith(p, s, rc, probeK);
  const longAtFull = Math.max(probe.width, probe.height) / probeK;
  const areaAtFull = (probe.width * probe.height) / (probeK * probeK);
  let k = 1;
  if (maxEdge > 0) k = Math.min(k, maxEdge / longAtFull);
  k = Math.min(k, Math.sqrt(MAX_AREA / areaAtFull));
  return renderWith(p, s, rc, k);
}

// ---------- コラージュ ----------

interface Tile {
  p: PhotoItem;
  aspect: number; // 出力の w/h
  ratio: number; // 出力幅 / 写真幅
  rc: RC;
}

export async function renderCollage(photos: PhotoItem[], s: Settings, widthOverride?: number) {
  const cs = s.collage;
  const W = widthOverride ?? cs.width;
  const gap = (W * cs.gap) / 1000;
  const tiles: Tile[] = [];
  for (const p of photos) {
    const rc = await context(p, s);
    const probeK = 300 / Math.max(p.width, p.height);
    const probe = renderWith(p, s, rc, probeK);
    tiles.push({ p, rc, aspect: probe.width / probe.height, ratio: probe.width / (p.width * probeK) });
  }
  const inner = W - gap * 2;
  type Place = { tile: Tile; x: number; y: number; w: number; h: number };
  const places: Place[] = [];
  let y = gap;

  if (cs.type === 'justified') {
    const target = (W * cs.rowHeight) / 100;
    let row: Tile[] = [];
    const flush = (last: boolean) => {
      if (!row.length) return;
      const sumA = row.reduce((a, t) => a + t.aspect, 0);
      const gaps = gap * (row.length - 1);
      let h = (inner - gaps) / sumA;
      if (last && h > target * 1.2) h = target;
      const rowW = sumA * h + gaps;
      let x = gap + (inner - rowW) / 2;
      for (const t of row) {
        const w = t.aspect * h;
        places.push({ tile: t, x, y, w, h });
        x += w + gap;
      }
      y += h + gap;
      row = [];
    };
    for (const t of tiles) {
      row.push(t);
      const sumA = row.reduce((a, r) => a + r.aspect, 0);
      if (sumA * target + gap * (row.length - 1) >= inner) flush(false);
    }
    flush(true);
  } else {
    const cols = Math.max(1, Math.min(cs.cols, tiles.length || 1));
    const cw = (inner - gap * (cols - 1)) / cols;
    const ch = cw; // 正方形セルに contain 配置
    tiles.forEach((t, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const h = Math.min(cw / t.aspect, ch);
      const w = t.aspect * h;
      places.push({ tile: t, x: gap + c * (cw + gap) + (cw - w) / 2, y: gap + r * (ch + gap) + (ch - h) / 2, w, h });
    });
    y = gap + Math.ceil(tiles.length / cols) * (ch + gap);
  }

  const { c, ctx } = canvas(W, Math.max(y, gap * 2 + 1));
  ctx.fillStyle = cs.bg;
  ctx.fillRect(0, 0, c.width, c.height);
  for (const pl of places) {
    const { p, ratio, rc } = pl.tile;
    const k = Math.min(1, pl.w / ratio / p.width);
    const img = renderWith(p, s, rc, k);
    ctx.drawImage(img, pl.x, pl.y, pl.w, pl.h);
  }
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の書き出しに失敗しました'))), type, quality),
  );
}
