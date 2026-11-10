import type { PhotoItem, Settings } from './types';
import { baseFont, buildInfo, drawText, roleFont, isLight, lastPhotoRect, padToAspect, parseAspect, resetPhotoRect, type RC } from './draw';
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
const requested = new Set<string>();

/**
 * 描画に使うフォントを、使う文字の分だけ読み込む（日本語フォントは文字ごとに分割されているため）。
 * 内蔵フォントが増えても、選んでいないフォントはダウンロードしない。
 */
async function ensureFonts(families: string[], texts: string[], italic: string[] = []) {
  const t = texts.join('') + 'Aa0© ';
  const chars = [...new Set(t)].join('');
  const fams = new Set(families.filter(Boolean));
  if (NON_LATIN.test(t)) fams.add('Noto Sans JP'); // 日本語の代替表示用
  const jobs: Promise<unknown>[] = [];
  const req = (font: string) => {
    const key = font + '|' + chars;
    if (requested.has(key)) return;
    requested.add(key);
    jobs.push(document.fonts.load(font, chars));
  };
  for (const f of fams) for (const w of [400, 700]) req(`${w} 32px "${f}"`);
  for (const f of italic) for (const w of [400, 800]) req(`italic ${w} 32px "${f}"`);
  if (jobs.length) await Promise.allSettled(jobs);
}

const upperAscii = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

export const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(navigator.userAgent);
// ブラウザのキャンバス上限（面積・一辺）を超えると真っ白／書き出し失敗になるため、それ未満に抑える
const MAX_AREA = IS_IOS ? 16_000_000 : IS_ANDROID ? 50_000_000 : 120_000_000;
const MAX_SIDE = IS_IOS || IS_ANDROID ? 16_384 : 32_000;

async function context(p: PhotoItem, s: Settings): Promise<RC> {
  const info = buildInfo(p, s);
  const layoutFont = getLayout(s.layoutId).font;
  const m = info.maker;
  await ensureFonts(
    [layoutFont, s.font, ...Object.values(s.fonts ?? {}), s.makerStyle !== false ? m?.font ?? '' : ''],
    [info.model, info.lens, info.date, info.artist, ...info.params, m?.display ?? '', upperAscii(m?.display ?? '')],
    s.makerStyle !== false && m?.italic && m.font ? [m.font] : [],
  );
  const logo = s.show.logo && info.maker ? await getLogo(info.maker.key) : null;
  return { info, s, logo, font: getLayout(s.layoutId).font };
}

/** クレジットを写真の四隅に描く */
function drawCornerCredit(out: HTMLCanvasElement, rc: RC, layoutFont: string) {
  const r = lastPhotoRect;
  if (!r.w || !r.h) return;
  const ctx = out.getContext('2d')!;
  const short = Math.max(Math.min(r.w, r.h), Math.sqrt(r.w * r.h) * 0.82);
  const size = (short / 100) * 1.9 * rc.s.textScale * rc.s.credit.scale;
  const pad = short * 0.035;
  const pos = rc.s.credit.position;
  const color = rc.s.credit.color === 'light' ? '#ffffff' : rc.s.credit.color === 'dark' ? '#111111' : rc.s.colors.text;
  const x = pos.endsWith('l') ? r.x + pad : r.x + r.w - pad;
  const y = pos.startsWith('t') ? r.y + pad + size * 0.65 : r.y + r.h - pad - size * 0.65;
  ctx.save();
  ctx.shadowColor = isLight(color) ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = size * 0.35;
  drawText(ctx, rc.info.artist, x, y, {
    size,
    weight: 600,
    family: roleFont(rc, 'credit', baseFont(rc, layoutFont)),
    color,
    align: pos.endsWith('l') ? 'left' : 'right',
  });
  ctx.restore();
}

/** k = 写真の描画倍率 */
function renderWith(p: PhotoItem, s: Settings, rc: RC, k: number): HTMLCanvasElement {
  const layout = getLayout(s.layoutId);
  const iw = Math.max(1, Math.round(p.width * k));
  const ih = Math.max(1, Math.round(p.height * k));
  resetPhotoRect();
  let out = layout.render(p.source, iw, ih, rc);
  if (s.credit.position !== 'auto' && !layout.corners && rc.info.artist) drawCornerCredit(out, rc, layout.font);
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
  k = Math.min(k, Math.sqrt(MAX_AREA / areaAtFull), MAX_SIDE / longAtFull);
  return renderWith(p, s, rc, k);
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の書き出しに失敗しました'))), type, quality),
  );
}
