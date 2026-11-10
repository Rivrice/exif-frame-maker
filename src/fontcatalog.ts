// アプリに内蔵するフォントの一覧。
// すべて SIL Open Font License 1.1 または Apache License 2.0 のフォントで、
// 商用利用・アプリやWebサイトへの組み込み・配布が認められています（ライセンス文は THIRD_PARTY_LICENSES.txt に同梱）。
// 日本語フォントは容量が大きいため1ウェイトのみ同梱し、使う文字の分だけ読み込みます。

// ---- 欧文フォント ----
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/inter/800-italic.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/800.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/cormorant-garamond/700-italic.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/700.css';
import '@fontsource/raleway/400.css';
import '@fontsource/raleway/700.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/josefin-sans/400.css';
import '@fontsource/josefin-sans/700.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/righteous/400.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/700.css';
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/libre-baskerville/700.css';
import '@fontsource/bodoni-moda/400.css';
import '@fontsource/bodoni-moda/700.css';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/abril-fatface/400.css';
import '@fontsource/roboto-slab/400.css';
import '@fontsource/roboto-slab/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/dancing-script/400.css';
import '@fontsource/dancing-script/700.css';
import '@fontsource/pacifico/400.css';

// ---- 日本語フォント ----
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/zen-kaku-gothic-new/500.css';
import '@fontsource/m-plus-rounded-1c/500.css';
import '@fontsource/zen-maru-gothic/500.css';
import '@fontsource/shippori-mincho/500.css';
import '@fontsource/klee-one/600.css';
import '@fontsource/yusei-magic/400.css';
import '@fontsource/dela-gothic-one/400.css';

export type FontLang = 'ja' | 'latin';

export interface FontInfo {
  family: string;
  /** 選択肢に出す名前 */
  label: string;
  /** ja = 日本語にも対応 / latin = 欧文（英数字）のみ */
  lang: FontLang;
  kind: string;
}

export const FONT_CATALOG: FontInfo[] = [
  // 日本語対応
  { family: 'Noto Sans JP', label: 'Noto Sans JP', lang: 'ja', kind: 'ゴシック' },
  { family: 'Zen Kaku Gothic New', label: 'Zen角ゴシック New', lang: 'ja', kind: 'ゴシック' },
  { family: 'M PLUS Rounded 1c', label: 'M PLUS Rounded 1c', lang: 'ja', kind: '丸ゴシック' },
  { family: 'Zen Maru Gothic', label: 'Zen丸ゴシック', lang: 'ja', kind: '丸ゴシック' },
  { family: 'Shippori Mincho', label: 'しっぽり明朝', lang: 'ja', kind: '明朝' },
  { family: 'Klee One', label: 'クレー One', lang: 'ja', kind: '手書き風' },
  { family: 'Yusei Magic', label: '油性マジック', lang: 'ja', kind: '手書き風' },
  { family: 'Dela Gothic One', label: 'デラゴシック One', lang: 'ja', kind: '極太' },
  // 欧文のみ
  { family: 'Inter', label: 'Inter', lang: 'latin', kind: 'サンセリフ' },
  { family: 'Montserrat', label: 'Montserrat', lang: 'latin', kind: 'サンセリフ' },
  { family: 'Poppins', label: 'Poppins', lang: 'latin', kind: 'サンセリフ' },
  { family: 'Raleway', label: 'Raleway', lang: 'latin', kind: 'サンセリフ' },
  { family: 'Space Grotesk', label: 'Space Grotesk', lang: 'latin', kind: 'サンセリフ' },
  { family: 'Josefin Sans', label: 'Josefin Sans', lang: 'latin', kind: 'サンセリフ' },
  { family: 'Oswald', label: 'Oswald', lang: 'latin', kind: '細長' },
  { family: 'Bebas Neue', label: 'Bebas Neue', lang: 'latin', kind: '細長' },
  { family: 'Archivo Black', label: 'Archivo Black', lang: 'latin', kind: '極太' },
  { family: 'Righteous', label: 'Righteous', lang: 'latin', kind: 'ディスプレイ' },
  { family: 'Playfair Display', label: 'Playfair Display', lang: 'latin', kind: 'セリフ' },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', lang: 'latin', kind: 'セリフ' },
  { family: 'Lora', label: 'Lora', lang: 'latin', kind: 'セリフ' },
  { family: 'Libre Baskerville', label: 'Libre Baskerville', lang: 'latin', kind: 'セリフ' },
  { family: 'Bodoni Moda', label: 'Bodoni Moda', lang: 'latin', kind: 'セリフ' },
  { family: 'DM Serif Display', label: 'DM Serif Display', lang: 'latin', kind: 'セリフ' },
  { family: 'Abril Fatface', label: 'Abril Fatface', lang: 'latin', kind: 'セリフ' },
  { family: 'Roboto Slab', label: 'Roboto Slab', lang: 'latin', kind: 'スラブセリフ' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono', lang: 'latin', kind: '等幅' },
  { family: 'IBM Plex Mono', label: 'IBM Plex Mono', lang: 'latin', kind: '等幅' },
  { family: 'Courier Prime', label: 'Courier Prime', lang: 'latin', kind: 'タイプライター' },
  { family: 'Caveat', label: 'Caveat', lang: 'latin', kind: '手書き' },
  { family: 'Dancing Script', label: 'Dancing Script', lang: 'latin', kind: '筆記体' },
  { family: 'Pacifico', label: 'Pacifico', lang: 'latin', kind: '筆記体' },
];

export const BUILTIN_FONTS = FONT_CATALOG.map((f) => f.family);

export function fontInfo(family: string) {
  return FONT_CATALOG.find((f) => f.family === family);
}
