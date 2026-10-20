// 2D キャンバス（SVG）。ワールド座標の単位は cm。viewBox でズーム・パンを行う。
// レイヤー：背景画像 / グリッド / 部屋 / 家具 / オーバーレイ（選択枠・ハンドル・寸法など）
import { state, emit, beginTransaction, endTransaction, select, furnitureList, getItem, getOpening, getWall, selectedIds } from './state.js';
import { aabb, worldToLocal, localToWorld, normAngle, clamp } from './geometry.js';
import { roomSVG, wallSegment, wallDistanceSVG, syncRoomToImage } from './floorplan.js';
import { furnitureLayerSVG } from './render.js';
import { layerOf } from './data/furniture-library.js';
import { followTable, poseOf, withAttachedChairs } from './table-chairs.js';
import { enclosedRect } from './area-draw.js';

const NS = 'http://www.w3.org/2000/svg';
const view = { x: -100, y: -100, k: 1 };
let svg, layers = {}, bgImage = null, bgSrc = null;
let drag = null;
let cb = {};
let validation = null;
let previewValidation = null;
let calibPoints = [];
let roomDraft = null;
let marquee = null; // Shift＋ドラッグの範囲選択 { x1, y1, x2, y2 }
let measure = null; // 距離を測るモード { a, b, done }
let lastMeasure = null; // 最後に測った2点（「実寸で合わせる」で使う）

/** 最後に「📏 測る」で測った長さ（cm）。まだなければ null */
export function getLastMeasure() {
  return lastMeasure ? Math.round(Math.hypot(lastMeasure.b.x - lastMeasure.a.x, lastMeasure.b.y - lastMeasure.a.y)) : null;
}
let wallDraw = null; // 壁を描くモード { start: 始点（null なら未開始）, cur: マウスの位置, snapped: 吸い付いた点, typed: 打ち込み中の長さ }
let flowOverlay = { on: false, url: null, key: null };
const pointers = new Map();
let pinch = null;
let renderQueued = false;

export function initCanvas(el, callbacks) {
  svg = el;
  cb = callbacks || {};
  svg.innerHTML = `
    <defs>
      <pattern id="grid-minor" patternUnits="userSpaceOnUse" width="10" height="10"><path d="M10 0 L0 0 0 10" fill="none" stroke="#e4e2de" stroke-width="0.5"/></pattern>
      <pattern id="grid-major" patternUnits="userSpaceOnUse" width="100" height="100"><path d="M100 0 L0 0 0 100" fill="none" stroke="#d3d0ca" stroke-width="1"/></pattern>
    </defs>
    <g id="layer-grid"></g>
    <g id="layer-bg"></g>
    <g id="layer-room"></g>
    <g id="layer-furniture"></g>
    <g id="layer-overlay"></g>`;
  for (const n of ['grid', 'bg', 'room', 'furniture', 'overlay']) layers[n] = svg.querySelector(`#layer-${n}`);

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerleave', () => cb.onCursor?.(null));
  // 壁を描くモード：右クリック・ダブルクリックで、続けて引くのを終える
  svg.addEventListener('contextmenu', e => { if (state.mode === 'draw-wall') { e.preventDefault(); endWallChain(); } });
  svg.addEventListener('dblclick', () => { if (state.mode === 'draw-wall') endWallChain(); });
  let fitted = false;
  new ResizeObserver(() => {
    const { w, h } = size();
    // 初回、実際の大きさが決まった時点で全体表示にする
    if (!fitted && w > 50 && h > 50 && state.project) { fitted = true; fitToView(); return; }
    applyView();
    requestRender();
  }).observe(svg);
}

// ---------------- ビュー ----------------
function size() {
  const r = svg.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

function applyView() {
  const { w, h } = size();
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${w / view.k} ${h / view.k}`);
}

export function screenToWorld(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: view.x + (clientX - r.left) / view.k, y: view.y + (clientY - r.top) / view.k };
}

export function fitToView() {
  const p = state.project;
  if (!p) return;
  const r = p.room;
  let minX = r.x, minY = r.y, maxX = r.x + r.width, maxY = r.y + r.depth;
  const bg = p.background;
  if (bg && bg.visible !== false && state.settings.showBg && (state.mode === 'bg' || state.mode === 'calibrate' || p.scale?.status === 'unset')) {
    minX = Math.min(minX, bg.x); minY = Math.min(minY, bg.y);
    maxX = Math.max(maxX, bg.x + bg.width); maxY = Math.max(maxY, bg.y + bg.height);
  }
  const m = 70;
  const { w, h } = size();
  view.k = Math.min(w / (maxX - minX + m * 2), h / (maxY - minY + m * 2));
  view.k = clamp(view.k, 0.05, 20);
  view.x = (minX + maxX) / 2 - w / view.k / 2;
  view.y = (minY + maxY) / 2 - h / view.k / 2;
  applyView();
  requestRender();
  cb.onZoom?.(view.k);
}

export function zoomBy(f, clientX, clientY) {
  const r = svg.getBoundingClientRect();
  const cx = clientX ?? r.left + r.width / 2, cy = clientY ?? r.top + r.height / 2;
  const before = screenToWorld(cx, cy);
  view.k = clamp(view.k * f, 0.05, 20);
  view.x = before.x - (cx - r.left) / view.k;
  view.y = before.y - (cy - r.top) / view.k;
  applyView();
  requestRender();
  cb.onZoom?.(view.k);
}

export function getZoom() { return view.k; }

export function viewCenter() {
  const r = svg.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}

export function setValidation(v, pv) {
  validation = v;
  previewValidation = pv;
}

export function setFlowOverlay(on) {
  flowOverlay.on = on;
  requestRender();
}

// ---------------------------------------------------------------------------
// 壁を描く：クリックで始点→終点。続けてクリックすると、つながった壁を次々に引ける。
// 壁は縦か横にそろえ、グリッド・既存の壁の端・部屋の角に吸い付く。数字を打って Enter で、その長さの壁を引く
// ---------------------------------------------------------------------------
const WALL_SNAP_PX = 12;

/** 既存の壁の中心線の端と、部屋の角（吸い付き先） */
function wallSnapPoints() {
  const r = state.project.room;
  const pts = [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x, y: r.y + r.depth }, { x: r.x + r.width, y: r.y + r.depth }];
  for (const w of state.project.walls || []) {
    if (w.w >= w.h) { const cy = w.y + w.h / 2; pts.push({ x: w.x + w.h / 2, y: cy }, { x: w.x + w.w - w.h / 2, y: cy }); }
    else { const cx = w.x + w.w / 2; pts.push({ x: cx, y: w.y + w.w / 2 }, { x: cx, y: w.y + w.h - w.w / 2 }); }
  }
  return pts;
}

/** 縦・横の線（壁の中心線と部屋の外周）にそろえる候補 */
function wallSnapLines() {
  const r = state.project.room;
  const xs = [r.x, r.x + r.width], ys = [r.y, r.y + r.depth];
  for (const w of state.project.walls || []) {
    if (w.w >= w.h) ys.push(w.y + w.h / 2); else xs.push(w.x + w.w / 2);
  }
  return { xs, ys };
}

/** マウスの位置を、吸い付き先・始点からの縦横・グリッドにそろえる */
function wallPoint(pt, start, free) {
  const tol = WALL_SNAP_PX / view.k;
  const near = wallSnapPoints().find(p => Math.hypot(p.x - pt.x, p.y - pt.y) <= tol);
  let q = near ? { ...near } : { ...pt };
  if (start && !free) {
    // 縦か横にまっすぐ
    if (Math.abs(q.x - start.x) >= Math.abs(q.y - start.y)) q.y = start.y; else q.x = start.x;
  }
  if (!near) {
    const { xs, ys } = wallSnapLines();
    const horiz = start && q.y === start.y, vert = start && q.x === start.x;
    const sx = !vert ? xs.find(x => Math.abs(x - q.x) <= tol) : undefined;
    const sy = !horiz ? ys.find(y => Math.abs(y - q.y) <= tol) : undefined;
    const step = state.settings.snap ? 5 : 1;
    if (!vert) q.x = sx ?? snapValue(q.x, step);
    if (!horiz) q.y = sy ?? snapValue(q.y, step);
  }
  return { x: Math.round(q.x), y: Math.round(q.y), snapped: !!near };
}

function addWallSegment(a, b) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 5) return false;
  cb.onWallDrawn?.(a, b);
  return true;
}

/** 続けて引いている壁を終える（モードはそのまま） */
export function endWallChain() {
  if (!wallDraw?.start) return false;
  wallDraw.start = null;
  wallDraw.typed = '';
  requestRender();
  return true;
}

/**
 * 壁を描くモード中のキー操作。数字・小数点で長さを打ち込み、Enter でその長さの壁を引く。
 * Backspace で1文字消す、Esc で続けて引くのを終える。扱ったら true
 */
export function wallDrawKey(key) {
  if (state.mode !== 'draw-wall' || !wallDraw) return false;
  if (key === 'Escape') return endWallChain();
  if (!wallDraw.start) return false;
  if (/^[0-9.]$/.test(key)) { wallDraw.typed = (wallDraw.typed || '') + key; requestRender(); return true; }
  if (key === 'Backspace') { wallDraw.typed = (wallDraw.typed || '').slice(0, -1); requestRender(); return true; }
  if (key === 'Enter' && wallDraw.typed) {
    const len = Number(wallDraw.typed);
    const { start, cur } = wallDraw;
    wallDraw.typed = '';
    if (!(len > 0) || !cur) { requestRender(); return true; }
    // マウスのある向きに、打ち込んだ長さで引く
    const horiz = Math.abs(cur.x - start.x) >= Math.abs(cur.y - start.y);
    const sign = horiz ? Math.sign(cur.x - start.x) || 1 : Math.sign(cur.y - start.y) || 1;
    const end = horiz ? { x: start.x + sign * len, y: start.y } : { x: start.x, y: start.y + sign * len };
    if (addWallSegment(start, end)) wallDraw.start = end;
    requestRender();
    return true;
  }
  return false;
}

export function resetCalibration() {
  calibPoints = [];
  requestRender();
}

export function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}

// ---------------- 描画 ----------------
function render() {
  const p = state.project;
  if (!p || !svg) return;
  const px = 1 / view.k;
  const st = state.settings;

  // グリッド
  const { w, h } = size();
  const g = st.gridSize;
  const minor = svg.querySelector('#grid-minor'), major = svg.querySelector('#grid-major');
  minor.setAttribute('width', g); minor.setAttribute('height', g);
  minor.firstElementChild.setAttribute('d', `M${g} 0 L0 0 0 ${g}`);
  minor.firstElementChild.setAttribute('stroke-width', 0.8 * px);
  major.firstElementChild.setAttribute('stroke-width', 1 * px);
  if (st.grid) {
    const showMinor = g * view.k >= 6;
    layers.grid.innerHTML = (showMinor ? `<rect x="${view.x}" y="${view.y}" width="${w * px}" height="${h * px}" fill="url(#grid-minor)"/>` : '')
      + `<rect x="${view.x}" y="${view.y}" width="${w * px}" height="${h * px}" fill="url(#grid-major)"/>`;
  } else layers.grid.innerHTML = '';

  // 背景画像（DOM要素を再利用して再読み込みを防ぐ）
  const bg = p.background;
  const src = bg && p.assets?.[bg.assetId];
  if (src && bg.visible !== false && st.showBg) {
    if (!bgImage) {
      bgImage = document.createElementNS(NS, 'image');
      bgImage.setAttribute('preserveAspectRatio', 'none');
      bgImage.classList.add('bg-image');
      layers.bg.appendChild(bgImage);
    }
    if (bgSrc !== src) { bgImage.setAttribute('href', src); bgSrc = src; }
    bgImage.setAttribute('x', bg.x); bgImage.setAttribute('y', bg.y);
    bgImage.setAttribute('width', bg.width); bgImage.setAttribute('height', bg.height);
    bgImage.setAttribute('opacity', bg.opacity ?? 0.9);
    bgImage.style.pointerEvents = state.mode === 'bg' ? 'auto' : 'none';
    bgImage.style.display = '';
  } else if (bgImage) {
    bgImage.style.display = 'none';
  }

  // 部屋
  const selOpening = state.selection?.kind === 'opening' ? state.selection.id : null;
  const selWall = state.selection?.kind === 'wall' ? state.selection.id : null;
  layers.room.innerHTML = roomSVG(p, { px, dims: st.dims, selectedId: selOpening, selectedWallId: selWall });

  // 家具（「チェック表示」がオフのときは、問題のある家具の赤い点線を出さない。チェックタブの一覧はそのまま）
  if (state.preview) {
    layers.furniture.innerHTML = furnitureLayerSVG(state.preview.proposal.furniture, { validation: st.issues ? previewValidation : null, labels: st.labels, interactive: false });
  } else {
    layers.furniture.innerHTML = furnitureLayerSVG(furnitureList(), { validation: st.issues ? validation : null, labels: st.labels });
  }

  layers.overlay.innerHTML = overlaySVG(p, px);
}

function overlaySVG(p, px) {
  let s = '';
  const st = state.settings;

  if (flowOverlay.on) {
    const v = state.preview ? previewValidation : validation;
    const flow = v?.flow;
    if (flow) {
      const key = flow.reach;
      if (flowOverlay.key !== key) {
        const c = document.createElement('canvas');
        c.width = flow.nx; c.height = flow.ny;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(flow.nx, flow.ny);
        for (let k = 0; k < flow.reach.length; k++) {
          if (!flow.reach[k]) continue;
          img.data[k * 4] = 60; img.data[k * 4 + 1] = 170; img.data[k * 4 + 2] = 110; img.data[k * 4 + 3] = 70;
        }
        ctx.putImageData(img, 0, 0);
        flowOverlay.url = c.toDataURL();
        flowOverlay.key = key;
      }
      s += `<image href="${flowOverlay.url}" x="${p.room.x}" y="${p.room.y}" width="${flow.nx * flow.cell}" height="${flow.ny * flow.cell}" preserveAspectRatio="none" style="image-rendering:pixelated;pointer-events:none"/>`;
    }
  }

  // 選択中の家具（複数選択のときは枠だけ。ハンドルは出さない）
  if (!state.preview && state.selection?.kind === 'furniture') {
    const ids = selectedIds();
    if (ids.length > 1) {
      for (const id of ids) {
        const f = getItem(id);
        if (!f) continue;
        s += `<g transform="translate(${f.x} ${f.y}) rotate(${f.rotation || 0})"><rect x="${-f.width / 2 - 3 * px}" y="${-f.depth / 2 - 3 * px}" width="${f.width + 6 * px}" height="${f.depth + 6 * px}" fill="rgba(31,111,235,0.06)" stroke="#1f6feb" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-dasharray="5 3" style="pointer-events:none"/></g>`;
      }
    } else {
      const f = getItem(state.selection.id);
      if (f) s += selectionSVG(p, f, px, st);
    }
  }
  // 壁を描く（引いている途中の壁・長さ・吸い付いた点）
  if (state.mode !== 'draw-wall') wallDraw = null;
  if (wallDraw?.cur) {
    const t = state.settings.wallThickness || 12;
    const { start, cur } = wallDraw;
    const fs = 13 * px;
    s += `<circle cx="${cur.x}" cy="${cur.y}" r="${(wallDraw.snapped ? 6 : 4) * px}" fill="${wallDraw.snapped ? '#16a34a' : '#c2410c'}" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
    if (start) {
      const horiz = Math.abs(cur.x - start.x) >= Math.abs(cur.y - start.y);
      const len = Math.round(Math.hypot(cur.x - start.x, cur.y - start.y));
      const x = Math.min(start.x, cur.x) - (horiz ? t / 2 : t / 2), y = Math.min(start.y, cur.y) - t / 2;
      const w = horiz ? Math.abs(cur.x - start.x) + t : t, h = horiz ? t : Math.abs(cur.y - start.y) + t;
      s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(61,58,55,0.55)" stroke="#c2410c" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-dasharray="5 3" style="pointer-events:none"/>`;
      s += `<circle cx="${start.x}" cy="${start.y}" r="${4 * px}" fill="#c2410c" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
      const label = wallDraw.typed ? `${wallDraw.typed} cm（Enter で確定）` : `${len} cm`;
      s += `<text x="${(start.x + cur.x) / 2 + (horiz ? 0 : 14 * px)}" y="${(start.y + cur.y) / 2 - (horiz ? 12 * px : 0)}" font-size="${fs}" font-weight="700" text-anchor="${horiz ? 'middle' : 'start'}" fill="#c2410c" stroke="#fff" stroke-width="${fs * 0.3}" paint-order="stroke" style="pointer-events:none">${label}</text>`;
    }
  }
  // 距離を測る
  if (state.mode !== 'measure') measure = null;
  if (measure) {
    const { a, b } = measure;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const fs = 13 * px;
    s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#7c3aed" stroke-width="2" vector-effect="non-scaling-stroke" ${measure.done ? '' : 'stroke-dasharray="6 4"'} style="pointer-events:none"/>`;
    for (const q of [a, b]) s += `<circle cx="${q.x}" cy="${q.y}" r="${4 * px}" fill="#7c3aed" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
    if (len > 1) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      s += `<text x="${mx}" y="${my - 8 * px}" font-size="${fs}" font-weight="700" text-anchor="middle" fill="#7c3aed" stroke="#fff" stroke-width="${fs * 0.3}" paint-order="stroke" style="pointer-events:none">${Math.round(len)} cm</text>`;
    }
  }
  if (marquee) {
    const r = normRect(marquee);
    s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(31,111,235,0.08)" stroke="#1f6feb" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-dasharray="4 3" style="pointer-events:none"/>`;
  }

  // 背景調整モード
  if (state.mode === 'bg' && p.background) {
    const bg = p.background;
    const hs = 12 * px;
    s += `<rect x="${bg.x}" y="${bg.y}" width="${bg.width}" height="${bg.height}" fill="none" stroke="#c2410c" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="6 4" style="pointer-events:none"/>`;
    s += `<rect data-handle="bg-se" x="${bg.x + bg.width - hs / 2}" y="${bg.y + bg.height - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="#c2410c" stroke-width="2" vector-effect="non-scaling-stroke" class="handle-se"/>`;
  }

  // 縮尺設定
  if (state.mode === 'calibrate') {
    for (const [i, pt] of calibPoints.entries()) {
      s += `<circle cx="${pt.x}" cy="${pt.y}" r="${6 * px}" fill="#c2410c" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      s += `<text x="${pt.x + 9 * px}" y="${pt.y - 9 * px}" font-size="${12 * px}" fill="#c2410c" font-weight="700">${i + 1}</text>`;
    }
    if (calibPoints.length === 2) {
      const [a, b] = calibPoints;
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#c2410c" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    }
  }

  if (roomDraft?.erase) {
    const r = normRect(roomDraft);
    s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(220,60,50,0.18)" stroke="#d93a2f" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="6 4"/>`;
  } else if (roomDraft) {
    const r = normRect(roomDraft);
    s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(31,111,235,0.08)" stroke="#1f6feb" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="6 4"/>`;
    s += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" font-size="${14 * px}" text-anchor="middle" fill="#1f6feb">${Math.round(r.w)} × ${Math.round(r.h)} cm</text>`;
  }
  return s;
}

function selectionSVG(p, f, px, st) {
  const hs = 10 * px;
  const pad = 3 * px;
  const hw = f.width / 2, hd = f.depth / 2;
  let s = `<g transform="translate(${f.x} ${f.y}) rotate(${f.rotation || 0})">`;
  s += `<rect x="${-hw - pad}" y="${-hd - pad}" width="${f.width + pad * 2}" height="${f.depth + pad * 2}" fill="none" stroke="#1f6feb" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-dasharray="5 3" style="pointer-events:none"/>`;
  if (!f.locked) {
    const hpos = { nw: [-hw, -hd], n: [0, -hd], ne: [hw, -hd], e: [hw, 0], se: [hw, hd], s: [0, hd], sw: [-hw, hd], w: [-hw, 0] };
    const rotY = -hd - 30 * px;
    s += `<line x1="0" y1="${-hd - pad}" x2="0" y2="${rotY}" stroke="#1f6feb" stroke-width="1.2" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
    s += `<circle data-handle="rot" cx="0" cy="${rotY}" r="${7 * px}" fill="#fff" stroke="#1f6feb" stroke-width="2" vector-effect="non-scaling-stroke" class="handle-rot"/>`;
    for (const [name, [x, y]] of Object.entries(hpos)) {
      if (name.length === 1 && (name === 'n' || name === 's' ? f.width * view.k < 40 : f.depth * view.k < 40)) continue;
      s += `<rect data-handle="${name}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="#1f6feb" stroke-width="1.6" vector-effect="non-scaling-stroke" class="handle-${name}"/>`;
    }
  }
  s += `</g>`;
  const b = aabb(f);
  const fs = 11 * px;
  const lbl = `${Math.round(f.width)} × ${Math.round(f.depth)} cm${f.locked ? '（固定）' : ''}`;
  s += `<text x="${(b.minX + b.maxX) / 2}" y="${b.maxY + 16 * px}" font-size="${fs}" text-anchor="middle" fill="#1f6feb" stroke="#fff" stroke-width="${fs * 0.35}" paint-order="stroke" style="pointer-events:none">${lbl}</text>`;
  if (st.dims && layerOf(f) !== 'ceiling') s += wallDistanceSVG(p.room, b, px);
  return s;
}

/** Shift を押しているときは、始点から縦か横のまっすぐな線にそろえる */
function alignMeasure(a, b, straight) {
  if (!straight) return b;
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}

function normRect(d) {
  const x = Math.min(d.x1, d.x2), y = Math.min(d.y1, d.y2);
  return { x, y, w: Math.abs(d.x2 - d.x1), h: Math.abs(d.y2 - d.y1) };
}

// ---------------- 操作 ----------------
function snapValue(v, step) {
  return Math.round(v / step) * step;
}

function snapMove(item, nx, ny, noSnap) {
  const half = v => Math.round(v * 2) / 2;
  if (!state.settings.snap || noSnap) return { x: half(nx), y: half(ny) };
  const g = state.settings.gridSize;
  const room = state.project.room;
  const b = aabb({ ...item, x: nx, y: ny });
  const th = Math.max(4, 10 / view.k);
  let dx, dy;
  if (Math.abs(b.minX - room.x) < th) dx = room.x - b.minX;
  else if (Math.abs(b.maxX - room.x - room.width) < th) dx = room.x + room.width - b.maxX;
  else dx = snapValue(b.minX, g) - b.minX;
  if (Math.abs(b.minY - room.y) < th) dy = room.y - b.minY;
  else if (Math.abs(b.maxY - room.y - room.depth) < th) dy = room.y + room.depth - b.maxY;
  else dy = snapValue(b.minY, g) - b.minY;
  return { x: half(nx + dx), y: half(ny + dy) };
}

function alongWall(op, pt) {
  const s = wallSegment(state.project.room, op.wall);
  const ux = (s.x2 - s.x1) / s.len, uy = (s.y2 - s.y1) / s.len;
  return (pt.x - s.x1) * ux + (pt.y - s.y1) * uy;
}

function onPointerDown(e) {
  if (!state.project) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    // ピンチズーム開始
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    if (drag?.tx) endTransaction();
    drag = null;
    return;
  }
  try { svg.setPointerCapture(e.pointerId); } catch { /* キャプチャできない入力は無視 */ }
  const pt = screenToWorld(e.clientX, e.clientY);
  const t = e.target;
  const startPan = () => { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; svg.classList.add('panning'); };

  if (e.button === 1 || e.button === 2 || cb.isSpaceDown?.()) { startPan(); return; }

  if (state.mode === 'calibrate') {
    if (calibPoints.length >= 2) calibPoints = [];
    calibPoints.push(pt);
    requestRender();
    if (calibPoints.length === 2) {
      const [a, b] = calibPoints;
      setTimeout(() => cb.onCalibrate?.(a, b), 30);
    }
    return;
  }
  if (state.mode === 'erase') {
    roomDraft = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, erase: true };
    drag = { type: 'erase' };
    requestRender();
    return;
  }
  // ドア（開き戸・引き戸・折れ戸）・窓を置くモード：[種類, ドアの開き方]
  const PLACE = { 'place-door': ['door'], 'place-sliding': ['door', 'sliding'], 'place-folding': ['door', 'folding'], 'place-window': ['window'] };
  if (PLACE[state.mode]) {
    cb.onPlaceOpening?.(PLACE[state.mode][0], pt, PLACE[state.mode][1]);
    return;
  }
  // 部屋（区切り）を描く：クリックで壁に囲まれた範囲、ドラッグで長方形
  if (state.mode === 'draw-area') {
    roomDraft = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, area: true };
    drag = { type: 'area', sx: e.clientX, sy: e.clientY, pt };
    requestRender();
    return;
  }
  // 壁を描く
  if (state.mode === 'draw-wall') {
    if (e.button === 2) return;
    wallDraw ||= { start: null, cur: null, typed: '' };
    const q = wallPoint(pt, wallDraw.start, e.altKey);
    if (!wallDraw.start) wallDraw.start = { x: q.x, y: q.y };
    else if (addWallSegment(wallDraw.start, q)) wallDraw.start = { x: q.x, y: q.y };
    wallDraw.typed = '';
    requestRender();
    return;
  }
  // 距離を測る：1回目のクリックで始点、2回目で終点。もう一度クリックすると測り直し（Shift で縦・横にそろえる）
  if (state.mode === 'measure') {
    const q = { x: Math.round(pt.x), y: Math.round(pt.y) };
    if (!measure || measure.done) measure = { a: q, b: q, done: false };
    else { measure.b = alignMeasure(measure.a, q, e.shiftKey); measure.done = true; lastMeasure = { a: measure.a, b: measure.b }; }
    requestRender();
    return;
  }
  if (state.mode === 'room') {
    const s = state.settings.snap ? 5 : 1;
    roomDraft = { x1: snapValue(pt.x, s), y1: snapValue(pt.y, s), x2: snapValue(pt.x, s), y2: snapValue(pt.y, s) };
    drag = { type: 'room' };
    requestRender();
    return;
  }
  if (state.mode === 'bg') {
    const bg = state.project.background;
    if (t.closest('[data-handle="bg-se"]')) {
      beginTransaction();
      drag = { type: 'bg-resize', tx: true };
    } else if (t.closest('.bg-image') && bg) {
      beginTransaction();
      drag = { type: 'bg-move', tx: true, ox: pt.x - bg.x, oy: pt.y - bg.y };
    } else startPan();
    return;
  }
  if (state.preview) { startPan(); return; }

  const handle = t.closest('[data-handle]');
  const sel = state.selection?.kind === 'furniture' && selectedIds().length === 1 ? getItem(state.selection.id) : null;
  if (handle && sel && !sel.locked) {
    const h = handle.dataset.handle;
    beginTransaction();
    drag = { type: h === 'rot' ? 'rotate' : 'resize', handle: h, orig: { ...sel }, id: sel.id, tx: true };
    return;
  }
  const fEl = t.closest('[data-id]');
  if (fEl) {
    const item = getItem(fEl.dataset.id);
    if (item) {
      const ids = selectedIds();
      // Shift＋クリック：選択に加える・外す
      if (e.shiftKey) {
        const next = ids.includes(item.id) ? ids.filter(id => id !== item.id) : [...ids, item.id];
        select(next.length ? { kind: 'furniture', id: next[next.length - 1], ids: next.length > 1 ? next : undefined } : null);
        return;
      }
      // 複数選択中の家具をつかんだら、選んだ家具をまとめて動かす（テーブルにつながった椅子も一緒に）
      if (ids.length > 1 && ids.includes(item.id)) {
        const group = withAttachedChairs(ids.map(getItem).filter(Boolean)).filter(f => !f.locked);
        if (!group.length) { startPan(); return; }
        beginTransaction();
        drag = { type: 'move-group', sx0: pt.x, sy0: pt.y, orig: group.map(f => ({ id: f.id, x: f.x, y: f.y })), tx: true, moved: false, sx: e.clientX, sy: e.clientY };
        return;
      }
      select({ kind: 'furniture', id: item.id });
      if (!item.locked) {
        beginTransaction();
        drag = { type: 'move', id: item.id, ox: pt.x - item.x, oy: pt.y - item.y, tx: true, moved: false, sx: e.clientX, sy: e.clientY };
      } else startPan();
      return;
    }
  }
  const wEl = t.closest('[data-wall-id]');
  if (wEl) {
    const w = getWall(wEl.dataset.wallId);
    if (w) {
      select({ kind: 'wall', id: w.id });
      beginTransaction();
      drag = { type: 'wall', id: w.id, ox: pt.x - w.x, oy: pt.y - w.y, tx: true };
      return;
    }
  }
  const oEl = t.closest('[data-opening-id]');
  if (oEl) {
    const op = getOpening(oEl.dataset.openingId);
    if (op) {
      select({ kind: 'opening', id: op.id });
      beginTransaction();
      drag = op.wall === 'free'
        ? { type: 'opening', id: op.id, ox: pt.x - op.x, oy: pt.y - op.y, tx: true }
        : { type: 'opening', id: op.id, grab: alongWall(op, pt) - op.offset, tx: true };
      return;
    }
  }
  // Shift＋何もない所をドラッグ：範囲選択
  if (e.shiftKey) {
    marquee = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    drag = { type: 'marquee' };
    requestRender();
    return;
  }
  if (state.selection) select(null);
  startPan();
}

function onPointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const pt = screenToWorld(e.clientX, e.clientY);
  cb.onCursor?.(pt);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    // 2本指を動かした分だけ画面を動かしてから、指の間を中心にズームする
    view.x -= (mx - pinch.mx) / view.k;
    view.y -= (my - pinch.my) / view.k;
    pinch.mx = mx; pinch.my = my;
    const f = (pinch.k * d / pinch.d) / view.k;
    zoomBy(f, mx, my);
    return;
  }
  if (state.mode === 'draw-wall') {
    wallDraw ||= { start: null, cur: null, typed: '' };
    const q = wallPoint(pt, wallDraw.start, e.altKey);
    wallDraw.cur = { x: q.x, y: q.y };
    wallDraw.snapped = q.snapped;
    requestRender();
  }
  if (measure && !measure.done && state.mode === 'measure') {
    measure.b = alignMeasure(measure.a, { x: Math.round(pt.x), y: Math.round(pt.y) }, e.shiftKey);
    requestRender();
  }
  if (!drag) return;
  const p = state.project;

  switch (drag.type) {
    case 'pan': {
      view.x = drag.vx - (e.clientX - drag.sx) / view.k;
      view.y = drag.vy - (e.clientY - drag.sy) / view.k;
      applyView();
      requestRender();
      return;
    }
    case 'move': {
      const item = getItem(drag.id);
      if (!item) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      drag.moved = true;
      const pos = snapMove(item, pt.x - drag.ox, pt.y - drag.oy, e.altKey);
      const before = poseOf(item);
      item.x = pos.x; item.y = pos.y;
      followTable(item, before); // テーブルにつながった椅子も一緒に動かす
      break;
    }
    case 'move-group': {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      drag.moved = true;
      const step = state.settings.snap && !e.altKey ? 5 : 1;
      const dx = snapValue(pt.x - drag.sx0, step), dy = snapValue(pt.y - drag.sy0, step);
      for (const o of drag.orig) { const f = getItem(o.id); if (f) { f.x = o.x + dx; f.y = o.y + dy; } }
      break;
    }
    case 'area': {
      const step = state.settings.snap ? 5 : 1;
      roomDraft.x2 = snapValue(pt.x, step); roomDraft.y2 = snapValue(pt.y, step);
      roomDraft.x1 = snapValue(roomDraft.x1, step); roomDraft.y1 = snapValue(roomDraft.y1, step);
      requestRender();
      return;
    }
    case 'marquee': {
      marquee.x2 = pt.x; marquee.y2 = pt.y;
      requestRender();
      return;
    }
    case 'resize': {
      const item = getItem(drag.id);
      const o = drag.orig;
      const lp = worldToLocal(o, pt.x, pt.y);
      let l = -o.width / 2, r = o.width / 2, t = -o.depth / 2, b = o.depth / 2;
      const h = drag.handle;
      if (h.includes('e')) r = lp.x;
      if (h.includes('w')) l = lp.x;
      if (h.includes('s')) b = lp.y;
      if (h.includes('n')) t = lp.y;
      const step = state.settings.snap && !e.altKey ? 5 : 1;
      const width = Math.max(10, snapValue(r - l, step)), depth = Math.max(10, snapValue(b - t, step));
      if (h.includes('w')) l = r - width; else r = l + width;
      if (h.includes('n')) t = b - depth; else b = t + depth;
      const c = localToWorld(o, (l + r) / 2, (t + b) / 2);
      Object.assign(item, { width, depth, x: Math.round(c.x * 2) / 2, y: Math.round(c.y * 2) / 2 });
      break;
    }
    case 'rotate': {
      const item = getItem(drag.id);
      let ang = Math.atan2(pt.x - item.x, -(pt.y - item.y)) * 180 / Math.PI;
      ang = e.shiftKey ? Math.round(ang) : Math.round(ang / 15) * 15;
      const before = poseOf(item);
      item.rotation = normAngle(ang);
      followTable(item, before);
      break;
    }
    case 'opening': {
      const op = getOpening(drag.id);
      if (op.wall === 'free') {
        // 内壁のドア・窓：壁の近くでは壁の中心線にそろえる
        const step = state.settings.snap ? 5 : 1;
        const target = { x: snapValue(pt.x - drag.ox, step), y: snapValue(pt.y - drag.oy, step) };
        op.x = target.x; op.y = target.y;
        cb.snapOpening?.(op, target);
        break;
      }
      const len = wallSegment(p.room, op.wall).len;
      const step = state.settings.snap ? 5 : 1;
      op.offset = clamp(snapValue(alongWall(op, pt) - drag.grab, step), 0, len - op.width);
      break;
    }
    case 'wall': {
      const w = getWall(drag.id);
      const step = state.settings.snap && !e.altKey ? 5 : 1;
      w.x = snapValue(pt.x - drag.ox, step); w.y = snapValue(pt.y - drag.oy, step);
      break;
    }
    case 'bg-move': {
      const bg = p.background;
      bg.x = Math.round(pt.x - drag.ox); bg.y = Math.round(pt.y - drag.oy);
      syncRoomToImage(p);
      break;
    }
    case 'bg-resize': {
      const bg = p.background;
      const w = Math.max(50, pt.x - bg.x);
      bg.width = Math.round(w);
      bg.height = Math.round(w * bg.naturalHeight / bg.naturalWidth);
      if (p.scale?.status !== 'unset') p.scale = { status: 'unset', cmPerPx: null };
      syncRoomToImage(p);
      break;
    }
    case 'erase': {
      roomDraft.x2 = pt.x; roomDraft.y2 = pt.y;
      requestRender();
      return;
    }
    case 'room': {
      const s = state.settings.snap ? 5 : 1;
      roomDraft.x2 = snapValue(pt.x, s); roomDraft.y2 = snapValue(pt.y, s);
      requestRender();
      return;
    }
  }
  emit('drag');
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  try { svg.releasePointerCapture(e.pointerId); } catch { /* 既に解放済み */ }
  svg.classList.remove('panning');
  if (!drag) return;
  if (drag.type === 'erase' && roomDraft) {
    const r = normRect(roomDraft);
    roomDraft = null;
    // クリックだけの場合は、その位置の壁を 30cm 四方だけ消す
    const rect = r.w < 3 && r.h < 3 ? { x: r.x - 15, y: r.y - 15, w: 30, h: 30 } : { x: r.x, y: r.y, w: r.w, h: r.h };
    cb.onErase?.(rect);
    requestRender();
  }
  if (drag.type === 'room' && roomDraft) {
    const r = normRect(roomDraft);
    roomDraft = null;
    if (r.w >= 50 && r.h >= 50) cb.onRoomDrawn?.(r);
    else requestRender();
  }
  if (drag.type === 'area') {
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8;
    const r = normRect(roomDraft);
    roomDraft = null;
    if (moved) {
      if (r.w >= 30 && r.h >= 30) cb.onAreaDrawn?.({ x: r.x, y: r.y, width: r.w, depth: r.h });
    } else {
      const found = enclosedRect(state.project, drag.pt);
      if (found) cb.onAreaDrawn?.(found);
      else cb.onAreaMissed?.();
    }
    requestRender();
  }
  if (drag.type === 'marquee' && marquee) {
    // 範囲の中に中心がある家具を、今の選択に加える
    const r = normRect(marquee);
    marquee = null;
    const inside = furnitureList().filter(f => f.x >= r.x && f.x <= r.x + r.w && f.y >= r.y && f.y <= r.y + r.h).map(f => f.id);
    const ids = [...new Set([...selectedIds(), ...inside])];
    select(ids.length ? { kind: 'furniture', id: ids[ids.length - 1], ids: ids.length > 1 ? ids : undefined } : null);
    requestRender();
  }
  if (drag.tx) endTransaction();
  drag = null;
}

function onWheel(e) {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  zoomBy(f, e.clientX, e.clientY);
}
