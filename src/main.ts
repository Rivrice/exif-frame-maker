import './fontcatalog';
import './style.css';

import { zipSync } from 'fflate';
import { ACCEPT, decodeFile, makeThumb } from './decode';
import { buildInfo } from './draw';
import { CORNER_KEYS, LAYOUTS, getLayout } from './layouts';
import { getLogo, logoOrigin, removeUserLogo, setUserLogo } from './logos';
import { MAKERS } from './makers';
import { IS_IOS, canvasToBlob, preloadFonts, renderOutput, renderPreview } from './render';
import type { Colors, Corner, CornerItem, CreditPosition, ExifInfo, FontRole, PhotoItem, Settings } from './types';
import { IS_NATIVE, nativeSave, nativeShare, onBackButton } from './native';
import { FONT_CATALOG, fontInfo, type FontLang } from './fontcatalog';
import { cleanFamily, importFont, isFontAvailable, loadUserFonts, removeFont, userFonts } from './fonts';
import { hexToHsl, hslToHex, loadHistory, normalizeHex, pushHistory, rgbToHex } from './colorutil';
import { closeViewer, isViewerOpen, openViewer } from './viewer';
import { exportJson, loadPresets, parseImport, pickPresetData, samePreset, savePresets, type MyPreset } from './presets';

// ---------- 状態 ----------

const STORAGE_KEY = 'exif-frame-maker:settings:v1';

const DEFAULTS: Settings = {
  layoutId: 'classic',
  colors: { ...LAYOUTS[0].colors },
  font: '',
  fonts: { maker: '', model: '', lens: '', params: '', date: '', credit: '' },
  makerStyle: true,
  textScale: 1,
  borderScale: 1,
  aspect: 'auto',
  show: { logo: true, model: true, lens: true, focal: true, aperture: true, shutter: true, iso: true, date: true, artist: true },
  author: '',
  credit: { scale: 1, position: 'auto', color: 'light' },
  corners: { tl: 'makerModel', tr: 'date', bl: 'params', br: 'credit' },
  export: { format: 'image/jpeg', quality: 0.92, maxEdge: 0 },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const obj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = (v: any, def: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const oneOf = <T extends string>(v: any, list: readonly T[], def: T): T => (list.includes(v) ? v : def);
const HEX = /^#[0-9a-f]{6}$/i;
const FONT_ROLES: FontRole[] = ['maker', 'model', 'lens', 'params', 'date', 'credit'];
// 読み込んだフォントは後から登録されるので、名前として安全な文字列なら受け入れる
const fontName = (v: any) => (typeof v === 'string' ? cleanFamily(v) : '');
const ASPECTS = ['auto', '1:1', '4:5', '3:4', '2:3', '9:16', '3:2', '16:9'] as const;
const CORNER_ITEMS: CornerItem[] = ['', 'maker', 'makerModel', 'model', 'lens', 'params', 'date', 'credit'];

/**
 * 保存データ・読み込んだプリセットを検証し、足りない／不正な項目は既定値で補う。
 * （壊れた値が保存されると、再読み込みしても描画できなくなるのを防ぐ）
 */
function mergeSettings(raw: any): Settings {
  const r = obj(raw);
  const fo = obj(r.fonts);
  const c = obj(r.colors), sh = obj(r.show), cr = obj(r.credit), co = obj(r.corners), ex = obj(r.export);
  const D = DEFAULTS;
  const color = (k: keyof Colors) => (typeof c[k] === 'string' && HEX.test(c[k]) ? c[k] : D.colors[k]);
  const show = {} as Settings['show'];
  for (const k of Object.keys(D.show) as (keyof Settings['show'])[]) show[k] = typeof sh[k] === 'boolean' ? sh[k] : D.show[k];
  const corners = {} as Settings['corners'];
  for (const k of CORNER_KEYS) corners[k] = oneOf(co[k], CORNER_ITEMS, D.corners[k]);
  return {
    layoutId: getLayout(typeof r.layoutId === 'string' ? r.layoutId : D.layoutId).id,
    colors: { bg: color('bg'), text: color('text'), sub: color('sub'), accent: color('accent') },
    font: fontName(r.font),
    fonts: Object.fromEntries(FONT_ROLES.map((k) => [k, fontName(fo[k])])) as Settings['fonts'],
    makerStyle: typeof r.makerStyle === 'boolean' ? r.makerStyle : D.makerStyle,
    textScale: num(r.textScale, D.textScale, 0.5, 1.8),
    borderScale: num(r.borderScale, D.borderScale, 0.3, 2.5),
    aspect: oneOf(r.aspect, ASPECTS, 'auto'),
    show,
    author: typeof r.author === 'string' ? r.author.slice(0, 100) : '',
    credit: {
      scale: num(cr.scale, D.credit.scale, 0.5, 3),
      position: oneOf(cr.position, ['auto', 'tl', 'tr', 'bl', 'br'] as const, 'auto'),
      color: oneOf(cr.color, ['light', 'dark', 'text'] as const, 'light'),
    },
    corners,
    export: {
      format: oneOf(ex.format, ['image/jpeg', 'image/png', 'image/webp'] as const, 'image/jpeg'),
      quality: num(ex.quality, D.export.quality, 0.5, 1),
      maxEdge: [0, 6000, 4096, 3000, 2048, 1080].includes(ex.maxEdge) ? ex.maxEdge : 0,
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw) return mergeSettings(raw);
  } catch {
    /* noop */
  }
  return structuredClone(DEFAULTS);
}

let settings = loadSettings();
const photos: PhotoItem[] = [];
let refreshStripToggle = () => {};
let selectedId = '';
let sample: PhotoItem | null = null;

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* noop */
  }
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];

function toast(msg: string, ms = 3500, action?: { label: string; run: () => void }) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', () => {
      t.hidden = true;
      action.run();
    });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout((t as any)._timer);
  (t as any)._timer = setTimeout(() => (t.hidden = true), ms);
}

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- サンプル写真（未読込時のプレビュー用） ----------

function makeSample(): PhotoItem {
  const c = document.createElement('canvas');
  c.width = 1800;
  c.height = 1200;
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, 1200);
  sky.addColorStop(0, '#f7b267');
  sky.addColorStop(0.45, '#f4845f');
  sky.addColorStop(1, '#2d3047');
  x.fillStyle = sky;
  x.fillRect(0, 0, 1800, 1200);
  x.fillStyle = 'rgba(255,240,200,0.9)';
  x.beginPath();
  x.arc(1250, 560, 120, 0, Math.PI * 2);
  x.fill();
  const layers = ['#5b4e77', '#3f3a5e', '#262640'];
  layers.forEach((col, i) => {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, 1200);
    for (let px = 0; px <= 1800; px += 30) {
      const y = 700 + i * 140 + Math.sin(px / (180 + i * 60) + i) * (90 - i * 15) + Math.sin(px / 47 + i * 3) * 12;
      x.lineTo(px, y);
    }
    x.lineTo(1800, 1200);
    x.closePath();
    x.fill();
  });
  return {
    id: 'sample',
    name: 'sample.jpg',
    file: new File([], 'sample.jpg'),
    source: c,
    width: c.width,
    height: c.height,
    thumbUrl: '',
    overrides: {},
    exif: {
      make: 'FUJIFILM',
      model: 'X-T5',
      lens: 'XF16-55mmF2.8 R LM WR',
      focal: '23mm',
      aperture: 'f/5.6',
      shutter: '1/250s',
      iso: 'ISO200',
      date: '2026.11.09 16:42',
      artist: '',
    },
  };
}

function current(): PhotoItem {
  return photos.find((p) => p.id === selectedId) ?? photos[0] ?? (sample ??= makeSample());
}

// ---------- 写真の読み込み ----------

/** 読み込みは順番に処理する（読み込み中に追加しても処理が重ならないように） */
let addQueue: Promise<void> = Promise.resolve();
function addFiles(files: FileList | File[]) {
  const list = [...files];
  addQueue = addQueue.then(() => addFilesNow(list)).catch((e) => console.error(e));
}

async function addFilesNow(files: File[]) {
  const list = files.filter((f) => f.size > 0);
  if (!list.length) return;
  setBusy(true);
  let ok = 0;
  const errors: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    setProgress(`読み込み中… ${i + 1}/${list.length}  ${f.name}`);
    try {
      const d = await decodeFile(f);
      limitSourceSize(d);
      const item: PhotoItem = {
        id: uid(),
        name: f.name,
        file: f,
        source: d.source,
        width: d.width,
        height: d.height,
        exif: d.exif,
        overrides: {},
        thumbUrl: await makeThumb(d.source, d.width, d.height),
        note: d.note,
      };
      photos.push(item);
      if (!selectedId) selectedId = item.id;
      ok++;
      renderList();
    } catch (e) {
      console.error(e);
      errors.push(`${f.name}: ${(e as Error).message || '読み込み失敗'}`);
    }
  }
  setProgress('');
  setBusy(false);
  if (errors.length) toast(`${errors.length}件読み込めませんでした\n${errors.slice(0, 3).join('\n')}`, 6000);
  else if (ok) toast(`${ok}枚読み込みました`);
  refreshAll();
}

/** スマホではメモリ不足を避けるため、極端に大きい画像を読み込み時に縮小しておく */
const IS_MOBILE = IS_IOS || /Android|Mobi/i.test(navigator.userAgent);
const MOBILE_MAX_AREA = 16_000_000;
function limitSourceSize(d: { source: PhotoItem['source']; width: number; height: number }) {
  if (!IS_MOBILE) return;
  const area = d.width * d.height;
  if (area <= MOBILE_MAX_AREA) return;
  const k = Math.sqrt(MOBILE_MAX_AREA / area);
  const c = document.createElement('canvas');
  c.width = Math.round(d.width * k);
  c.height = Math.round(d.height * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(d.source, 0, 0, c.width, c.height);
  if (d.source instanceof ImageBitmap) d.source.close();
  d.source = c;
  d.width = c.width;
  d.height = c.height;
}

// ---------- 描画 ----------

let previewToken = 0;
let thumbsToken = 0;
let previewTimer = 0;
let thumbsTimer = 0;

function schedulePreview(delay = 30) {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(drawPreview, delay);
}

function scheduleThumbs(delay = 200) {
  clearTimeout(thumbsTimer);
  thumbsTimer = window.setTimeout(drawPresetThumbs, delay);
}

async function drawPreview() {
  const token = ++previewToken;
  const stage = $('#stage');
  const target = Math.min(IS_MOBILE ? 1600 : 2400, Math.max(stage.clientWidth, stage.clientHeight, 300) * Math.min(2, devicePixelRatio || 1));
  const p = current();
  let out: HTMLCanvasElement;
  try {
    out = await renderPreview(p, settings, target);
  } catch (e) {
    console.error(e);
    return;
  }
  if (token !== previewToken) return;
  const cv = $<HTMLCanvasElement>('#preview');
  cv.width = out.width;
  cv.height = out.height;
  cv.getContext('2d')!.drawImage(out, 0, 0);
  requestAnimationFrame(placeZoomBtn);
  const lay = getLayout(settings.layoutId);
  $('#meta').textContent = `${p.id === 'sample' ? 'サンプル画像' : p.name}　${p.width}×${p.height}　${lay.name}${p.note ? `　(${p.note})` : ''}`;
}

async function drawPresetThumbs() {
  const token = ++thumbsToken;
  const p = current();
  for (const lay of LAYOUTS) {
    if (token !== thumbsToken) return;
    const s: Settings = { ...settings, layoutId: lay.id, colors: lay.id === settings.layoutId ? settings.colors : lay.colors, aspect: 'auto', font: settings.font };
    const out = await renderPreview(p, s, 260);
    const cv = document.querySelector<HTMLCanvasElement>(`[data-layout="${lay.id}"] canvas`);
    if (!cv) continue;
    cv.width = out.width;
    cv.height = out.height;
    cv.getContext('2d')!.drawImage(out, 0, 0);
    await new Promise((r) => setTimeout(r, 0));
  }
  for (const mp of myPresets) {
    if (token !== thumbsToken) return;
    const s = { ...mergeSettings({ ...settings, ...mp.data }), aspect: 'auto' };
    const out = await renderPreview(p, s, 260);
    const cv = document.querySelector<HTMLCanvasElement>(`[data-mp="${mp.id}"] canvas`);
    if (!cv) continue;
    cv.width = out.width;
    cv.height = out.height;
    cv.getContext('2d')!.drawImage(out, 0, 0);
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ---------- マイプリセット ----------

// 保存データも検証して、壊れた値があれば既定値で補う
let myPresets: MyPreset[] = loadPresets().map((p) => ({ ...p, data: pickPresetData(mergeSettings(p.data)) }));
let mpTarget: MyPreset | null = null;

function persistPresets() {
  if (!savePresets(myPresets)) toast('保存できませんでした（ブラウザの保存領域を確認してください）');
}

function renderMyPresets() {
  const box = $('#myPresets');
  box.innerHTML = '';
  $('#myPresetPanel').hidden = myPresets.length === 0;
  const now = pickPresetData(settings);
  for (const mp of myPresets) {
    const b = document.createElement('button');
    b.className = 'preset my' + (samePreset(mp.data, now) ? ' active' : '');
    b.dataset.mp = mp.id;
    b.title = mp.name;
    b.innerHTML = `<div class="pv"><canvas></canvas></div><span></span><i class="mp-more" aria-label="メニュー">⋯</i>`;
    b.querySelector('span')!.textContent = mp.name;
    b.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.mp-more')) openMpSheet(mp);
      else applyPreset(mp);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMpSheet(mp);
    });
    box.appendChild(b);
  }
}

function markActivePreset() {
  const now = pickPresetData(settings);
  for (const mp of myPresets) {
    document.querySelector(`[data-mp="${mp.id}"]`)?.classList.toggle('active', samePreset(mp.data, now));
  }
}

function applyPreset(mp: MyPreset) {
  settings = mergeSettings({ ...settings, ...structuredClone(mp.data) });
  update();
  toast(`「${mp.name}」を適用しました`);
}

function askName(def: string): string | null {
  const v = prompt('レイアウトの名前', def);
  if (v === null) return null;
  const name = v.trim().slice(0, 40);
  return name || def;
}

function savePresetFromCurrent() {
  const lay = getLayout(settings.layoutId);
  const name = askName(`${lay.name} ${myPresets.length + 1}`);
  if (name === null) return;
  myPresets.push({ id: uid(), name, createdAt: Date.now(), data: pickPresetData(settings) });
  persistPresets();
  renderMyPresets();
  scheduleThumbs(0);
  toast(`「${name}」を保存しました`);
}

function openMpSheet(mp: MyPreset) {
  mpTarget = mp;
  $('#mpSheetTitle').textContent = mp.name;
  $('#mpSheet').hidden = false;
}

function closeMpSheet() {
  mpTarget = null;
  $('#mpSheet').hidden = true;
}

function bindMyPresets() {
  $('#mpApply').addEventListener('click', () => {
    if (mpTarget) applyPreset(mpTarget);
    closeMpSheet();
  });
  $('#mpOverwrite').addEventListener('click', () => {
    if (!mpTarget) return;
    if (!confirm(`「${mpTarget.name}」を今の設定で上書きしますか？`)) return;
    mpTarget.data = pickPresetData(settings);
    persistPresets();
    renderMyPresets();
    scheduleThumbs(0);
    toast('上書き保存しました');
    closeMpSheet();
  });
  $('#mpRename').addEventListener('click', () => {
    if (!mpTarget) return;
    const name = askName(mpTarget.name);
    if (name === null) return;
    mpTarget.name = name;
    persistPresets();
    renderMyPresets();
    scheduleThumbs(0);
    closeMpSheet();
  });
  $('#mpDelete').addEventListener('click', () => {
    if (!mpTarget) return;
    if (!confirm(`「${mpTarget.name}」を削除しますか？`)) return;
    myPresets = myPresets.filter((p) => p !== mpTarget);
    persistPresets();
    renderMyPresets();
    scheduleThumbs(0);
    closeMpSheet();
  });
  $('#mpClose').addEventListener('click', closeMpSheet);
  $('#mpSheet').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMpSheet();
  });
  $('#mpExport').addEventListener('click', async () => {
    if (!myPresets.length) return toast('保存したマイレイアウトがありません');
    const file = new File([exportJson(myPresets)], `exif-frame-layouts_${new Date().toISOString().slice(0, 10)}.json`, {
      type: 'application/json',
    });
    await deliver([file], false);
  });
  $<HTMLInputElement>('#mpImport').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const list = parseImport(await f.text());
      if (!list.length) return toast('読み込めるレイアウトがありませんでした');
      const ids = new Set(myPresets.map((p) => p.id));
      let added = 0;
      for (const p of list) {
        if (ids.has(p.id) && myPresets.some((q) => q.id === p.id && samePreset(q.data, p.data) && q.name === p.name)) continue;
        const id = ids.has(p.id) ? uid() : p.id;
        ids.add(id);
        myPresets.push({ ...p, id, data: pickPresetData(mergeSettings({ ...settings, ...p.data })) });
        added++;
      }
      persistPresets();
      renderMyPresets();
      scheduleThumbs(0);
      toast(added ? `${added}件のレイアウトを読み込みました` : 'すべて読み込み済みのレイアウトでした');
    } catch (err) {
      toast('読み込めませんでした: ' + (err as Error).message);
    }
  });
}

function refreshAll() {
  renderList();
  renderControls();
  markActivePreset();
  renderExifForm();
  renderMakers();
  schedulePreview();
  scheduleThumbs();
}

// ---------- UI：写真リスト ----------

function renderList() {
  const ul = $('#list');
  ul.innerHTML = '';
  $('#count').textContent = `${photos.length}枚`;
  refreshStripToggle();
  for (const p of photos) {
    const li = document.createElement('li');
    li.className = p.id === selectedId ? 'active' : '';
    const info = buildInfo(p, settings);
    li.innerHTML = `
      <img alt="" src="${p.thumbUrl}" />
      <div class="pl-text">
        <span class="pl-name"></span>
        <span class="pl-sub"></span>
      </div>
      <button class="pl-del" title="削除" aria-label="削除">×</button>`;
    li.querySelector('.pl-name')!.textContent = p.name;
    li.querySelector('.pl-sub')!.textContent = [info.maker?.display, info.model].filter(Boolean).join(' ') || 'Exif情報なし';
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.pl-del')) {
        if (busy) return toast('処理中は削除できません');
        const i = photos.indexOf(p);
        photos.splice(i, 1);
        URL.revokeObjectURL(p.thumbUrl);
        if (p.source instanceof ImageBitmap) p.source.close();
        if (selectedId === p.id) selectedId = photos[Math.min(i, photos.length - 1)]?.id ?? '';
      } else {
        selectedId = p.id;
      }
      refreshAll();
    });
    ul.appendChild(li);
  }
}

// ---------- UI：コントロール ----------

const TOGGLES: [keyof Settings['show'], string][] = [
  ['logo', 'メーカー名'],
  ['model', '機種'],
  ['lens', 'レンズ'],
  ['focal', '焦点距離'],
  ['aperture', 'F値'],
  ['shutter', 'シャッター速度'],
  ['iso', 'ISO'],
  ['date', '撮影日時'],
  ['artist', '撮影者'],
];

const PALETTES: { name: string; c: Colors }[] = [
  { name: 'ホワイト', c: { bg: '#ffffff', text: '#1a1a1a', sub: '#8a8a8a', accent: '#d0d0d0' } },
  { name: 'ブラック', c: { bg: '#111111', text: '#f5f5f5', sub: '#9a9a9a', accent: '#444444' } },
  { name: 'クリーム', c: { bg: '#f5efe3', text: '#3b3226', sub: '#9b8b73', accent: '#d8c9ae' } },
  { name: 'ネイビー', c: { bg: '#172338', text: '#f2f4f8', sub: '#8fa0bd', accent: '#e2b04a' } },
  { name: 'セージ', c: { bg: '#dfe6da', text: '#2f3b2c', sub: '#6f8068', accent: '#a9b9a1' } },
  { name: 'ローズ', c: { bg: '#f6e3e1', text: '#4a2b2b', sub: '#a77a76', accent: '#d9a5a0' } },
  { name: 'スレート', c: { bg: '#3a3f47', text: '#ffffff', sub: '#b6bcc6', accent: '#7fb3ff' } },
  { name: 'レトロ', c: { bg: '#1e1a16', text: '#f3e6c8', sub: '#a08c6a', accent: '#ff8a3d' } },
];

function buildStaticControls() {
  // プリセット
  const presets = $('#presets');
  for (const lay of LAYOUTS) {
    const b = document.createElement('button');
    b.className = 'preset';
    b.dataset.layout = lay.id;
    b.title = lay.desc;
    b.innerHTML = `<div class="pv"><canvas></canvas></div><span></span>`;
    b.querySelector('span')!.textContent = lay.name;
    b.addEventListener('click', () => {
      settings.layoutId = lay.id;
      settings.colors = { ...lay.colors }; // プリセット選択でそのレイアウトの初期色に
      update();
      scheduleThumbs(0);
    });
    presets.appendChild(b);
  }
  // レイアウト一覧の最後に「＋」の枠：今の設定をマイレイアウトに保存
  const add = document.createElement('div');
  add.className = 'preset mp-add';
  add.innerHTML =
    '<button class="mp-add-plus" title="今の設定をマイレイアウトに保存" aria-label="今の設定をマイレイアウトに保存"><b>＋</b></button>' +
    '<button class="mp-add-label" title="今の設定をマイレイアウトに保存">レイアウト<wbr>を保存</button>';
  add.querySelector('.mp-add-plus')!.addEventListener('click', savePresetFromCurrent);
  add.querySelector('.mp-add-label')!.addEventListener('click', savePresetFromCurrent);
  $('#mpImportLink').addEventListener('click', () => $<HTMLInputElement>('#mpImport').click());
  presets.appendChild(add);

  // パレット
  const sw = $('#swatches');
  for (const p of PALETTES) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = p.name;
    b.style.background = `linear-gradient(135deg, ${p.c.bg} 0 55%, ${p.c.text} 55% 75%, ${p.c.accent} 75%)`;
    b.addEventListener('click', () => {
      settings.colors = { ...p.c };
      update();
    });
    sw.appendChild(b);
  }

  bindColorEditor();
  bindCustomColor();
  bindStripToggle();
  bindResetText();
  $('#resetColors').addEventListener('click', () => {
    settings.colors = { ...getLayout(settings.layoutId).colors };
    update();
  });

  // 表示項目
  const tg = $('#toggles');
  for (const [k, label] of TOGGLES) {
    const l = document.createElement('label');
    l.className = 'chip';
    l.innerHTML = `<input type="checkbox" data-show="${k}" /><span>${label}</span>`;
    tg.appendChild(l);
  }
  $$<HTMLInputElement>('[data-show]').forEach((inp) =>
    inp.addEventListener('change', () => {
      settings.show[inp.dataset.show as keyof Settings['show']] = inp.checked;
      update();
    }),
  );

  const bindRange = (id: string, get: () => number, set: (v: number) => void, fmt: (v: number) => string, thumbs = true) => {
    const el = $<HTMLInputElement>('#' + id);
    el.addEventListener('input', () => {
      set(Number(el.value));
      $('#' + id + 'Out').textContent = fmt(get());
      update(thumbs);
    });
  };
  bindRange('textScale', () => settings.textScale, (v) => (settings.textScale = v), (v) => `${Math.round(v * 100)}%`);
  bindRange('creditScale', () => settings.credit.scale, (v) => (settings.credit.scale = v), (v) => `${Math.round(v * 100)}%`);
  bindRange('borderScale', () => settings.borderScale, (v) => (settings.borderScale = v), (v) => `${Math.round(v * 100)}%`);
  bindRange('quality', () => settings.export.quality, (v) => (settings.export.quality = v), (v) => `${Math.round(v * 100)}`, false);

  const bindSelect = (id: string, set: (v: string) => void, thumbs = true) =>
    $<HTMLSelectElement>('#' + id).addEventListener('change', (e) => {
      set((e.target as HTMLSelectElement).value);
      update(thumbs);
    });
  bindSelect('font', (v) => (settings.font = v));
  bindFonts();
  bindSelect('aspect', (v) => (settings.aspect = v));
  bindSelect('format', (v) => (settings.export.format = v as Settings['export']['format']), false);
  bindSelect('maxEdge', (v) => (settings.export.maxEdge = Number(v)), false);
  // クレジットの位置
  $$('#creditPos [data-pos]').forEach((b) =>
    b.addEventListener('click', () => {
      settings.credit.position = b.dataset.pos as CreditPosition;
      update();
    }),
  );
  bindSelect('creditColor', (v) => (settings.credit.color = v as Settings['credit']['color']));

  // 四隅の項目
  const grid = $('#cornerGrid');
  const CORNER_LABEL: Record<Corner, string> = { tl: '左上', tr: '右上', bl: '左下', br: '右下' };
  const ITEMS: [CornerItem, string][] = [
    ['', 'なし'],
    ['makerModel', 'メーカー名＋機種'],
    ['maker', 'メーカー名'],
    ['model', '機種'],
    ['lens', 'レンズ'],
    ['params', '撮影設定'],
    ['date', '撮影日時'],
    ['credit', 'クレジット'],
  ];
  for (const k of CORNER_KEYS) {
    const l = document.createElement('label');
    l.innerHTML = `<span>${CORNER_LABEL[k]}</span><select data-corner="${k}">${ITEMS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`;
    l.querySelector('select')!.addEventListener('change', (e) => {
      settings.corners[k] = (e.target as HTMLSelectElement).value as CornerItem;
      update();
    });
    grid.appendChild(l);
  }

  $<HTMLInputElement>('#author').addEventListener('input', (e) => {
    settings.author = (e.target as HTMLInputElement).value;
    update();
  });

  // ファイル
  const file = $<HTMLInputElement>('#file');
  file.accept = IS_NATIVE ? '' : ACCEPT; // Androidアプリでは拡張子指定が効かないため全ファイルを許可
  if (IS_NATIVE) $<HTMLInputElement>('#mpImport').accept = '';
  file.addEventListener('change', () => {
    if (file.files) addFiles(file.files);
    file.value = '';
  });
  const drop = $('#drop');
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) drop.classList.remove('over');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });
  $('#clear').addEventListener('click', () => {
    if (busy) return;
    for (const p of photos) {
      URL.revokeObjectURL(p.thumbUrl);
      if (p.source instanceof ImageBitmap) p.source.close();
    }
    photos.length = 0;
    selectedId = '';
    refreshAll();
  });

  $('#resetExif').addEventListener('click', () => {
    const p = current();
    p.overrides = {};
    renderExifForm();
    update();
  });

  $('#saveOne').addEventListener('click', () => exportPhotos([current()], false));
  $('#saveZip').addEventListener('click', () => exportPhotos(photos, true));
  $('#saveAll').addEventListener('click', () => exportPhotos(photos, false));

  window.addEventListener('resize', () => {
    schedulePreview(150);
    placeZoomBtn();
  });
  $('#zoomBtn').addEventListener('click', openZoom);
  // Androidアプリの「戻る」：開いている画面を閉じる。何も開いていなければアプリを終了
  onBackButton(() => {
    if (isViewerOpen()) return closeViewer(), true;
    if (picking) return stopPicking(), true;
    for (const id of ['#shareSheet', '#aboutSheet', '#mpSheet', '#resetSheet']) {
      if (!$(id).hidden) {
        if (id === '#shareSheet') closeShare();
        else if (id === '#mpSheet') closeMpSheet();
        else $(id).hidden = true;
        return true;
      }
    }
    return false;
  });

  // スマホ用タブ
  document.body.dataset.tab = 'layout';
  $$('#tabbar [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.tab !== 'color') {
        stopPicking();
        commitHistory();
      }
      document.body.dataset.tab = b.dataset.tab!;
      $$('#tabbar [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      $('.panel.right').scrollTop = 0;
    }),
  );

  // このアプリについて
  $('#aboutBtn').addEventListener('click', () => ($('#aboutSheet').hidden = false));
  $('#aboutClose').addEventListener('click', () => ($('#aboutSheet').hidden = true));
  $('#aboutSheet').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#aboutSheet').hidden = true;
  });

  // 書き出し完了シート
  $('#shareBtn').addEventListener('click', async () => {
    if (!pending) return;
    try {
      if (IS_NATIVE) await nativeShare(pending.files);
      else await navigator.share({ files: pending.files });
      closeShare();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('共有できませんでした。ダウンロードをお試しください');
    }
  });
  $('#shareDl').addEventListener('click', async () => {
    if (!pending) return;
    if (IS_NATIVE) {
      try {
        const dir = await nativeSave(pending.files);
        toast(`${pending.files.length}件を「${dir}」に保存しました`);
      } catch (e) {
        toast('保存できませんでした: ' + (e as Error).message);
        return;
      }
    } else {
      await downloadFiles(pending.files, pending.zip);
    }
    closeShare();
  });
  $('#shareClose').addEventListener('click', closeShare);
  $('#shareSheet').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeShare();
  });
}

function renderControls() {
  $$('.preset[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === settings.layoutId));
  syncColorEditor();
  syncResetText();
  $$<HTMLInputElement>('[data-show]').forEach((inp) => (inp.checked = settings.show[inp.dataset.show as keyof Settings['show']]));
  const set = (id: string, v: string | number) => (($('#' + id) as HTMLInputElement).value = String(v));
  const out = (id: string, v: string) => ($('#' + id + 'Out').textContent = v);
  fillFontSelects();
  $<HTMLInputElement>('#makerStyle').checked = settings.makerStyle;
  set('aspect', settings.aspect);
  set('textScale', settings.textScale);
  out('textScale', `${Math.round(settings.textScale * 100)}%`);
  set('borderScale', settings.borderScale);
  out('borderScale', `${Math.round(settings.borderScale * 100)}%`);
  set('format', settings.export.format);
  set('quality', settings.export.quality);
  out('quality', `${Math.round(settings.export.quality * 100)}`);
  set('maxEdge', settings.export.maxEdge);
  set('author', settings.author);
  set('creditScale', settings.credit.scale);
  out('creditScale', `${Math.round(settings.credit.scale * 100)}%`);
  set('creditColor', settings.credit.color);
  const cornerLayout = !!getLayout(settings.layoutId).corners;
  $$('#creditPos [data-pos]').forEach((b) => {
    b.classList.toggle('active', b.dataset.pos === settings.credit.position);
    (b as HTMLButtonElement).disabled = cornerLayout;
  });
  $('#creditColorField').hidden = cornerLayout || settings.credit.position === 'auto';
  $('#creditHint').textContent = cornerLayout
    ? '四隅レイアウトでは、レイアウト画面の「四隅に表示する項目」でクレジットの位置を選びます。'
    : settings.show.artist
      ? ''
      : '「表示する項目」で撮影者がオフになっています。';
  $('#cornerPanel').hidden = !cornerLayout;
  $$<HTMLSelectElement>('[data-corner]').forEach((sel) => (sel.value = settings.corners[sel.dataset.corner as Corner]));

  const hasPhotos = photos.length > 0;
  for (const id of ['saveOne', 'saveZip', 'saveAll']) $<HTMLButtonElement>('#' + id).disabled = !hasPhotos;
}

function update(thumbs = true) {
  saveSettings();
  renderControls();
  markActivePreset();
  schedulePreview();
  if (thumbs) scheduleThumbs();
}

// ---------- UI：カラー（色の調整・スポイト・履歴） ----------

let colorTarget: keyof Colors = 'bg';
let colorHistory = loadHistory();
let picking = false;
/** スライダー操作中は値の丸めで色相が飛ばないよう、HSLを保持しておく */
let hsl: [number, number, number] = [0, 0, 0];

/** カスタムカラーで最後に決めた色（別の項目に切り替えたときに「最近使った色」へ記録する） */
let lastCustom: string | null = null;

function setColor(hex: string, commit: boolean) {
  settings.colors[colorTarget] = hex;
  lastCustom = hex;
  update(commit);
}

/** 調整中の色を「最近使った色」に記録する（項目の切り替え・タブの移動・スイッチオフ・アプリを離れるとき） */
function commitHistory() {
  if (!lastCustom) return;
  colorHistory = pushHistory(colorHistory, lastCustom);
  lastCustom = null;
  renderHistory();
}

function sliderBg() {
  const [h, s, l] = hsl;
  $('#ceH').style.background = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((x) => hslToHex(x, Math.max(s, 60), 50)).join(',')})`;
  $('#ceS').style.background = `linear-gradient(to right, ${hslToHex(h, 0, l)}, ${hslToHex(h, 100, l)})`;
  $('#ceL').style.background = `linear-gradient(to right, #000, ${hslToHex(h, s, 50)}, #fff)`;
}

function syncColorEditor(keepHsl = false) {
  const hex = settings.colors[colorTarget];
  if (!keepHsl) hsl = hexToHsl(hex);
  $$('#colorTargets [data-target]').forEach((b) => {
    const k = b.dataset.target as keyof Colors;
    b.classList.toggle('active', k === colorTarget);
    b.setAttribute('aria-selected', String(k === colorTarget));
    b.querySelector('i')!.style.background = settings.colors[k];
  });
  $('#cePreview').style.background = hex;
  const hexInput = $<HTMLInputElement>('#ceHex');
  if (document.activeElement !== hexInput) hexInput.value = hex;
  $<HTMLInputElement>('#ceH').value = String(hsl[0]);
  $<HTMLInputElement>('#ceS').value = String(hsl[1]);
  $<HTMLInputElement>('#ceL').value = String(hsl[2]);
  sliderBg();
}

function renderHistory() {
  const box = $('#colorHistory');
  box.innerHTML = '';
  if (!colorHistory.length) {
    box.innerHTML = '<span class="hint">色を調整して別の項目（背景・文字など）に切り替えると、ここに追加されます</span>';
    return;
  }
  for (const c of colorHistory) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = c;
    b.style.background = c;
    b.addEventListener('click', () => {
      setColor(c, true);
    });
    box.appendChild(b);
  }
}

/**
 * スライダーを「つまみ（〇）を動かしたときだけ」反応させる（スマホでの誤タップ防止）。
 * バーのつまみ以外の場所に触れても値は変わらず、そのまま画面をスクロールできる。
 */
function thumbOnly(input: HTMLInputElement) {
  const wrap = input.parentElement!;
  input.classList.add('thumb-only');
  const min = Number(input.min), max = Number(input.max);
  const geo = () => {
    const r = input.getBoundingClientRect();
    const tw = r.height + 10; // つまみの直径（CSSでバーの高さ＋10px）
    const frac = (Number(input.value) - min) / (max - min);
    return { r, tw, cx: r.left + tw / 2 + frac * (r.width - tw) };
  };
  let drag: { id: number; offset: number } | null = null;
  wrap.addEventListener('pointerdown', (e) => {
    const { r, tw, cx } = geo();
    const hit = Math.abs(e.clientX - cx) <= tw / 2 + 10 && e.clientY >= r.top - 14 && e.clientY <= r.bottom + 14;
    if (!hit) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, offset: e.clientX - cx };
    input.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { r, tw } = geo();
    const frac = Math.min(1, Math.max(0, (e.clientX - drag.offset - r.left - tw / 2) / (r.width - tw)));
    const v = String(Math.round(min + frac * (max - min)));
    if (v !== input.value) {
      input.value = v;
      input.dispatchEvent(new Event('input'));
    }
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    input.classList.remove('dragging');
    input.dispatchEvent(new Event('change'));
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  // ラベル部分のクリックでつまみが動かないように
  wrap.addEventListener('click', (e) => e.preventDefault());
}

function stopPicking() {
  picking = false;
  document.body.classList.remove('picking');
  $('#loupe').hidden = true;
  $('#ceDropper').classList.remove('active');
}

/** プレビュー上の位置の色を読む */
function colorAt(e: PointerEvent): string | null {
  const cv = $<HTMLCanvasElement>('#preview');
  const r = cv.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * cv.width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * cv.height);
  if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return null;
  const d = cv.getContext('2d')!.getImageData(x, y, 1, 1).data;
  return rgbToHex(d[0], d[1], d[2]);
}

function showLoupe(e: PointerEvent, c: string | null) {
  const lp = $('#loupe');
  if (!c) {
    lp.hidden = true;
    return;
  }
  const st = $('#stage').getBoundingClientRect();
  lp.hidden = false;
  lp.style.background = c;
  lp.textContent = c;
  lp.style.color = isLightHex(c) ? '#111' : '#fff';
  // 指で隠れないよう、触れている位置の少し上に表示
  const above = e.pointerType === 'touch' ? 70 : 40;
  lp.style.left = `${e.clientX - st.left}px`;
  lp.style.top = `${e.clientY - st.top - above}px`;
}

function isLightHex(hex: string) {
  const [, , l] = hexToHsl(hex);
  return l > 60;
}

function bindColorEditor() {
  $$('#colorTargets [data-target]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = b.dataset.target as keyof Colors;
      if (next !== colorTarget) commitHistory();
      colorTarget = next;
      syncColorEditor();
    }),
  );
  const ids: [string, number][] = [['#ceH', 0], ['#ceS', 1], ['#ceL', 2]];
  for (const [id, i] of ids) {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => {
      hsl[i] = Number(el.value);
      // 無彩色のまま色相を動かしても色が変わらないので、色が見えるところまで彩度を上げる
      if (i === 0 && hsl[1] < 8) {
        hsl[1] = 60;
        if (hsl[2] < 15 || hsl[2] > 85) hsl[2] = 50;
      }
      const hex = hslToHex(...hsl);
      settings.colors[colorTarget] = hex;
      lastCustom = hex;
      saveSettings();
      markActivePreset();
      syncColorEditor(true);
      schedulePreview();
    });
    el.addEventListener('change', () => setColor(settings.colors[colorTarget], true));
  }
  for (const [id] of ids) thumbOnly($<HTMLInputElement>(id));
  const hexInput = $<HTMLInputElement>('#ceHex');
  const commitHex = () => {
    const h = normalizeHex(hexInput.value);
    if (h) setColor(h, true);
    else hexInput.value = settings.colors[colorTarget];
  };
  hexInput.addEventListener('change', commitHex);
  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitHex();
      hexInput.blur();
    }
  });

  // スポイト：プレビューをタップ（クリック）して色を取る。なぞるとルーペで確認できる
  $('#ceDropper').addEventListener('click', () => {
    if (picking) return stopPicking();
    picking = true;
    document.body.classList.add('picking');
    $('#ceDropper').classList.add('active');
    toast('写真（プレビュー）をタップして色を選んでください', 3000);
  });
  const cv = $<HTMLCanvasElement>('#preview');
  let down = false;
  cv.addEventListener('pointerdown', (e) => {
    if (!picking) return;
    e.preventDefault();
    down = true;
    cv.setPointerCapture(e.pointerId);
    showLoupe(e, colorAt(e));
  });
  cv.addEventListener('pointermove', (e) => {
    if (!picking) return;
    if (e.pointerType === 'touch' && !down) return;
    showLoupe(e, colorAt(e));
  });
  cv.addEventListener('pointerup', (e) => {
    if (!picking || !down) return;
    down = false;
    const c = colorAt(e);
    if (!c) {
      // 写真の外で指を離したときは、スポイトを続ける
      $('#loupe').hidden = true;
      return;
    }
    stopPicking();
    {
      setColor(c, true);
      syncColorEditor();
      toast(`${c} を設定しました`, 2000);
    }
  });
  cv.addEventListener('pointerleave', () => {
    if (picking && !down) $('#loupe').hidden = true;
  });
  cv.addEventListener('pointercancel', () => {
    down = false;
    $('#loupe').hidden = true;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picking) stopPicking();
  });
  // アプリを閉じる・切り替えるときも記録しておく
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') commitHistory();
  });
  window.addEventListener('pagehide', commitHistory);
  renderHistory();
}

// カスタムカラー：オンにしたときだけ色調整パネルを開く（端末ごとの表示設定）
const CUSTOM_KEY = 'exif-frame-maker:custom-color';
function bindCustomColor() {
  const cb = $<HTMLInputElement>('#customColor');
  const apply = () => {
    $('#customPanel').hidden = !cb.checked;
    if (!cb.checked) {
      stopPicking();
      commitHistory();
    }
  };
  try {
    cb.checked = localStorage.getItem(CUSTOM_KEY) === '1';
  } catch {
    /* noop */
  }
  apply();
  cb.addEventListener('change', () => {
    apply();
    try {
      localStorage.setItem(CUSTOM_KEY, cb.checked ? '1' : '0');
    } catch {
      /* noop */
    }
    if (cb.checked) $('#customPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// スマホ：写真の一覧（写真を追加）を隠してプレビューを広く
const STRIP_KEY = 'exif-frame-maker:strip-hidden';
function bindStripToggle() {
  const btn = $<HTMLButtonElement>('#stripToggle');
  const set = (hidden: boolean, save: boolean) => {
    document.body.classList.toggle('strip-hidden', hidden);
    btn.setAttribute('aria-expanded', String(!hidden));
    btn.setAttribute('aria-label', hidden ? '写真の一覧を表示' : '写真の一覧を隠す');
    const n = photos.length;
    btn.innerHTML = hidden
      ? `<span>写真${n ? `（${n}枚）` : ''}を表示</span><b>⌃</b>`
      : '<b>⌄</b><span>隠す</span>';
    if (save) {
      try {
        localStorage.setItem(STRIP_KEY, hidden ? '1' : '0');
      } catch {
        /* noop */
      }
      schedulePreview(0);
    }
  };
  let hidden = false;
  try {
    hidden = localStorage.getItem(STRIP_KEY) === '1';
  } catch {
    /* noop */
  }
  set(hidden, false);
  btn.addEventListener('click', () => {
    hidden = !hidden;
    set(hidden, true);
  });
  refreshStripToggle = () => set(hidden, false);
}
// ---------- 文字の設定を初期設定に戻す ----------

type TextPart = Pick<Settings, 'show' | 'font' | 'fonts' | 'textScale' | 'makerStyle' | 'credit' | 'author'>;
const textPart = (s: Settings, withAuthor: boolean): Partial<TextPart> => ({
  show: structuredClone(s.show),
  font: s.font,
  fonts: structuredClone(s.fonts),
  textScale: s.textScale,
  makerStyle: s.makerStyle,
  credit: structuredClone(s.credit),
  ...(withAuthor ? { author: s.author } : {}),
});
const isTextDefault = () => JSON.stringify(textPart(settings, false)) === JSON.stringify(textPart(DEFAULTS, false));

function syncResetText() {
  const same = isTextDefault();
  $<HTMLButtonElement>('#resetText').disabled = same;
  $('#resetTextHint').textContent = same ? '文字の設定は初期設定のままです。' : '';
}

function bindResetText() {
  const sheet = $('#resetSheet');
  const close = () => (sheet.hidden = true);
  $('#resetText').addEventListener('click', () => {
    $<HTMLInputElement>('#resetAuthor').checked = false;
    sheet.hidden = false;
  });
  $('#resetCancel').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });
  $('#resetConfirm').addEventListener('click', () => {
    const withAuthor = $<HTMLInputElement>('#resetAuthor').checked;
    const backup = textPart(settings, true);
    Object.assign(settings, structuredClone(textPart(DEFAULTS, withAuthor)));
    close();
    update();
    // 押し間違えたときのために、少しの間「元に戻す」を出す
    toast('文字の設定を初期設定に戻しました', 6000, {
      label: '元に戻す',
      run: () => {
        Object.assign(settings, backup);
        update();
        toast('元の設定に戻しました');
      },
    });
  });
}

// ---------- 拡大表示 ----------

/** 拡大ボタンをプレビューのすぐ右下に置く（余白が無ければ枠の内側） */
function placeZoomBtn() {
  const btn = $('#zoomBtn');
  const st = $('#stage').getBoundingClientRect();
  const r = $('#preview').getBoundingClientRect();
  if (!r.width) return;
  const size = btn.offsetWidth || 32;
  const gap = 6;
  const T = r.top - st.top, R = r.right - st.left, B = r.bottom - st.top;
  let left: number, top: number;
  if (st.width - R >= size + gap + 2) {
    left = R + gap; // 右隣
    top = B - size;
  } else if (st.height - B >= size + gap + 2) {
    left = R - size; // 下隣（右寄せ）
    top = B + gap;
  } else if (T >= size + gap + 2) {
    left = R - size; // 上隣
    top = T - size - gap;
  } else {
    left = R - size - 8; // 余白が無い→写真の右上（文字の入るフチを避ける）
    top = T + 8;
  }
  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
}

async function openZoom() {
  if (picking) return;
  if (busy) return toast('処理中です。終わってからもう一度お試しください');
  setBusy(true);
  try {
    const out = await renderPreview(current(), settings, IS_MOBILE ? 2400 : 4000);
    openViewer(out);
  } catch (e) {
    toast('拡大表示できませんでした: ' + (e as Error).message);
  } finally {
    setBusy(false);
  }
}

// ---------- UI：フォント ----------

const ROLE_LABEL: Record<FontRole, string> = {
  maker: 'メーカー名', model: '機種', lens: 'レンズ', params: '撮影設定', date: '撮影日時', credit: 'クレジット',
};

function fontOptions(sel: HTMLSelectElement, value: string, emptyLabel: string) {
  sel.innerHTML = '';
  const add = (parent: HTMLElement, v: string, label: string) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    if (v) o.style.fontFamily = `"${v}"`;
    parent.appendChild(o);
  };
  add(sel, '', emptyLabel);
  const groups: [FontLang, string][] = [
    ['ja', '日本語対応（かな・漢字も表示）'],
    ['latin', '欧文のみ（英数字。日本語は代替フォント）'],
  ];
  for (const [lang, label] of groups) {
    if (fontLang !== 'all' && fontLang !== lang) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const f of FONT_CATALOG.filter((x) => x.lang === lang)) add(g, f.family, `${f.label}（${f.kind}）`);
    sel.appendChild(g);
  }
  // 絞り込みで隠れたフォントが選ばれている場合も、選択状態を保つ
  const cur = fontInfo(value);
  if (cur && fontLang !== 'all' && cur.lang !== fontLang) add(sel, cur.family, `${cur.label}（${cur.kind}）`);
  const mine = userFonts();
  if (mine.length) {
    const g2 = document.createElement('optgroup');
    g2.label = '読み込んだフォント';
    for (const f of mine) add(g2, f, f);
    sel.appendChild(g2);
  }
  // 別の端末で作ったプリセットなど、この端末に無いフォントが指定されている場合
  if (value && !isFontAvailable(value)) add(sel, value, `${value}（この端末に無いため既定で表示）`);
  sel.value = value;
}

// フォント一覧の絞り込み（端末ごとの表示設定）
type LangFilter = 'all' | FontLang;
let fontLang: LangFilter = (() => {
  try {
    const v = localStorage.getItem('exif-frame-maker:font-lang');
    return v === 'ja' || v === 'latin' ? v : 'all';
  } catch {
    return 'all';
  }
})();

function fillFontSelects() {
  $$('#fontLang [data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === fontLang));
  fontOptions($<HTMLSelectElement>('#font'), settings.font, 'レイアウト既定');
  $$<HTMLSelectElement>('[data-font-role]').forEach((sel) => {
    const role = sel.dataset.fontRole as FontRole;
    fontOptions(sel, settings.fonts[role], '全体と同じ');
  });
  renderUserFonts();
}

function renderUserFonts() {
  const ul = $('#userFonts');
  ul.innerHTML = '';
  const list = userFonts();
  if (!list.length) {
    ul.innerHTML = '<li class="empty">まだありません</li>';
    return;
  }
  for (const f of list) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="uf-name"></span><button class="btn-sm ghost">削除</button>';
    const name = li.querySelector<HTMLElement>('.uf-name')!;
    name.textContent = f;
    name.style.fontFamily = `"${f}", system-ui`;
    const used = FONT_ROLES.filter((r) => settings.fonts[r] === f).map((r) => ROLE_LABEL[r]);
    if (settings.font === f) used.unshift('全体');
    if (used.length) li.title = `使用中: ${used.join('、')}`;
    li.querySelector('button')!.addEventListener('click', async () => {
      if (!confirm(`フォント「${f}」を削除しますか？\n（使っている項目は既定のフォントに戻ります）`)) return;
      await removeFont(f);
      if (settings.font === f) settings.font = '';
      for (const r of FONT_ROLES) if (settings.fonts[r] === f) settings.fonts[r] = '';
      update();
    });
    ul.appendChild(li);
  }
}

function bindFonts() {
  $$<HTMLSelectElement>('[data-font-role]').forEach((sel) =>
    sel.addEventListener('change', () => {
      settings.fonts[sel.dataset.fontRole as FontRole] = sel.value;
      update();
    }),
  );
  $$('#fontLang [data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      fontLang = b.dataset.lang as LangFilter;
      try {
        localStorage.setItem('exif-frame-maker:font-lang', fontLang);
      } catch {
        /* noop */
      }
      fillFontSelects();
    }),
  );
  const adv = $<HTMLButtonElement>('#advToggle');
  adv.addEventListener('click', () => {
    const open = $('#advPanel').hidden;
    $('#advPanel').hidden = !open;
    adv.setAttribute('aria-expanded', String(open));
  });
  $<HTMLInputElement>('#makerStyle').addEventListener('change', (e) => {
    settings.makerStyle = (e.target as HTMLInputElement).checked;
    update();
  });
  $$<HTMLInputElement>('[data-font-import]').forEach((input) => {
    // Androidアプリではフォントの種類指定が効かないことがあるため全ファイルを許可
    input.accept = IS_NATIVE ? '' : '.ttf,.otf,.woff,.woff2,.ttc,font/ttf,font/otf,font/woff,font/woff2';
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length) return;
      const target = input.dataset.fontImport;
      let last = '';
      for (const f of files) {
        try {
          last = await importFont(f);
          toast(`フォント「${last}」を読み込みました`);
        } catch (e) {
          toast(`${f.name}: ${(e as Error).message}`, 5000);
        }
      }
      if (last) {
        if (target === 'global') settings.font = last;
        else if (target && (FONT_ROLES as string[]).includes(target)) settings.fonts[target as FontRole] = last;
      }
      update();
    });
  });
}

// ---------- UI：Exif編集 ----------

const EXIF_FIELDS: [keyof ExifInfo, string][] = [
  ['make', 'メーカー'],
  ['model', '機種'],
  ['lens', 'レンズ'],
  ['focal', '焦点距離'],
  ['aperture', 'F値'],
  ['shutter', 'シャッター速度'],
  ['iso', 'ISO'],
  ['date', '撮影日時'],
  ['artist', '撮影者 (Artist)'],
];

function renderExifForm() {
  const p = current();
  const form = $('#exifForm');
  form.innerHTML = '';
  for (const [k, label] of EXIF_FIELDS) {
    const l = document.createElement('label');
    l.innerHTML = `<span>${label}</span><input type="text" />`;
    const inp = l.querySelector('input')!;
    inp.value = p.overrides[k] ?? p.exif[k];
    inp.placeholder = p.exif[k] || '（なし）';
    inp.addEventListener('input', () => {
      p.overrides[k] = inp.value;
      if (k === 'make') renderMakers();
      schedulePreview(80);
      scheduleThumbs(400);
      renderListDebounced();
    });
    form.appendChild(l);
  }
}

let listTimer = 0;
function renderListDebounced() {
  clearTimeout(listTimer);
  listTimer = window.setTimeout(renderList, 300);
}

// ---------- UI：メーカーロゴ ----------

async function renderMakers() {
  const ul = $('#makers');
  const keys = new Set<string>();
  for (const p of photos.length ? photos : [current()]) {
    const info = buildInfo(p, settings);
    if (info.maker && info.maker.key !== 'other') keys.add(info.maker.key);
  }
  await Promise.all([...keys].map((k) => getLogo(k)));
  ul.innerHTML = '';
  if (!keys.size) {
    ul.innerHTML = '<li class="empty">対応メーカーの写真がまだありません</li>';
    return;
  }
  for (const key of keys) {
    const m = MAKERS.find((x) => x.key === key)!;
    const origin = logoOrigin(key);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mk-name"></span>
      <span class="mk-state">${origin === 'user' ? '登録画像' : origin === 'bundled' ? '配置画像' : '文字で表示'}</span>
      <label class="btn-sm">画像を登録<input type="file" accept="image/svg+xml,image/png,image/webp" hidden /></label>
      ${origin === 'user' ? '<button class="btn-sm ghost" data-rm>解除</button>' : ''}`;
    li.querySelector('.mk-name')!.textContent = m.display;
    li.querySelector('input')!.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      const ok = confirm(
        `${m.display} のロゴ画像を登録します。\n\n` +
          '・ロゴは各社の商標です。利用条件をご自身で確認してください。\n' +
          '・ロゴ入りの画像は個人的な利用にとどめてください（多くのメーカーは改変・商用利用を認めていません）。\n\n' +
          '登録しますか？',
      );
      if (!ok) return;
      try {
        await setUserLogo(key, f);
        toast(`${m.display} のロゴを登録しました`);
      } catch {
        toast('ロゴ画像を読み込めませんでした');
      }
      renderMakers();
      update();
    });
    li.querySelector('[data-rm]')?.addEventListener('click', async () => {
      await removeUserLogo(key);
      renderMakers();
      update();
    });
    ul.appendChild(li);
  }
}

// ---------- 書き出し ----------

let busy = false;
function setBusy(b: boolean) {
  busy = b;
  $('#busy').hidden = !b;
}
function setProgress(t: string) {
  $('#progress').textContent = t;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function outName(p: PhotoItem, used: Set<string>) {
  const base = p.name.replace(/\.[^.]+$/, '');
  let name = `${base}_frame.${EXT[settings.export.format]}`;
  let i = 2;
  while (used.has(name)) name = `${base}_frame_${i++}.${EXT[settings.export.format]}`;
  used.add(name);
  return name;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

let pending: { files: File[]; zip: boolean } | null = null;

function closeShare() {
  pending = null;
  $('#shareSheet').hidden = true;
}

function canShareFiles(files: File[]) {
  try {
    if (IS_NATIVE) return true;
    return IS_MOBILE && typeof navigator.share === 'function' && !!navigator.canShare?.({ files });
  } catch {
    return false;
  }
}

async function downloadFiles(files: File[], zip: boolean) {
  if (zip && files.length > 1) {
    setProgress('ZIPを作成中…');
    const entries: Record<string, Uint8Array> = {};
    for (const f of files) entries[f.name] = new Uint8Array(await f.arrayBuffer());
    const data = zipSync(entries, { level: 0 });
    download(new Blob([data.buffer as ArrayBuffer], { type: 'application/zip' }), `exif-frames_${new Date().toISOString().slice(0, 10)}.zip`);
    setProgress('');
    return;
  }
  for (const f of files) {
    download(f, f.name);
    if (files.length > 1) await new Promise((r) => setTimeout(r, 400)); // 連続ダウンロードのブロック回避
  }
}

/** スマホでは共有シート（写真アプリへ保存など）、PCではそのままダウンロード */
async function deliver(files: File[], zip: boolean) {
  if (canShareFiles(files)) {
    pending = { files, zip };
    const images = files.every((f) => f.type.startsWith('image/'));
    $('#shareDesc').textContent = !images
      ? 'ファイルを作成しました。保存先を選んでください。'
      : IS_NATIVE
        ? `${files.length}枚の画像を作成しました。「保存・共有」からギャラリーやGoogleフォトへ保存できます。`
        : `${files.length}枚の画像を作成しました。「写真に保存・共有」から写真アプリへ保存できます。`;
    $('#shareBtn').textContent = !images ? '共有' : IS_NATIVE ? '保存・共有（ギャラリー / Googleフォトなど）' : '写真に保存・共有';
    $('#shareDl').textContent = IS_NATIVE ? '端末の Documents フォルダに保存' : 'ファイルとしてダウンロード';
    $('#shareSheet').hidden = false;
  } else {
    await downloadFiles(files, zip);
    toast(files.every((f) => f.type.startsWith('image/')) ? `${files.length}枚を書き出しました` : 'ファイルを書き出しました');
  }
}

async function exportPhotos(list: PhotoItem[], zip: boolean) {
  if (busy) return toast('処理中です。終わってからもう一度お試しください'); // 二重押し防止
  if (!list.length || list[0].id === 'sample') return toast('先に写真を追加してください');
  setBusy(true);
  const used = new Set<string>();
  const files: File[] = [];
  try {
    for (let i = 0; i < list.length; i++) {
      setProgress(`書き出し中… ${i + 1}/${list.length}`);
      const c = await renderOutput(list[i], settings);
      const blob = await canvasToBlob(c, settings.export.format, settings.export.quality);
      files.push(new File([blob], outName(list[i], used), { type: settings.export.format }));
      c.width = c.height = 0;
    }
    setProgress('');
    await deliver(files, zip);
  } catch (e) {
    console.error(e);
    toast('書き出しに失敗しました: ' + (e as Error).message);
  } finally {
    setProgress('');
    setBusy(false);
  }
}

// ---------- 起動 ----------

buildStaticControls();
bindMyPresets();
renderMyPresets();
refreshAll();
// PWA（ホーム画面に追加してオフラインでも使える）
if (!IS_NATIVE && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
if (IS_NATIVE) document.body.classList.add('native');

loadUserFonts().then((list) => {
  if (!list.length) return;
  fillFontSelects();
  schedulePreview(0);
  scheduleThumbs(0);
});
preloadFonts().then(() => {
  schedulePreview(0);
  scheduleThumbs(0);
});
