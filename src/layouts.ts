import type { Colors, ImageSource } from './types';
import {
  blurred, canvas, drawCover, drawLogo, drawPhoto, drawStack, drawText, fit, hasLogo, logoWidth,
  maxLineWidth, parseAspect, stackHeight, textWidth, withAlpha, type Line, type RC,
} from './draw';

export interface Layout {
  id: string;
  name: string;
  desc: string;
  colors: Colors;
  font: string;
  /** 固定比率キャンバスのレイアウト（出力比率が「自動」の時に使う比率） */
  canvasAspect?: number;
  render(src: ImageSource, iw: number, ih: number, rc: RC): HTMLCanvasElement;
}

const fam = (rc: RC, def: string) => rc.s.font || def;
/** 文字やフチの基準長：基本は短辺、パノラマなど極端な比率では面積から補正 */
const base = (w: number, h: number) => Math.max(Math.min(w, h), Math.sqrt(w * h) * 0.82);
const units = (short: number, rc: RC) => ({ u: (short / 100) * rc.s.borderScale, t: (short / 100) * rc.s.textScale });
const join = (a: string[], sep = '  ') => a.filter(Boolean).join(sep);
/** 英字のみ大文字化（αなどは保持） */
const upper = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

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
      const bar = Math.max(11 * u, 9.5 * t);
      const { c, ctx } = canvas(iw, ih + bar);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, 0, 0, iw, ih);
      const cy = ih + bar / 2;
      const px = Math.max(4 * u, 3 * t);
      const left: Line[] = [
        { text: rc.info.model, spec: { size: 2.7 * t, weight: 700, family: F, color: C.text } },
        { text: rc.info.lens, spec: { size: 1.9 * t, weight: 400, family: F, color: C.sub } },
      ];
      const right: Line[] = [
        { text: join(rc.info.params), spec: { size: 2.5 * t, weight: 700, family: F, color: C.text, align: 'right' } },
        { text: join([rc.info.date, rc.info.artist]), spec: { size: 1.8 * t, weight: 400, family: F, color: C.sub, align: 'right' } },
      ];
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
      const bottom = Math.max(22 * u, 19 * t);
      const { c, ctx } = canvas(iw + side * 2, ih + side + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, side, side, iw, ih);
      const cx = c.width / 2;
      const top = side + ih;
      const lines: Line[] = [
        { text: rc.info.model, spec: { size: 2.6 * t, weight: 700, family: F, color: C.text, align: 'center' } },
        { text: join(rc.info.params), spec: { size: 2 * t, weight: 400, family: F, color: C.sub, align: 'center' } },
        { text: join([rc.info.lens, rc.info.date, rc.info.artist], '   '), spec: { size: 1.6 * t, family: F, color: C.sub, align: 'center' } },
      ];
      const logoH = hasLogo(rc) ? 4.6 * t : 0;
      const total = logoH + (logoH ? 2.6 * t : 0) + stackHeight(lines, 0.6 * t);
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
      const bottom = Math.max(12 * u, 10 * t);
      const { c, ctx } = canvas(iw + b * 2, ih + b + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, b, b, iw, ih);
      const cx = c.width / 2;
      const cy = b + ih + bottom / 2;
      const s1 = { size: 2.4 * t, weight: 700, family: F, color: C.text };
      const s2 = { size: 1.8 * t, weight: 400, family: F, color: C.sub, align: 'center' as const };
      const lh = 3.6 * t;
      const lw = logoWidth(ctx, rc, lh);
      const mw = textWidth(ctx, rc.info.model, s1);
      const gap = lw && mw ? 2.2 * t : 0;
      const sub = join([join(rc.info.params), rc.info.date, rc.info.artist], '  ·  ');
      const hasSub = !!sub;
      const y1 = hasSub ? cy - 1.9 * t : cy;
      const x0 = cx - (lw + gap + mw) / 2;
      drawLogo(ctx, rc, x0, y1, lh, 'left', C.text);
      if (lw && mw) {
        ctx.fillStyle = C.accent;
        ctx.fillRect(x0 + lw + gap / 2 - 0.08 * t, y1 - 1.7 * t, Math.max(1, 0.16 * t), 3.4 * t);
      }
      drawText(ctx, rc.info.model, x0 + lw + gap, y1, s1);
      if (hasSub) drawText(ctx, sub, cx, cy + 2.6 * t, fit(ctx, sub, s2, c.width - b * 4));
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
      const lines: Line[] = [
        { text: rc.info.model, spec: { size: 3 * t, weight: 700, family: F, color: C.text } },
        { text: join(rc.info.params, '   '), spec: { size: 2.1 * t, weight: 500, family: F, color: C.sub } },
        { text: join([rc.info.lens, rc.info.date, rc.info.artist], '   '), spec: { size: 1.6 * t, family: F, color: C.sub } },
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
      const cy = band * 2 + ih + info / 2 - band / 2;
      const left = { size: 2.3 * t, weight: 700, family: F, color: C.text };
      const right = { size: 2 * t, weight: 400, family: F, color: C.accent, align: 'right' as const };
      const lw = logoWidth(ctx, rc, 3.6 * t);
      drawLogo(ctx, rc, side, cy, 3.6 * t, 'left', C.text);
      const mx = side + lw + (lw ? 2.4 * t : 0);
      const rText = join([join(rc.info.params), rc.info.date ? `'${rc.info.date.slice(2)}` : ''], '   ');
      const rw = textWidth(ctx, rText, right);
      drawText(ctx, rText, W - side, cy, fit(ctx, rText, right, W * 0.6));
      const modelLens = join([rc.info.model, rc.info.lens], '  /  ');
      drawText(ctx, modelLens, mx, cy, fit(ctx, modelLens, left, Math.max(W * 0.2, W - side * 2 - lw - rw - 6 * t)));
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
      if (rc.info.model) items.push(['CAMERA', rc.info.model]);
      if (rc.info.lens) items.push(['LENS', rc.info.lens]);
      if (rc.info.params.length) items.push(['SETTINGS', join(rc.info.params)]);
      if (rc.info.date) items.push(['DATE', rc.info.date]);
      if (rc.info.artist) items.push(['PHOTO', rc.info.artist.replace(/^© /, '')]);
      const val = { size: 2.7 * t, weight: 600, family: F, color: C.text };
      const blockH = 1.9 * t * 1.3 + 0.6 * t + 2.7 * t * 1.3;
      const gap = 2.6 * t;
      const total = items.length * blockH + Math.max(0, items.length - 1) * gap;
      let y = ih - 4 * u - total;
      for (const [k, v] of items) {
        drawText(ctx, k, x, y + 1.9 * t * 0.65, accentBar);
        y += 1.9 * t * 1.3 + 0.6 * t;
        drawText(ctx, v, x, y + 2.7 * t * 0.65, fit(ctx, v, val, maxW));
        y += 2.7 * t * 1.3 + gap;
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
      const bottom = Math.max(20 * u, 16 * t);
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
      const title = upper(join([rc.info.maker && !hasLogo(rc) ? rc.info.maker.display : '', rc.info.model], ' '));
      const lines: Line[] = [
        { text: title, spec: { size: 2.8 * t, weight: 700, family: F, color: C.text, align: 'center', spacing: 0.3 } },
        { text: join([...rc.info.params, rc.info.date, rc.info.artist], '  ·  '), spec: { size: 2.2 * t, weight: 600, family: F, color: C.sub, align: 'center', spacing: 0.08 } },
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
      const bottom = Math.max(22 * u, 21 * t);
      const { c, ctx } = canvas(iw + b * 2, ih + b + bottom);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, c.width, c.height);
      drawPhoto(ctx, src, b, b, iw, ih);
      const cx = c.width / 2;
      const lines: Line[] = [
        { text: rc.info.model, spec: { size: 2.7 * t, weight: 700, family: F, color: C.text, align: 'center', spacing: 0.05 } },
        { text: join([...rc.info.params, rc.info.lens], '  |  '), spec: { size: 2.1 * t, weight: 500, family: F, color: C.sub, align: 'center' } },
        { text: join([rc.info.date, rc.info.artist], '   '), spec: { size: 1.8 * t, family: F, color: C.sub, align: 'center' } },
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
      drawText(ctx, upper(rc.info.artist), px, bar / 2, small);
      drawText(ctx, rc.info.date, iw - px, bar / 2, { ...small, align: 'right' });
      const cy = bar + ih + bar / 2;
      const lh = 3.4 * t;
      const lw = drawLogo(ctx, rc, px, cy, lh, 'left', C.text);
      const main = upper(join([rc.info.model, ...rc.info.params], '   '));
      const spec = { size: 2.3 * t, weight: 500, family: F, color: C.text, spacing: 0.18, align: 'center' as const };
      drawText(ctx, main, iw / 2, cy, fit(ctx, main, spec, iw - (lw + px) * 2 - 4 * t));
      const lens = upper(rc.info.lens);
      if (lens) {
        const ls = { size: 1.5 * t, weight: 400, family: F, color: C.accent, spacing: 0.15, align: 'right' as const };
        drawText(ctx, lens, iw - px, cy, fit(ctx, lens, ls, iw * 0.22));
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
  const tR = shortRatio * rc.s.textScale * 0.16 + mR * 0.6;
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
  const lines: Line[] = [
    { text: rc.info.model, spec: { size: 2.6 * t, weight: 700, family: F, color: C.text, align: 'center' } },
    { text: join(rc.info.params, '   '), spec: { size: 2 * t, weight: 400, family: F, color: C.sub, align: 'center' } },
    { text: join([rc.info.lens, rc.info.date, rc.info.artist], '   '), spec: { size: 1.6 * t, family: F, color: C.sub, align: 'center' } },
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
