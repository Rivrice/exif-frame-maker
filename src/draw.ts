import type { ImageSource, LogoAsset, PhotoItem, Settings } from './types';
import { findMaker, genericMaker, prettyModel, type MakerStyle } from './makers';

export interface DisplayInfo {
  maker: MakerStyle | null; // null = メーカー不明
  makerKey: string;
  model: string;
  lens: string;
  params: string[];
  date: string;
  artist: string;
}

export function effectiveExif(p: PhotoItem) {
  return { ...p.exif, ...p.overrides };
}

export function buildInfo(p: PhotoItem, s: Settings): DisplayInfo {
  const e = effectiveExif(p);
  const maker = findMaker(e.make) ?? (e.make ? genericMaker(e.make) : null);
  const params: string[] = [];
  if (s.show.focal && e.focal) params.push(e.focal);
  if (s.show.aperture && e.aperture) params.push(e.aperture);
  if (s.show.shutter && e.shutter) params.push(e.shutter);
  if (s.show.iso && e.iso) params.push(e.iso);
  const artist = s.author || e.artist;
  return {
    maker,
    makerKey: maker?.key ?? '',
    model: s.show.model ? (p.overrides.model !== undefined ? e.model : prettyModel(e.make, e.model)) : '',
    lens: s.show.lens ? e.lens : '',
    params,
    date: s.show.date ? e.date : '',
    artist: s.show.artist && artist ? `© ${artist}` : '',
  };
}

export interface RC {
  info: DisplayInfo;
  s: Settings;
  logo: LogoAsset | null;
  font: string; // レイアウト既定のフォント
}

export interface TextSpec {
  size: number;
  weight?: number;
  family?: string;
  italic?: boolean;
  color: string;
  align?: CanvasTextAlign;
  spacing?: number; // em
}

export function fontFamily(family: string) {
  return `"${family}", "Inter", "Noto Sans JP", system-ui, sans-serif`;
}

function setFont(ctx: CanvasRenderingContext2D, t: TextSpec) {
  ctx.font = `${t.italic ? 'italic ' : ''}${t.weight ?? 400} ${Math.max(1, t.size)}px ${fontFamily(t.family ?? 'Inter')}`;
}

export function textWidth(ctx: CanvasRenderingContext2D, text: string, t: TextSpec): number {
  if (!text) return 0;
  setFont(ctx, t);
  const sp = (t.spacing ?? 0) * t.size;
  if (!sp) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + sp;
  return w - sp;
}

/** 縦方向は中央揃え（y = 行の中心） */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: TextSpec): number {
  if (!text) return 0;
  const w = textWidth(ctx, text, t);
  setFont(ctx, t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'middle';
  const align = t.align ?? 'left';
  let left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const sp = (t.spacing ?? 0) * t.size;
  if (!sp) {
    ctx.textAlign = 'left';
    ctx.fillText(text, left, y);
  } else {
    ctx.textAlign = 'left';
    for (const ch of text) {
      ctx.fillText(ch, left, y);
      left += ctx.measureText(ch).width + sp;
    }
  }
  return w;
}

/** maxW に収まるようフォントサイズを縮める */
export function fit(ctx: CanvasRenderingContext2D, text: string, t: TextSpec, maxW: number): TextSpec {
  const w = textWidth(ctx, text, t);
  if (w <= maxW || w === 0) return t;
  return { ...t, size: t.size * (maxW / w) };
}

export interface Line {
  text: string;
  spec: TextSpec;
}

const lh = (l: Line) => l.spec.size * 1.3;

export function stackHeight(lines: Line[], gap = 0) {
  const ls = lines.filter((l) => l.text);
  return ls.reduce((a, l) => a + lh(l), 0) + gap * Math.max(0, ls.length - 1);
}

/** 複数行を cy を中心に縦に並べる */
export function drawStack(ctx: CanvasRenderingContext2D, lines: Line[], x: number, cy: number, gap = 0, maxW = Infinity) {
  const ls = lines.filter((l) => l.text);
  let y = cy - stackHeight(ls, gap) / 2;
  for (const l of ls) {
    const spec = maxW < Infinity ? fit(ctx, l.text, l.spec, maxW) : l.spec;
    drawText(ctx, l.text, x, y + lh(l) / 2, spec);
    y += lh(l) + gap;
  }
}

export function maxLineWidth(ctx: CanvasRenderingContext2D, lines: Line[]) {
  return Math.max(0, ...lines.map((l) => textWidth(ctx, l.text, l.spec)));
}

// ---------- メーカー名 / ロゴ ----------
// 標準では、メーカー名を各社ロゴに似せず、レイアウト共通の書体で普通の文字として表示する。
// 利用者が自分で登録したロゴ画像がある場合のみ画像を使う（改変せずそのまま描画）。

function makerSpec(rc: RC, h: number, color: string): TextSpec {
  return { size: (h / 0.72) * 0.82, weight: 700, family: rc.s.font || rc.font, color };
}

export function hasLogo(rc: RC) {
  return rc.s.show.logo && !!rc.info.maker;
}

export function logoWidth(ctx: CanvasRenderingContext2D, rc: RC, h: number): number {
  if (!hasLogo(rc)) return 0;
  if (rc.logo) return (rc.logo.width / rc.logo.height) * h;
  return textWidth(ctx, rc.info.maker!.display, makerSpec(rc, h, '#000'));
}

/**
 * メーカー名（または登録ロゴ画像）を描画。cy は縦中心。戻り値は描画幅。
 */
export function drawLogo(ctx: CanvasRenderingContext2D, rc: RC, x: number, cy: number, h: number, align: CanvasTextAlign, color: string): number {
  if (!hasLogo(rc)) return 0;
  const w = logoWidth(ctx, rc, h);
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (rc.logo) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rc.logo.image, left, cy - h / 2, w, h);
  } else {
    drawText(ctx, rc.info.maker!.display, left, cy + h * 0.02, { ...makerSpec(rc, h, color), align: 'left' });
  }
  return w;
}

// ---------- キャンバス ----------

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

export function drawPhoto(ctx: CanvasRenderingContext2D, src: ImageSource, x: number, y: number, w: number, h: number) {
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h);
}

/** 縮小→拡大で作るぼかし（全ブラウザで動作） */
export function blurred(src: ImageSource, w: number, h: number, amount = 48): HTMLCanvasElement {
  const small = canvas(Math.max(2, w / amount), Math.max(2, h / amount));
  small.ctx.drawImage(src, 0, 0, small.c.width, small.c.height);
  const mid = canvas(Math.max(4, w / 8), Math.max(4, h / 8));
  mid.ctx.drawImage(small.c, 0, 0, mid.c.width, mid.c.height);
  const out = canvas(w, h);
  out.ctx.drawImage(mid.c, 0, 0, w, h);
  return out.c;
}

/** cover 配置 */
export function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource & { width: number; height: number }, W: number, H: number) {
  const k = Math.max(W / src.width, H / src.height);
  const w = src.width * k, h = src.height * k;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}

export function parseAspect(a: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(a);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

/** 指定比率のキャンバスに中央配置（余白は背景色） */
export function padToAspect(src: HTMLCanvasElement, aspect: number, bg: string): HTMLCanvasElement {
  const cur = src.width / src.height;
  if (Math.abs(cur - aspect) < 0.001) return src;
  const W = cur > aspect ? src.width : src.height * aspect;
  const H = cur > aspect ? src.width / aspect : src.height;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, (c.width - src.width) / 2, (c.height - src.height) / 2);
  return c;
}

export function withAlpha(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
