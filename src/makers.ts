// カメラメーカーの判定と表示名。
// 権利面の配慮から、メーカー名は各社のロゴに似せず、全社共通の書体（レイアウトのフォント）で
// 撮影機材を説明する普通の文字として表示する。公式ロゴは同梱しない。

export interface MakerStyle {
  key: string;
  match: RegExp;
  display: string; // 表示用のメーカー名（大文字・小文字は各社ロゴの表記に合わせる）
  /** ロゴの雰囲気に少し寄せるための書体（内蔵の一般的なフォントのみ。ロゴの形・色は再現しない） */
  font?: string;
  weight?: number;
  italic?: boolean;
  spacing?: number; // em単位の字間
}

export const MAKERS: MakerStyle[] = [
  { key: 'canon', match: /canon/i, display: 'Canon', font: 'Playfair Display', weight: 800 },
  { key: 'nikon', match: /nikon/i, display: 'Nikon', font: 'Inter', weight: 800, italic: true },
  { key: 'sony', match: /sony/i, display: 'SONY', font: 'Playfair Display', weight: 700, spacing: 0.1 },
  { key: 'fujifilm', match: /fuji/i, display: 'FUJIFILM', font: 'Montserrat', weight: 800, spacing: 0.02 },
  { key: 'om', match: /om digital|om system/i, display: 'OM SYSTEM', font: 'Montserrat', weight: 700, spacing: 0.04 },
  { key: 'olympus', match: /olympus/i, display: 'OLYMPUS', font: 'Playfair Display', weight: 700, spacing: 0.06 },
  { key: 'panasonic', match: /panasonic|lumix/i, display: 'Panasonic', font: 'Inter', weight: 800 },
  { key: 'leica', match: /leica/i, display: 'Leica', font: 'Cormorant Garamond', weight: 700, italic: true },
  { key: 'pentax', match: /pentax/i, display: 'PENTAX', font: 'Montserrat', weight: 800, spacing: 0.08 },
  { key: 'ricoh', match: /ricoh/i, display: 'RICOH', font: 'Montserrat', weight: 800, spacing: 0.05 },
  { key: 'hasselblad', match: /hasselblad/i, display: 'HASSELBLAD', font: 'Montserrat', weight: 500, spacing: 0.22 },
  { key: 'sigma', match: /sigma/i, display: 'SIGMA', font: 'Montserrat', weight: 800, spacing: 0.04 },
  { key: 'apple', match: /apple/i, display: 'Apple', font: 'Inter', weight: 600 },
  { key: 'google', match: /google/i, display: 'Google', font: 'Inter', weight: 500 },
  { key: 'samsung', match: /samsung/i, display: 'SAMSUNG', font: 'Montserrat', weight: 800, spacing: 0.08 },
  { key: 'xiaomi', match: /xiaomi/i, display: 'Xiaomi', font: 'Inter', weight: 600 },
  { key: 'dji', match: /dji|hasselblad.*dji/i, display: 'DJI', font: 'Montserrat', weight: 900, spacing: 0.04 },
  { key: 'gopro', match: /gopro/i, display: 'GoPro', font: 'Inter', weight: 800 },
  { key: 'kodak', match: /kodak/i, display: 'Kodak', font: 'Inter', weight: 800 },
  { key: 'minolta', match: /minolta/i, display: 'MINOLTA', font: 'Montserrat', weight: 700, spacing: 0.06 },
  { key: 'phaseone', match: /phase ?one/i, display: 'PHASE ONE', font: 'Montserrat', weight: 600, spacing: 0.12 },
  { key: 'insta360', match: /insta360|arashi/i, display: 'Insta360', font: 'Inter', weight: 700 },
];

export function findMaker(make: string): MakerStyle | null {
  if (!make) return null;
  return MAKERS.find((m) => m.match.test(make)) ?? null;
}

export function genericMaker(make: string): MakerStyle {
  const display = make
    .replace(/\b(corporation|corp|co|ltd|inc|camera ag|imaging|company)\b\.?/gi, '')
    .replace(/[\s,.]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { key: 'other', match: /$^/, display: display || make };
}

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** 機種名を見やすく整形（メーカー名の重複を削除、Sonyの型番をα表記に等） */
export function prettyModel(make: string, model: string): string {
  let m = (model || '').trim();
  if (!m) return '';
  // メーカー名の重複削除（"Canon EOS R5" → "EOS R5"）
  const firstWord = (make || '').split(/\s+/)[0];
  if (firstWord && m.toLowerCase().startsWith(firstWord.toLowerCase() + ' ')) {
    m = m.slice(firstWord.length + 1);
  }
  // Nikon: "Z 6_2" → "Z 6II"
  m = m.replace(/_(\d)$/, (_, d) => ROMAN[Number(d)] ?? `_${d}`);
  // Sony: "ILCE-7M4" → "α7 IV", "ILCE-7RM5" → "α7R V", "ILCE-6700" → "α6700"
  const sony = /^ILCE-(\d+)([A-Z]*?)(?:M(\d))?$/.exec(m);
  if (sony && /sony/i.test(make)) {
    const [, num, letters, gen] = sony;
    m = `α${num}${letters}${gen ? ' ' + (ROMAN[Number(gen)] ?? gen) : ''}`;
  }
  return m;
}
