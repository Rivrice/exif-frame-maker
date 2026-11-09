// カメラメーカーの判定と表示名。
// 権利面の配慮から、メーカー名は各社のロゴに似せず、全社共通の書体（レイアウトのフォント）で
// 撮影機材を説明する普通の文字として表示する。公式ロゴは同梱しない。

export interface MakerStyle {
  key: string;
  match: RegExp;
  display: string; // 表示用のメーカー名（一般的な表記）
}

export const MAKERS: MakerStyle[] = [
  { key: 'canon', match: /canon/i, display: 'Canon' },
  { key: 'nikon', match: /nikon/i, display: 'Nikon' },
  { key: 'sony', match: /sony/i, display: 'Sony' },
  { key: 'fujifilm', match: /fuji/i, display: 'Fujifilm' },
  { key: 'om', match: /om digital|om system/i, display: 'OM System' },
  { key: 'olympus', match: /olympus/i, display: 'Olympus' },
  { key: 'panasonic', match: /panasonic|lumix/i, display: 'Panasonic' },
  { key: 'leica', match: /leica/i, display: 'Leica' },
  { key: 'pentax', match: /pentax/i, display: 'Pentax' },
  { key: 'ricoh', match: /ricoh/i, display: 'Ricoh' },
  { key: 'hasselblad', match: /hasselblad/i, display: 'Hasselblad' },
  { key: 'sigma', match: /sigma/i, display: 'Sigma' },
  { key: 'apple', match: /apple/i, display: 'Apple' },
  { key: 'google', match: /google/i, display: 'Google' },
  { key: 'samsung', match: /samsung/i, display: 'Samsung' },
  { key: 'xiaomi', match: /xiaomi/i, display: 'Xiaomi' },
  { key: 'dji', match: /dji|hasselblad.*dji/i, display: 'DJI' },
  { key: 'gopro', match: /gopro/i, display: 'GoPro' },
  { key: 'kodak', match: /kodak/i, display: 'Kodak' },
  { key: 'minolta', match: /minolta/i, display: 'Minolta' },
  { key: 'phaseone', match: /phase ?one/i, display: 'Phase One' },
  { key: 'insta360', match: /insta360|arashi/i, display: 'Insta360' },
];

export function findMaker(make: string): MakerStyle | null {
  if (!make) return null;
  return MAKERS.find((m) => m.match.test(make)) ?? null;
}

export function genericMaker(make: string): MakerStyle {
  const display = make
    .replace(/\b(corporation|corp\.?|co\.?,? ?ltd\.?|inc\.?|camera ag|imaging|company)\b/gi, '')
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
