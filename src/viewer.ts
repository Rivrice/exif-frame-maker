// 写真フレームの拡大表示（全画面）。ピンチ／ホイールで拡大、ドラッグで移動、ダブルタップで切り替え。

let el: HTMLDivElement | null = null;
let cv: HTMLCanvasElement;
let scale = 1, tx = 0, ty = 0, fit = 1;
const pts = new Map<number, { x: number; y: number }>();
let pinch: { d: number; s: number; cx: number; cy: number; tx: number; ty: number } | null = null;
let lastTap = 0;

function apply() {
  cv.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

/** 画面中心基準で全体が入る倍率に戻す */
function reset() {
  const W = el!.clientWidth, H = el!.clientHeight;
  fit = Math.min((W - 24) / cv.width, (H - 24) / cv.height, 1);
  scale = fit;
  tx = (W - cv.width * scale) / 2;
  ty = (H - cv.height * scale) / 2;
  apply();
}

/** 点 (px, py) を中心に倍率を変える */
function zoomAt(px: number, py: number, next: number) {
  next = Math.min(Math.max(next, fit * 0.8), Math.max(fit * 8, 4));
  tx = px - ((px - tx) * next) / scale;
  ty = py - ((py - ty) * next) / scale;
  scale = next;
  apply();
}

function build() {
  el = document.createElement('div');
  el.className = 'viewer';
  el.hidden = true;
  el.innerHTML = `
    <canvas></canvas>
    <button class="viewer-close" aria-label="閉じる">✕</button>
    <div class="viewer-tools">
      <button data-z="out" aria-label="縮小">－</button>
      <button data-z="fit">全体</button>
      <button data-z="1">等倍</button>
      <button data-z="in" aria-label="拡大">＋</button>
    </div>`;
  document.body.appendChild(el);
  cv = el.querySelector('canvas')!;
  el.querySelector('.viewer-close')!.addEventListener('click', closeViewer);
  el.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) =>
    b.addEventListener('click', () => {
      const W = el!.clientWidth / 2, H = el!.clientHeight / 2;
      const z = b.dataset.z;
      if (z === 'fit') reset();
      else if (z === '1') zoomAt(W, H, 1);
      else zoomAt(W, H, scale * (z === 'in' ? 1.5 : 1 / 1.5));
    }),
  );
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, scale * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    el!.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx, ty };
    } else if (pts.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) {
        // ダブルタップ：全体表示 ⇔ 2.5倍
        if (scale > fit * 1.2) reset();
        else zoomAt(e.clientX, e.clientY, Math.max(fit * 2.5, 1));
      }
      lastTap = now;
    }
  });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (pts.size === 1) {
      tx += e.clientX - p.x;
      ty += e.clientY - p.y;
      apply();
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const next = Math.min(Math.max((pinch.s * d) / pinch.d, fit * 0.8), Math.max(fit * 8, 4));
      // ピンチ開始時の中心を基準に拡大し、指の移動分だけずらす
      tx = pinch.cx - ((pinch.cx - pinch.tx) * next) / pinch.s + (cx - pinch.cx);
      ty = pinch.cy - ((pinch.cy - pinch.ty) * next) / pinch.s + (cy - pinch.cy);
      scale = next;
      apply();
    }
  });
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el && !el.hidden) closeViewer();
  });
  // スマホのアドレスバーの出し入れでも resize が来るので、拡大中は位置を保つ
  window.addEventListener('resize', () => {
    if (!el || el.hidden) return;
    const wasFit = Math.abs(scale - fit) < 1e-6;
    const W = el.clientWidth, H = el.clientHeight;
    const nextFit = Math.min((W - 24) / cv.width, (H - 24) / cv.height, 1);
    if (wasFit) reset();
    else fit = nextFit;
  });
}

export function isViewerOpen() {
  return !!el && !el.hidden;
}

/** ブラウザの「戻る」（スマホの戻るジェスチャー）で閉じられるよう履歴を1つ積む */
let pushed = false;
window.addEventListener('popstate', () => {
  if (pushed) {
    pushed = false;
    hide();
  }
});

export function openViewer(src: HTMLCanvasElement) {
  if (!el) build();
  if (!pushed && !isViewerOpen()) {
    try {
      history.pushState({ viewer: true }, '');
      pushed = true;
    } catch {
      /* noop */
    }
  }
  cv.width = src.width;
  cv.height = src.height;
  cv.getContext('2d')!.drawImage(src, 0, 0);
  el!.hidden = false;
  document.body.classList.add('viewing');
  reset();
}

export function closeViewer() {
  if (pushed) {
    pushed = false;
    history.back();
  }
  hide();
}

function hide() {
  if (!el) return;
  el.hidden = true;
  document.body.classList.remove('viewing');
  pts.clear();
  pinch = null;
  cv.width = cv.height = 0; // メモリ解放
}
