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
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import './style.css';

import { zipSync } from 'fflate';
import { ACCEPT, decodeFile, makeThumb } from './decode';
import { buildInfo } from './draw';
import { LAYOUTS, getLayout } from './layouts';
import { getLogo, logoOrigin, removeUserLogo, setUserLogo } from './logos';
import { MAKERS } from './makers';
import { IS_IOS, canvasToBlob, preloadFonts, renderCollage, renderOutput, renderPreview } from './render';
import type { Colors, ExifInfo, PhotoItem, Settings } from './types';
import { IS_NATIVE, nativeSave, nativeShare } from './native';

// ---------- 状態 ----------

const STORAGE_KEY = 'exif-frame-maker:settings:v1';

const DEFAULTS: Settings = {
  layoutId: 'classic',
  colors: { ...LAYOUTS[0].colors },
  font: '',
  textScale: 1,
  borderScale: 1,
  aspect: 'auto',
  show: { logo: true, model: true, lens: true, focal: true, aperture: true, shutter: true, iso: true, date: true, artist: true },
  author: '',
  mode: 'single',
  collage: { type: 'justified', width: 4000, rowHeight: 30, cols: 3, gap: 12, bg: '#eeeeee' },
  export: { format: 'image/jpeg', quality: 0.92, maxEdge: 0 },
};

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw) {
      return {
        ...DEFAULTS,
        ...raw,
        colors: { ...DEFAULTS.colors, ...raw.colors },
        show: { ...DEFAULTS.show, ...raw.show },
        collage: { ...DEFAULTS.collage, ...raw.collage },
        export: { ...DEFAULTS.export, ...raw.export },
      };
    }
  } catch {
    /* noop */
  }
  return structuredClone(DEFAULTS);
}

let settings = loadSettings();
const photos: PhotoItem[] = [];
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

function toast(msg: string, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
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

async function addFiles(files: FileList | File[]) {
  const list = [...files].filter((f) => f.size > 0);
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
  let out: HTMLCanvasElement;
  try {
    if (settings.mode === 'collage' && photos.length) {
      out = await renderCollage(photos, settings, Math.max(800, target));
    } else {
      out = await renderPreview(current(), settings, target);
    }
  } catch (e) {
    console.error(e);
    return;
  }
  if (token !== previewToken) return;
  const cv = $<HTMLCanvasElement>('#preview');
  cv.width = out.width;
  cv.height = out.height;
  cv.getContext('2d')!.drawImage(out, 0, 0);
  const p = current();
  const meta = $('#meta');
  if (settings.mode === 'collage' && photos.length) {
    meta.textContent = `${photos.length}枚をまとめて配置・出力幅 ${settings.collage.width}px`;
  } else {
    const lay = getLayout(settings.layoutId);
    meta.textContent = `${p.id === 'sample' ? 'サンプル画像' : p.name}　${p.width}×${p.height}　${lay.name}${p.note ? `　(${p.note})` : ''}`;
  }
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
}

function refreshAll() {
  renderList();
  renderControls();
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

  $$<HTMLInputElement>('[data-color]').forEach((inp) =>
    inp.addEventListener('input', () => {
      settings.colors[inp.dataset.color as keyof Colors] = inp.value;
      update(false);
    }),
  );
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
  bindRange('borderScale', () => settings.borderScale, (v) => (settings.borderScale = v), (v) => `${Math.round(v * 100)}%`);
  bindRange('quality', () => settings.export.quality, (v) => (settings.export.quality = v), (v) => `${Math.round(v * 100)}`, false);
  bindRange('rowHeight', () => settings.collage.rowHeight, (v) => (settings.collage.rowHeight = v), (v) => `${v}%`, false);
  bindRange('cols', () => settings.collage.cols, (v) => (settings.collage.cols = v), (v) => `${v}`, false);
  bindRange('gap', () => settings.collage.gap, (v) => (settings.collage.gap = v), (v) => `${v}‰`, false);

  const bindSelect = (id: string, set: (v: string) => void, thumbs = true) =>
    $<HTMLSelectElement>('#' + id).addEventListener('change', (e) => {
      set((e.target as HTMLSelectElement).value);
      update(thumbs);
    });
  bindSelect('font', (v) => (settings.font = v));
  bindSelect('aspect', (v) => (settings.aspect = v));
  bindSelect('format', (v) => (settings.export.format = v as Settings['export']['format']), false);
  bindSelect('maxEdge', (v) => (settings.export.maxEdge = Number(v)), false);
  bindSelect('collageType', (v) => (settings.collage.type = v as Settings['collage']['type']), false);

  $<HTMLInputElement>('#collageWidth').addEventListener('change', (e) => {
    settings.collage.width = Math.min(12000, Math.max(800, Number((e.target as HTMLInputElement).value) || 4000));
    update(false);
  });
  $<HTMLInputElement>('#collageBg').addEventListener('input', (e) => {
    settings.collage.bg = (e.target as HTMLInputElement).value;
    update(false);
  });
  $<HTMLInputElement>('#author').addEventListener('input', (e) => {
    settings.author = (e.target as HTMLInputElement).value;
    update();
  });

  $$('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode as Settings['mode'];
      update(false);
    }),
  );

  // ファイル
  const file = $<HTMLInputElement>('#file');
  file.accept = IS_NATIVE ? '' : ACCEPT; // Androidアプリでは拡張子指定が効かないため全ファイルを許可
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
    for (const p of photos) URL.revokeObjectURL(p.thumbUrl);
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
  $('#saveCollage').addEventListener('click', exportCollage);

  window.addEventListener('resize', () => schedulePreview(150));

  // スマホ用タブ
  document.body.dataset.tab = 'layout';
  $$('#tabbar [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
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
        toast(`${pending.files.length}枚を「${dir}」に保存しました`);
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
  $$('.preset').forEach((b) => b.classList.toggle('active', b.dataset.layout === settings.layoutId));
  $$<HTMLInputElement>('[data-color]').forEach((inp) => (inp.value = settings.colors[inp.dataset.color as keyof Colors]));
  $$<HTMLInputElement>('[data-show]').forEach((inp) => (inp.checked = settings.show[inp.dataset.show as keyof Settings['show']]));
  const set = (id: string, v: string | number) => (($('#' + id) as HTMLInputElement).value = String(v));
  const out = (id: string, v: string) => ($('#' + id + 'Out').textContent = v);
  set('font', settings.font);
  set('aspect', settings.aspect);
  set('textScale', settings.textScale);
  out('textScale', `${Math.round(settings.textScale * 100)}%`);
  set('borderScale', settings.borderScale);
  out('borderScale', `${Math.round(settings.borderScale * 100)}%`);
  set('format', settings.export.format);
  set('quality', settings.export.quality);
  out('quality', `${Math.round(settings.export.quality * 100)}`);
  set('maxEdge', settings.export.maxEdge);
  set('collageType', settings.collage.type);
  set('rowHeight', settings.collage.rowHeight);
  out('rowHeight', `${settings.collage.rowHeight}%`);
  set('cols', settings.collage.cols);
  out('cols', `${settings.collage.cols}`);
  set('gap', settings.collage.gap);
  out('gap', `${settings.collage.gap}‰`);
  set('collageWidth', settings.collage.width);
  set('collageBg', settings.collage.bg);
  set('author', settings.author);

  const collage = settings.mode === 'collage';
  $$('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === settings.mode));
  $('#collagePanel').hidden = !collage;
  $('#infoPanel').hidden = collage;
  $('#saveOne').hidden = collage;
  $('#saveZip').hidden = collage;
  $('#saveAll').hidden = collage;
  $('#saveCollage').hidden = !collage;
  $$('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== settings.collage.type));
  const hasPhotos = photos.length > 0;
  for (const id of ['saveOne', 'saveZip', 'saveAll', 'saveCollage']) $<HTMLButtonElement>('#' + id).disabled = !hasPhotos;
}

function update(thumbs = true) {
  saveSettings();
  renderControls();
  schedulePreview();
  if (thumbs) scheduleThumbs();
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

function setBusy(b: boolean) {
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
    $('#shareDesc').textContent = IS_NATIVE
      ? `${files.length}枚の画像を作成しました。「保存・共有」からギャラリーやGoogleフォトへ保存できます。`
      : `${files.length}枚の画像を作成しました。「写真に保存・共有」から写真アプリへ保存できます。`;
    $('#shareBtn').textContent = IS_NATIVE ? '保存・共有（ギャラリー / Googleフォトなど）' : '写真に保存・共有';
    $('#shareDl').textContent = IS_NATIVE ? '端末の Documents フォルダに保存' : 'ファイルとしてダウンロード';
    $('#shareSheet').hidden = false;
  } else {
    await downloadFiles(files, zip);
    toast(`${files.length}枚を書き出しました`);
  }
}

async function exportPhotos(list: PhotoItem[], zip: boolean) {
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

async function exportCollage() {
  if (!photos.length) return toast('先に写真を追加してください');
  setBusy(true);
  setProgress('まとめた画像を作成中…');
  try {
    const c = await renderCollage(photos, settings);
    const blob = await canvasToBlob(c, settings.export.format, settings.export.quality);
    const name = `exif-collage_${new Date().toISOString().slice(0, 10)}.${EXT[settings.export.format]}`;
    setProgress('');
    await deliver([new File([blob], name, { type: settings.export.format })], false);
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
refreshAll();
// PWA（ホーム画面に追加してオフラインでも使える）
if (!IS_NATIVE && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
if (IS_NATIVE) document.body.classList.add('native');

preloadFonts().then(() => {
  schedulePreview(0);
  scheduleThumbs(0);
});
