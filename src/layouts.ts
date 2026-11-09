import type { Colors, Corner, CornerItem, FontRole, ImageSource } from './types';
import {
  baseFont, blurred, canvas, creditLine, creditText, drawCover, drawLogo, drawPhoto, drawStack, drawText, fit, hasLogo, mix, roleFont, withRuns,
  isLight, logoWidth, maxLineWidth, parseAspect, stackHeight, textWidth, withAlpha, type Line, type RC, type TextSpec,
} from './draw';

export interface Layout {
  id: string;
  name: string;
  desc: string;
  colors: Colors;
  font: string;
  /** 固定比率キャンバスのレイアウト（出力比率が「自動」の時に使う比率） */
  canvasAspect?: number;
  /** 四隅レイアウト（各隅の表示項目を設定できる） */
  corners?: boolean;
  render(src: ImageSource, iw: number, ih: number, rc: RC): HTMLCanvasElement;
}

const fam = (rc: RC, def: string) => baseFont(rc, def);
/** 文字やフチの基準長：基本は短辺、パノラマなど極端な比率では面積から補正 */
const base = (w: number, h: number) => Math.max(Math.min(w, h), Math.sqrt(w * h) * 0.82);
const units = (short: number, rc: RC) => ({ u: (short / 100) * rc.s.borderScale, t: (short / 100) * rc.s.textScale });
const join = (a: string[], sep = '  ') => a.filter(Boolean).join(sep);
/** 英字のみ大文字化（αなどは保持） */
const upper = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

// ---------- 四隅レイアウト用 ----------

export const CORNER_KEYS: Corner[] = ['tl', 'tr', 'bl', 'br'];

function cornerText(item: CornerItem, rc: RC): string {
  switch (item) {
    case 'model': return rc.info.model;
    case 'lens': return rc.info.lens;
    case 'params': return join(rc.info.params, '  ');
    case 'date': return rc.info.date;
    case 'credit': return rc.info.artist;
    default: return '';
  }
}

function cornerSpec(item: CornerItem, t: number, rc: RC, F: string, main: string, sub: string): TextSpec {
  const family = item === 'model' || item === 'lens' || item === 'params' || item === 'date' || item === 'credit' ? roleFont(rc, item, F) : F;
  switch (item) {
    case 'model': return { size: 2.6 * t, weight: 700, family, color: main };
    case 'params': return { size: 2.2 * t, weight: 600, family, color: main };
    case 'credit': return { size: 2 * t * rc.s.credit.scale, weight: 600, family, color: main };
    default: return { size: 1.9 * t, weight: 500, family, color: sub };
  }
}

/** 項目の高さ（表示するものが無ければ 0） */
function cornerItemHeight(item: CornerItem, t: number, rc: RC): number {
  if (!item) return 0;
  if (item === 'maker') return hasLogo(rc) ? 3.4 * t : 0;
  if (item === 'makerModel') return hasLogo(rc) || rc.info.model ? 3.4 * t : 0;
  return cornerText(item, rc) ? cornerSpec(item, t, rc, '', '', '').size : 0;
}

function drawCornerItem(
  ctx: CanvasRenderingContext2D, rc: RC, item: CornerItem, x: number, cy: number, align: 'left' | 'right',
  t: number, F: string, main: string, sub: string, maxW: number,
) {
  if (item === 'maker') {
    drawLogo(ctx, rc, x, cy, 3.4 * t, align, main);
    return;
  }
  if (item === 'makerModel') {
    const lh = 3.4 * t;
    const spec: TextSpec = { size: 2.6 * t, weight: 600, family: roleFont(rc, 'model', F), color: main };
    const lw = logoWidth(ctx, rc, lh);
    const gap = lw && rc.info.model ? 1.6 * t : 0;
    const mw = textWidth(ctx, rc.info.model, spec);
    const left = align === 'left' ? x : x - (lw + gap + mw);
    drawLogo(ctx, rc, left, cy, lh, 'left', main);
    drawText(ctx, rc.info.model, left + lw + gap, cy, fit(ctx, rc.info.model, spec, Math.max(maxW - lw - gap, maxW * 0.3)));
    return;
  }
  const text = cornerText(item, rc);
  if (!text) return;
  const spec = { ...cornerSpec(item, t, rc, F, main, sub), align };
  drawText(ctx, text, x, cy, fit(ctx, text, spec, maxW));
}

/** 固定比率キャンバス：出力比率の設定を優先 */
function canvasAspectOf(rc: RC, def: number) {
  return parseAspect(rc.s.aspect) ?? def;
}

/** 写真を領域内に contain 配置したときの寸法 */
function containIn(iw: number, ih: number, bw: number, bh: number) {
  const k = Math.min(bw / iw, bh / ih);
  return { w: iw * k, h: ih * k };
}

/** 固定比率レイアウト共通：写真の解像度を落とさないキャンバス幅を求める */
function fixedCanvas(iw: number, ih: number, aspect: number, marginRatio: number, textRatio: number) {
  // キャンバス幅 W、 余白 m=W*marginRatio、下部テキスト T=W*textRatio
  // 写真を等倍以上で収めるための最小W
  const wByW = iw / (1 - 2 * marginRatio);
  const wByH = ih / Math.max(0.1, 1 / aspect - marginRatio - textRatio);
  const W = Math.max(wByW, wByH);
  return { W, H: W / aspect };
}

export const LAYOUTS: Layout[] = [
  // 1. クラシック：写真の下に白いバー、左に機種、右にロゴ＋設定値
  {
    id: 'classic',
    name: 'クラシック',
    desc: '下部バーに機種・ロゴ・撮影設定',
    colors: { bg: '#ffffff', text: '#1a1a1a', sub: '#8a8a8a', accent: '#d0d0d0' },
    font: 'Inter',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const { colors: C } = rc.s;
      const left: Line[] = [
        { text: rc.info.model, spec: { size: 2.7 * t, weight: 700, family: roleFont(rc, 'model', F), color: C.text } },
        { text: rc.info.lens, spec: { size: 1.9 * t, weight: 400, family: roleFont(rc, 'lens', F), color: C.sub } },
      ];
      const right: Line[] = [
        { text: join(rc.info.params), spec: { size: 2.5 * t, weight: 700, family: roleFont(rc, 'params', F), color: C.text, align: 'right' } },
        { text: rc.info.date, spec: { size: 1.8 * t, weight: 400, family: roleFont(rc, 'date', F), color: C.sub, align: 'right' } },
        creditLine(rc, 1.8 * t, { weight: 500, family: F, color: C.sub, align: 'right' }),
      ];
      const bar = Math.max(11 * u, 9.5 * t, stackHeight(right, 0.5 * t) + 3.5 * t, stackHeight(left, 0.5 * t) + 3.5 * t);
      const { c, ctx } = canvas(iw, ih + bar);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, 0, 0, iw, ih);
      const cy = ih + bar / 2;
      const px = Math.max(4 * u, 3 * t);
      const rw = maxLineWidth(ctx, right);
      const lh = 4.4 * t;
      const lw = logoWidth(ctx, rc, lh);
      const avail = iw - px * 2;
      const leftMax = Math.max(avail * 0.3, avail - rw - lw - 6 * t);
      drawStack(ctx, left, px, cy, 0.5 * t, leftMax);
      drawStack(ctx, right, iw - px, cy, 0.5 * t);
      if (hasLogo(rc)) {
        const dx = iw - px - rw - (rw ? 2.4 * t : 0);
        if (rw) {
          ctx.fillStyle = C.accent;
          ctx.fillRect(dx, cy - 2.8 * t, Math.max(1, 0.18 * t), 5.6 * t);
        }
        drawLogo(ctx, rc, dx - (rw ? 2.4 * t : 0), cy, lh, 'right', C.text);
      }
      return c;
    },
  },

  // 2. ポラロイド
  {
    id: 'polaroid',
    name: 'ポラロイド',
    desc: '下側が広いインスタント写真風',
    colors: { bg: '#fbfaf6', text: '#222222', sub: '#8c8679', accent: '#d9d4c7' },
    font: 'Inter',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const side = 5 * u;
      const ld = mix(rc, F, [['lens', rc.info.lens], ['date', rc.info.date]], '   ');
      const lines: Line[] = [
        { text: rc.info.model, spec: { size: 2.6 * t, weight: 700, family: roleFont(rc, 'model', F), color: C.text, align: 'center' } },
        { text: join(rc.info.params), spec: { size: 2 * t, weight: 400, family: roleFont(rc, 'params', F), color: C.sub, align: 'center' } },
        { text: ld.text, spec: withRuns({ size: 1.6 * t, family: F, color: C.sub, align: 'center' }, ld) },
        creditLine(rc, 1.7 * t, { weight: 500, family: F, color: C.sub, align: 'center' }),
      ];
      const logoH = hasLogo(rc) ? 4.6 * t : 0;
      const total = logoH + (logoH ? 2.6 * t : 0) + stackHeight(lines, 0.6 * t);
      const bottom = Math.max(22 * u, 19 * t, total + 7 * t);
      const { c, ctx } = canvas(iw + side * 2, ih + side + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, side, side, iw, ih);
      const cx = c.width / 2;
      const top = side + ih;
      let y = top + bottom / 2 - total / 2;
      if (logoH) {
        drawLogo(ctx, rc, cx, y + logoH / 2, logoH, 'center', C.text);
        y += logoH + 2.6 * t;
      }
      drawStack(ctx, lines, cx, y + stackHeight(lines, 0.6 * t) / 2, 0.6 * t, c.width - side * 4);
      return c;
    },
  },

  // 3. シンプル枠：細い均等フチ＋下に1〜2行
  {
    id: 'simple',
    name: 'シンプル枠',
    desc: '細いフチと中央揃えの1行テキスト',
    colors: { bg: '#ffffff', text: '#111111', sub: '#777777', accent: '#cccccc' },
    font: 'Inter',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const b = 3 * u;
      const cr = creditText(rc);
      const crSize = 1.7 * t * rc.s.credit.scale;
      const crH = cr ? crSize * 1.3 + 0.8 * t : 0;
      const bottom = Math.max(12 * u, 10 * t) + crH;
      const { c, ctx } = canvas(iw + b * 2, ih + b + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, b, b, iw, ih);
      const cx = c.width / 2;
      const cy = b + ih + (bottom - crH) / 2;
      const s1 = { size: 2.4 * t, weight: 700, family: roleFont(rc, 'model', F), color: C.text };
      const s2 = { size: 1.8 * t, weight: 400, family: F, color: C.sub, align: 'center' as const };
      const subM = mix(rc, F, [['params', join(rc.info.params)], ['date', rc.info.date]], '  ·  ');
      const lh = 3.6 * t;
      const lw = logoWidth(ctx, rc, lh);
      const mw = textWidth(ctx, rc.info.model, s1);
      const gap = lw && mw ? 2.2 * t : 0;
      const sub = subM.text;
      const hasSub = !!sub;
      const y1 = hasSub ? cy - 1.9 * t : cy;
      const x0 = cx - (lw + gap + mw) / 2;
      drawLogo(ctx, rc, x0, y1, lh, 'left', C.text);
      if (lw && mw) {
        ctx.fillStyle = C.accent;
        ctx.fillRect(x0 + lw + gap / 2 - 0.08 * t, y1 - 1.7 * t, Math.max(1, 0.16 * t), 3.4 * t);
      }
      drawText(ctx, rc.info.model, x0 + lw + gap, y1, s1);
      if (hasSub) drawText(ctx, sub, cx, cy + 2.6 * t, fit(ctx, sub, withRuns(s2, subM), c.width - b * 4));
      if (cr) {
        const y = cy + (hasSub ? 2.6 * t + 1.8 * t * 0.65 : 2 * t) + 0.8 * t + crSize * 0.65;
        drawText(ctx, cr, cx, y, fit(ctx, cr, { ...s2, size: crSize, weight: 500, family: roleFont(rc, 'credit', F) }, c.width - b * 4));
      }
      return c;
    },
  },

  // 4. オーバーレイ：フチ無し、写真上にグラデーション＋文字
  {
    id: 'overlay',
    name: 'オーバーレイ',
    desc: 'フチ無しで写真の上に情報を重ねる',
    colors: { bg: '#000000', text: '#ffffff', sub: '#d8d8d8', accent: '#ffffff' },
    font: 'Montserrat',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const { c, ctx } = canvas(iw, ih);
      drawPhoto(ctx, src, 0, 0, iw, ih);
      const gh = Math.max(ih * 0.32, 26 * t);
      const g = ctx.createLinearGradient(0, ih - gh, 0, ih);
      g.addColorStop(0, withAlpha(C.bg, 0));
      g.addColorStop(1, withAlpha(C.bg, 0.72));
      ctx.fillStyle = g;
      ctx.fillRect(0, ih - gh, iw, gh);
      const px = 5 * u;
      const ld = mix(rc, F, [['lens', rc.info.lens], ['date', rc.info.date]], '   ');
      const lines: Line[] = [
        { text: rc.info.model, spec: { size: 3 * t, weight: 700, family: roleFont(rc, 'model', F), color: C.text } },
        { text: join(rc.info.params, '   '), spec: { size: 2.1 * t, weight: 500, family: roleFont(rc, 'params', F), color: C.sub } },
        { text: ld.text, spec: withRuns({ size: 1.6 * t, family: F, color: C.sub }, ld) },
        creditLine(rc, 1.7 * t, { weight: 600, family: F, color: C.text }),
      ];
      const sh = stackHeight(lines, 0.5 * t);
      const bottomY = ih - px;
      drawStack(ctx, lines, px, bottomY - sh / 2, 0.5 * t, iw * 0.7);
      if (hasLogo(rc)) drawLogo(ctx, rc, iw - px, bottomY - 2.4 * t, 4.4 * t, 'right', C.accent);
      return c;
    },
  },

  // 5. フィルム
  {
    id: 'film',
    name: 'フィルム',
    desc: 'パーフォレーション付きのフィルム風',
    colors: { bg: '#141414', text: '#f2f2f2', sub: '#6b6b6b', accent: '#ff9a2e' },
    font: 'JetBrains Mono',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const band = 8 * u;
      const side = 3 * u;
      const info = Math.max(9 * u, 8 * t);
      const W = iw + side * 2;
      const H = ih + band * 2 + info;
      const { c, ctx } = canvas(W, H);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      // パーフォレーション
      const hw = 2.4 * u, hh = 3.4 * u, step = 6 * u;
      ctx.fillStyle = C.sub;
      const n = Math.floor(W / step);
      const ox = (W - n * step) / 2 + (step - hw) / 2;
      for (const by of [band / 2, band + ih + band / 2]) {
        for (let i = 0; i < n; i++) {
          const x = ox + i * step, y = by - hh / 2, r = hw * 0.25;
          ctx.beginPath();
          ctx.roundRect(x, y, hw, hh, r);
          ctx.fill();
        }
      }
      drawPhoto(ctx, src, side, band, iw, ih);
      // エッジ文字
      const edge = { size: 1.5 * t, weight: 700, family: F, color: C.accent, spacing: 0.1 };
      const iso = rc.info.params.find((p) => p.startsWith('ISO')) ?? '';
      // 実在のフィルム製品の刻印に似せないよう、メーカー名は入れずISO感度とコマ番号風の表記のみ
      const edgeText = join([iso ? `ISO ${iso.replace('ISO', '')}` : '', '▸ 1A'], '   ');
      if (edgeText) {
        const ew = textWidth(ctx, edgeText, edge) + 2 * u;
        ctx.fillStyle = C.bg;
        ctx.fillRect(side + 8 * u, 0, ew, band);
        drawText(ctx, edgeText, side + 9 * u, band / 2, edge);
      }
      const cr = creditText(rc);
      if (cr) {
        const cs = fit(ctx, cr, { ...edge, family: roleFont(rc, 'credit', F), size: 1.6 * t * rc.s.credit.scale, align: 'right' as const }, W * 0.45);
        cs.size = Math.min(cs.size, band * 0.8);
        const cw = textWidth(ctx, cr, cs) + 2 * u;
        ctx.fillStyle = C.bg;
        ctx.fillRect(W - side - 8 * u - cw, 0, cw, band);
        drawText(ctx, cr, W - side - 9 * u, band / 2, cs);
      }
      const cy = band * 2 + ih + info / 2 - band / 2;
      const left = { size: 2.3 * t, weight: 700, family: F, color: C.text };
      const right = { size: 2 * t, weight: 400, family: F, color: C.accent, align: 'right' as const };
      const lw = logoWidth(ctx, rc, 3.6 * t);
      drawLogo(ctx, rc, side, cy, 3.6 * t, 'left', C.text);
      const mx = side + lw + (lw ? 2.4 * t : 0);
      const rM = mix(rc, F, [['params', join(rc.info.params)], ['date', rc.info.date ? `'${rc.info.date.slice(2)}` : '']], '   ');
      const rText = rM.text;
      const rSpec = withRuns(right, rM);
      const rw = textWidth(ctx, rText, rSpec);
      drawText(ctx, rText, W - side, cy, fit(ctx, rText, rSpec, W * 0.6));
      const mlM = mix(rc, F, [['model', rc.info.model], ['lens', rc.info.lens]], '  /  ');
      const modelLens = mlM.text;
      drawText(ctx, modelLens, mx, cy, fit(ctx, modelLens, withRuns(left, mlM), Math.max(W * 0.2, W - side * 2 - lw - rw - 6 * t)));
      return c;
    },
  },

  // 6. スクエア (1:1)
  {
    id: 'square',
    name: 'スクエア 1:1',
    desc: 'どんな比率も正方形に収めてSNS向けに',
    colors: { bg: '#ffffff', text: '#1d1d1d', sub: '#8d8d8d', accent: '#d6d6d6' },
    font: 'Inter',
    canvasAspect: 1,
    render(src, iw, ih, rc) {
      return fixedLayout(src, iw, ih, rc, canvasAspectOf(rc, 1), fam(rc, this.font), false);
    },
  },

  // 7. 縦長 4:5
  {
    id: 'portrait',
    name: 'ポートレート 4:5',
    desc: 'Instagram向けの縦長キャンバス',
    colors: { bg: '#f4f1ec', text: '#2b2b2b', sub: '#8f877b', accent: '#cfc6b8' },
    font: 'Playfair Display',
    canvasAspect: 4 / 5,
    render(src, iw, ih, rc) {
      return fixedLayout(src, iw, ih, rc, canvasAspectOf(rc, 4 / 5), fam(rc, this.font), false);
    },
  },

  // 8. ぼかし背景
  {
    id: 'blur',
    name: 'ぼかし背景',
    desc: '写真をぼかした背景に影付きで配置',
    colors: { bg: '#000000', text: '#ffffff', sub: '#e6e6e6', accent: '#ffffff' },
    font: 'Montserrat',
    canvasAspect: 4 / 5,
    render(src, iw, ih, rc) {
      return fixedLayout(src, iw, ih, rc, canvasAspectOf(rc, 4 / 5), fam(rc, this.font), true);
    },
  },

  // 9. サイドパネル
  {
    id: 'side',
    name: 'サイドパネル',
    desc: '右側のパネルに情報を縦に並べる',
    colors: { bg: '#1c1c1e', text: '#ffffff', sub: '#9a9aa0', accent: '#ffb340' },
    font: 'Inter',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const P = Math.max(36 * u, 34 * t);
      const { c, ctx } = canvas(iw + P, ih);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, 0, 0, iw, ih);
      const x = iw + 4 * u;
      const maxW = P - 8 * u;
      if (hasLogo(rc)) {
        const lh = 4.4 * t;
        const lw = logoWidth(ctx, rc, lh);
        const k = Math.min(1, maxW / lw);
        drawLogo(ctx, rc, x, 4 * u + (lh * k) / 2, lh * k, 'left', C.text);
      }
      const accentBar = { size: 1.9 * t, weight: 700, family: F, color: C.accent, spacing: 0.15 };
      const items: [string, string][] = [];
      const ROLE: Record<string, FontRole> = { CAMERA: 'model', LENS: 'lens', SETTINGS: 'params', DATE: 'date', PHOTO: 'credit' };
      if (rc.info.model) items.push(['CAMERA', rc.info.model]);
      if (rc.info.lens) items.push(['LENS', rc.info.lens]);
      if (rc.info.params.length) items.push(['SETTINGS', join(rc.info.params)]);
      if (rc.info.date) items.push(['DATE', rc.info.date]);
      const cr = creditText(rc);
      if (cr) items.push(['PHOTO', cr.replace(/^© /, '')]);
      const val = { size: 2.7 * t, weight: 600, family: F, color: C.text };
      const valSize = (k: string) => (k === 'PHOTO' ? 2.7 * t * rc.s.credit.scale : 2.7 * t);
      const gap = 2.6 * t;
      const total = items.reduce((a, [k]) => a + 1.9 * t * 1.3 + 0.6 * t + valSize(k) * 1.3, 0) + Math.max(0, items.length - 1) * gap;
      let y = ih - 4 * u - total;
      for (const [k, v] of items) {
        drawText(ctx, k, x, y + 1.9 * t * 0.65, accentBar);
        y += 1.9 * t * 1.3 + 0.6 * t;
        const vs = valSize(k);
        drawText(ctx, v, x, y + vs * 0.65, fit(ctx, v, { ...val, size: vs, family: roleFont(rc, ROLE[k], F) }, maxW));
        y += vs * 1.3 + gap;
      }
      return c;
    },
  },

  // 10. ギャラリーマット
  {
    id: 'gallery',
    name: 'ギャラリー',
    desc: '広い余白と字間の広いキャプション',
    colors: { bg: '#f7f6f2', text: '#2a2a2a', sub: '#6f6a60', accent: '#e2ded4' },
    font: 'Cormorant Garamond',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const m = 10 * u;
      const bottom = Math.max(20 * u, 16 * t) + (creditText(rc) ? 2.1 * t * rc.s.credit.scale * 1.3 + 0.8 * t : 0);
      const { c, ctx } = canvas(iw + m * 2, ih + m + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.18)';
      ctx.shadowBlur = 2 * u;
      ctx.shadowOffsetY = 0.6 * u;
      ctx.fillStyle = C.bg;
      ctx.fillRect(m, m, iw, ih);
      ctx.restore();
      drawPhoto(ctx, src, m, m, iw, ih);
      const cx = c.width / 2;
      const cy = m + ih + bottom / 2;
      const tM = mix(rc, F, [['maker', rc.info.maker && !hasLogo(rc) ? rc.info.maker.display : ''], ['model', rc.info.model]], ' ', upper);
      const pdM = mix(rc, F, [['params', join(rc.info.params, '  ·  ')], ['date', rc.info.date]], '  ·  ');
      const lines: Line[] = [
        { text: tM.text, spec: withRuns({ size: 2.8 * t, weight: 700, family: F, color: C.text, align: 'center', spacing: 0.3 }, tM) },
        { text: pdM.text, spec: withRuns({ size: 2.2 * t, weight: 600, family: F, color: C.sub, align: 'center', spacing: 0.08 }, pdM) },
        creditLine(rc, 2.1 * t, { weight: 600, family: F, color: C.sub, align: 'center', spacing: 0.08 }),
      ];
      const lh = hasLogo(rc) ? 3.6 * t : 0;
      const sh = stackHeight(lines, 0.8 * t);
      const total = lh + (lh ? 2 * t : 0) + sh;
      let y = cy - total / 2;
      if (lh) {
        drawLogo(ctx, rc, cx, y + lh / 2, lh, 'center', C.text);
        y += lh + 2 * t;
      }
      drawStack(ctx, lines, cx, y + sh / 2, 0.8 * t, c.width - m * 2);
      return c;
    },
  },

  // 11. センターロゴ
  {
    id: 'center',
    name: 'センターロゴ',
    desc: '下部中央に大きくロゴを配置',
    colors: { bg: '#ffffff', text: '#000000', sub: '#7a7a7a', accent: '#c8c8c8' },
    font: 'Montserrat',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const b = 2 * u;
      const bottom = Math.max(22 * u, 21 * t) + (creditText(rc) ? 1.8 * t * rc.s.credit.scale * 1.3 + 0.5 * t : 0);
      const { c, ctx } = canvas(iw + b * 2, ih + b + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, b, b, iw, ih);
      const cx = c.width / 2;
      const plM = mix(rc, F, [['params', join(rc.info.params, '  |  ')], ['lens', rc.info.lens]], '  |  ');
      const lines: Line[] = [
        { text: rc.info.model, spec: { size: 2.7 * t, weight: 700, family: roleFont(rc, 'model', F), color: C.text, align: 'center', spacing: 0.05 } },
        { text: plM.text, spec: withRuns({ size: 2.1 * t, weight: 500, family: F, color: C.sub, align: 'center' }, plM) },
        { text: rc.info.date, spec: { size: 1.8 * t, family: roleFont(rc, 'date', F), color: C.sub, align: 'center' } },
        creditLine(rc, 1.8 * t, { weight: 500, family: F, color: C.sub, align: 'center' }),
      ];
      const lh = hasLogo(rc) ? 5.6 * t : 0;
      const sh = stackHeight(lines, 0.5 * t);
      const accentH = 0.35 * t;
      const total = lh + (lh ? 3 * t : 0) + sh;
      let y = b + ih + bottom / 2 - total / 2;
      if (lh) {
        drawLogo(ctx, rc, cx, y + lh / 2, lh, 'center', C.text);
        ctx.fillStyle = C.accent;
        ctx.fillRect(cx - 3 * t, y + lh + 1.4 * t, 6 * t, accentH);
        y += lh + 3 * t;
      }
      drawStack(ctx, lines, cx, y + sh / 2, 0.5 * t, c.width - b * 8);
      return c;
    },
  },

  // 12. シネマ
  {
    id: 'cinema',
    name: 'シネマ',
    desc: '上下の黒帯に映画のクレジット風テキスト',
    colors: { bg: '#000000', text: '#f5f5f5', sub: '#8e8e8e', accent: '#f5c518' },
    font: 'Oswald',
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const bar = Math.max(10 * u, 8 * t);
      const { c, ctx } = canvas(iw, ih + bar * 2);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, 0, bar, iw, ih);
      const px = 4 * u;
      const small = { size: 1.6 * t, weight: 400, family: F, color: C.sub, spacing: 0.2 };
      const cr = upper(creditText(rc));
      if (cr) drawText(ctx, cr, px, bar / 2, fit(ctx, cr, { ...small, family: roleFont(rc, 'credit', F), size: Math.min(1.6 * t * rc.s.credit.scale, bar * 0.6) }, iw * 0.55));
      drawText(ctx, rc.info.date, iw - px, bar / 2, { ...small, family: roleFont(rc, 'date', F), align: 'right' });
      const cy = bar + ih + bar / 2;
      const lh = 3.4 * t;
      const lw = drawLogo(ctx, rc, px, cy, lh, 'left', C.text);
      const mM = mix(rc, F, [['model', rc.info.model], ['params', join(rc.info.params, '   ')]], '   ', upper);
      const main = mM.text;
      const spec = withRuns({ size: 2.3 * t, weight: 500, family: F, color: C.text, spacing: 0.18, align: 'center' as const }, mM);
      drawText(ctx, main, iw / 2, cy, fit(ctx, main, spec, iw - (lw + px) * 2 - 4 * t));
      const lens = upper(rc.info.lens);
      if (lens) {
        const ls = { size: 1.5 * t, weight: 400, family: roleFont(rc, 'lens', F), color: C.accent, spacing: 0.15, align: 'right' as const };
        drawText(ctx, lens, iw - px, cy, fit(ctx, lens, ls, iw * 0.22));
      }
      return c;
    },
  },

  // 13. 四隅（写真の上）
  {
    id: 'corners',
    name: '四隅',
    desc: '写真の四隅に好きな情報を重ねて配置',
    colors: { bg: '#000000', text: '#ffffff', sub: '#e6e6e6', accent: '#ffffff' },
    font: 'Inter',
    corners: true,
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const { c, ctx } = canvas(iw, ih);
      drawPhoto(ctx, src, 0, 0, iw, ih);
      const pad = 4.5 * u;
      ctx.save();
      ctx.shadowColor = isLight(C.text) ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)';
      ctx.shadowBlur = 1.2 * t;
      for (const k of CORNER_KEYS) {
        const item = rc.s.corners[k];
        const h = cornerItemHeight(item, t, rc);
        if (!h) continue;
        const left = k.endsWith('l');
        const cy = k.startsWith('t') ? pad + h / 2 : ih - pad - h / 2;
        drawCornerItem(ctx, rc, item, left ? pad : iw - pad, cy, left ? 'left' : 'right', t, F, C.text, C.sub, iw / 2 - pad * 1.5);
      }
      ctx.restore();
      return c;
    },
  },

  // 14. 四隅（フチの上）
  {
    id: 'corners-frame',
    name: '四隅フチ',
    desc: '上下のフチの四隅に好きな情報を配置',
    colors: { bg: '#ffffff', text: '#1a1a1a', sub: '#8a8a8a', accent: '#d0d0d0' },
    font: 'Inter',
    corners: true,
    render(src, iw, ih, rc) {
      const { u, t } = units(base(iw, ih), rc);
      const F = fam(rc, this.font);
      const C = rc.s.colors;
      const b = 3.5 * u;
      const hOf = (a: Corner, z: Corner) => Math.max(cornerItemHeight(rc.s.corners[a], t, rc), cornerItemHeight(rc.s.corners[z], t, rc));
      const topH = hOf('tl', 'tr');
      const botH = hOf('bl', 'br');
      const top = topH ? Math.max(8 * u, topH + 3.5 * t) : b;
      const bottom = botH ? Math.max(8 * u, botH + 3.5 * t) : b;
      const W = iw + b * 2;
      const { c, ctx } = canvas(W, ih + top + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, b, top, iw, ih);
      for (const k of CORNER_KEYS) {
        const item = rc.s.corners[k];
        if (!cornerItemHeight(item, t, rc)) continue;
        const left = k.endsWith('l');
        const cy = k.startsWith('t') ? top / 2 : top + ih + bottom / 2;
        drawCornerItem(ctx, rc, item, left ? b : W - b, cy, left ? 'left' : 'right', t, F, C.text, C.sub, iw / 2 - b);
      }
      return c;
    },
  },
];

/** 固定比率キャンバス（スクエア / 4:5 / ぼかし背景）の共通処理 */
function fixedLayout(src: ImageSource, iw: number, ih: number, rc: RC, aspect: number, F: string, blur: boolean) {
  const C = rc.s.colors;
  const mR = 0.06 * rc.s.borderScale;
  // テキスト領域：短辺基準の文字サイズで必要な高さ（ロゴ＋3行）を確保
  const shortRatio = Math.min(1, 1 / aspect);
  const crExtra = creditText(rc) ? 0.024 * rc.s.credit.scale : 0;
  const tR = shortRatio * rc.s.textScale * (0.16 + crExtra) + mR * 0.6;
  const { W, H } = fixedCanvas(iw, ih, aspect, mR, tR);
  const { c, ctx } = canvas(W, H);
  const short = Math.min(W, H);
  const t = (short / 100) * rc.s.textScale;
  const m = W * mR;
  const textH = W * tR;
  if (blur) {
    const bg = blurred(src, W, H);
    drawCover(ctx, bg, W, H);
    ctx.fillStyle = withAlpha(C.bg, 0.35);
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
  }
  const box = { w: W - m * 2, h: H - m - textH };
  const { w, h } = containIn(iw, ih, box.w, box.h);
  const x = (W - w) / 2;
  const y = m + (box.h - h) / 2;
  if (blur) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = short * 0.03;
    ctx.shadowOffsetY = short * 0.008;
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  drawPhoto(ctx, src, x, y, w, h);
  const cx = W / 2;
  const cy = y + h + (H - (y + h)) / 2;
  const ld = mix(rc, F, [['lens', rc.info.lens], ['date', rc.info.date]], '   ');
  const lines: Line[] = [
    { text: rc.info.model, spec: { size: 2.6 * t, weight: 700, family: roleFont(rc, 'model', F), color: C.text, align: 'center' } },
    { text: join(rc.info.params, '   '), spec: { size: 2 * t, weight: 400, family: roleFont(rc, 'params', F), color: C.sub, align: 'center' } },
    { text: ld.text, spec: withRuns({ size: 1.6 * t, family: F, color: C.sub, align: 'center' }, ld) },
    creditLine(rc, 1.7 * t, { weight: 500, family: F, color: C.sub, align: 'center' }),
  ];
  const lh = hasLogo(rc) ? 4 * t : 0;
  const sh = stackHeight(lines, 0.5 * t);
  const total = lh + (lh ? 2.2 * t : 0) + sh;
  let yy = cy - total / 2;
  if (lh) {
    drawLogo(ctx, rc, cx, yy + lh / 2, lh, 'center', C.text);
    yy += lh + 2.2 * t;
  }
  drawStack(ctx, lines, cx, yy + sh / 2, 0.5 * t, W - m * 2);
  return c;
}

export function getLayout(id: string) {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}
