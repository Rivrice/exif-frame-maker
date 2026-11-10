// マイプリセット：見た目に関わる設定を名前付きで保存する（この端末のブラウザ内に保存）
import type { Settings } from './types';

export type PresetData = Pick<
  Settings,
  'layoutId' | 'colors' | 'font' | 'fonts' | 'makerStyle' | 'textScale' | 'borderScale' | 'aspect' | 'show' | 'author' | 'credit' | 'corners'
>;

export interface MyPreset {
  id: string;
  name: string;
  createdAt: number;
  data: PresetData;
}

const KEY = 'exif-frame-maker:my-presets:v1';
const FILE_FORMAT = 'exif-frame-maker/presets';

export function pickPresetData(s: Settings): PresetData {
  return structuredClone({
    layoutId: s.layoutId,
    colors: s.colors,
    font: s.font,
    fonts: s.fonts,
    makerStyle: s.makerStyle,
    textScale: s.textScale,
    borderScale: s.borderScale,
    aspect: s.aspect,
    show: s.show,
    author: s.author,
    credit: s.credit,
    corners: s.corners,
  });
}

/** キーの順番に左右されない比較用の文字列 */
function stable(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

export function samePreset(a: PresetData, b: PresetData) {
  return stable(a) === stable(b);
}

export function loadPresets(): MyPreset[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(isPreset) : [];
  } catch {
    return [];
  }
}

export function savePresets(list: MyPreset[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function isPreset(v: unknown): v is MyPreset {
  const p = v as MyPreset;
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && !!p.data && typeof p.data.layoutId === 'string';
}

/** ファイルに書き出す内容 */
export function exportJson(list: MyPreset[]): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, presets: list }, null, 2);
}

/** 読み込んだファイルからプリセットを取り出す（不正な内容は除外） */
export function parseImport(text: string): MyPreset[] {
  const v = JSON.parse(text);
  const arr = Array.isArray(v) ? v : v?.format === FILE_FORMAT ? v.presets : null;
  if (!Array.isArray(arr)) throw new Error('マイレイアウトのファイルではありません');
  return arr.filter(isPreset).map((p) => ({ ...p, name: String(p.name).slice(0, 40) }));
}
