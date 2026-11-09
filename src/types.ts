export interface ExifInfo {
  make: string;
  model: string;
  lens: string;
  focal: string;
  aperture: string;
  shutter: string;
  iso: string;
  date: string;
  artist: string;
}

export type ImageSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

export interface PhotoItem {
  id: string;
  name: string;
  file: File;
  source: ImageSource;
  width: number;
  height: number;
  exif: ExifInfo;
  overrides: Partial<ExifInfo>;
  thumbUrl: string;
  note?: string; // 読込時の注意（RAWプレビュー使用など）
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type CreditPosition = 'auto' | Corner;
export type CornerItem = '' | 'maker' | 'makerModel' | 'model' | 'lens' | 'params' | 'date' | 'credit';

export interface Colors {
  bg: string;
  text: string;
  sub: string;
  accent: string;
}

export interface Settings {
  layoutId: string;
  colors: Colors;
  font: string; // '' = レイアウト既定
  textScale: number;
  borderScale: number;
  aspect: string; // 'auto' | '1:1' | '4:5' | ...
  show: {
    logo: boolean;
    model: boolean;
    lens: boolean;
    focal: boolean;
    aperture: boolean;
    shutter: boolean;
    iso: boolean;
    date: boolean;
    artist: boolean;
  };
  author: string;
  credit: {
    scale: number; // クレジット（撮影者名）の文字サイズ倍率
    position: CreditPosition; // 'auto' = レイアウト内
    color: 'light' | 'dark' | 'text';
  };
  /** 四隅レイアウトで各隅に表示する項目 */
  corners: Record<Corner, CornerItem[]>;
  mode: 'single' | 'collage';
  collage: {
    type: 'justified' | 'grid';
    width: number;
    rowHeight: number; // 幅に対する比率（%）
    cols: number;
    gap: number; // 幅に対する比率（‰）
    bg: string;
  };
  export: {
    format: 'image/jpeg' | 'image/png' | 'image/webp';
    quality: number;
    maxEdge: number; // 0 = 制限なし
  };
}

export interface LogoAsset {
  image: ImageSource;
  width: number;
  height: number;
}
