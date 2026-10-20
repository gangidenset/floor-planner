// 間取り（部屋の輪郭・ドア・窓・収納）と背景画像、縮尺の管理
import { escapeHtml, dist } from './geometry.js';

export const WALL_LABELS = { top: '上の壁', right: '右の壁', bottom: '下の壁', left: '左の壁' };
export const OPENING_LABELS = { door: 'ドア', window: '窓', closet: '収納扉' };
// ドアの開き方。style が無いものは開き戸
export const DOOR_STYLE_LABELS = { swing: '開き戸', sliding: '引き戸', folding: '折れ戸' };
export const doorStyle = op => (op.type === 'door' && DOOR_STYLE_LABELS[op.style] ? op.style : 'swing');

/** 壁の始点・終点・内向き法線 */
export function wallSegment(room, wall) {
  const { x, y, width: W, depth: D } = room;
  switch (wall) {
    case 'top': return { x1: x, y1: y, x2: x + W, y2: y, nx: 0, ny: 1, len: W };
    case 'bottom': return { x1: x, y1: y + D, x2: x + W, y2: y + D, nx: 0, ny: -1, len: W };
    case 'left': return { x1: x, y1: y, x2: x, y2: y + D, nx: 1, ny: 0, len: D };
    case 'right': default: return { x1: x + W, y1: y, x2: x + W, y2: y + D, nx: -1, ny: 0, len: D };
  }
}

/** 開口部の両端点（ワールド座標） */
export function openingEnds(room, op) {
  if (op.wall === 'free') {
    // 内壁などに置いたドア・窓：中心 (x, y)・向き orient（'h' 横向きの壁 / 'v' 縦向きの壁）・開く側 side（+1 / -1）
    const horiz = op.orient !== 'v';
    const ux = horiz ? 1 : 0, uy = horiz ? 0 : 1;
    const a = { x: op.x - ux * op.width / 2, y: op.y - uy * op.width / 2 };
    const b = { x: a.x + ux * op.width, y: a.y + uy * op.width };
    const sd = op.side === -1 ? -1 : 1;
    return { a, b, nx: horiz ? 0 : sd, ny: horiz ? sd : 0, ux, uy };
  }
  const s = wallSegment(room, op.wall);
  const ux = (s.x2 - s.x1) / s.len, uy = (s.y2 - s.y1) / s.len;
  const a = { x: s.x1 + ux * op.offset, y: s.y1 + uy * op.offset };
  const b = { x: a.x + ux * op.width, y: a.y + uy * op.width };
  return { a, b, nx: s.nx, ny: s.ny, ux, uy };
}

/** 開口部の前に確保すべき領域（検証用の多角形） */
export function openingClearZone(room, op) {
  const { a, b, nx, ny } = openingEnds(room, op);
  let depth;
  // 開き戸は扉が回る範囲、折れ戸は扉が折れて出る範囲（幅の半分ほど）、引き戸は出入りのための前の空き
  if (op.type === 'door') depth = doorStyle(op) === 'sliding' ? 40 : doorStyle(op) === 'folding' ? op.width / 2 + 5 : op.width + 5;
  else if (op.type === 'closet') depth = 70;
  else depth = op.sill === 'floor' ? 50 : 30;
  return [a, b, { x: b.x + nx * depth, y: b.y + ny * depth }, { x: a.x + nx * depth, y: a.y + ny * depth }];
}

/** 内壁に置いたドア・窓が壁を切り欠く範囲 */
export function openingGapRect(op, depth = 40) {
  const horiz = op.orient !== 'v';
  return horiz
    ? { x: op.x - op.width / 2, y: op.y - depth / 2, w: op.width, h: depth }
    : { x: op.x - depth / 2, y: op.y - op.width / 2, w: depth, h: op.width };
}

export function clampOpening(room, op) {
  if (op.wall === 'free') { op.width = Math.max(30, op.width); return op; }
  const len = wallSegment(room, op.wall).len;
  op.width = Math.max(30, Math.min(op.width, len));
  op.offset = Math.max(0, Math.min(op.offset, len - op.width));
  return op;
}

/** 部屋の輪郭・開口部・寸法の SVG */
export function roomSVG(project, opts = {}) {
  const { px = 1, dims = true, interactive = true, selectedId = null } = opts;
  const r = project.room;
  const wallW = 10;
  let s = '';
  s += `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.depth}" fill="rgba(255,255,255,0.35)" stroke="none" ${interactive ? 'class="room-floor"' : ''}/>`;
  if (r.followImage) {
    s += `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.depth}" fill="none" stroke="#9b938a" stroke-width="1.2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`;
  } else {
    s += `<rect x="${r.x - wallW / 2}" y="${r.y - wallW / 2}" width="${r.width + wallW}" height="${r.depth + wallW}" fill="none" stroke="#3d3a37" stroke-width="${wallW}" stroke-linejoin="miter"/>`;
  }

  // 部屋（エリア）の名前
  for (const a of project.areas || []) {
    const fs = 11 * px;
    s += `<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.depth}" fill="none" stroke="#9b938a" stroke-width="1" stroke-dasharray="2 4" vector-effect="non-scaling-stroke" style="pointer-events:none"/>`;
    s += `<text x="${a.x + 6 * px}" y="${a.y + 14 * px}" font-size="${fs}" fill="#8a8178" style="pointer-events:none">${escapeHtml(a.label)}</text>`;
  }
  // 内壁（画像から作成した壁・手動で追加した壁）
  for (const w of project.walls || []) {
    const sel = opts.selectedWallId === w.id;
    s += `<rect ${interactive ? `class="wall" data-wall-id="${w.id}"` : ''} x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="#3d3a37" ${sel ? 'stroke="#1f6feb" stroke-width="3" vector-effect="non-scaling-stroke"' : ''}/>`;
  }

  for (const op of project.openings) {
    const { a, b, nx, ny } = openingEnds(r, op);
    const sel = op.id === selectedId;
    const cls = interactive ? `class="opening" data-opening-id="${op.id}"` : '';
    s += `<g ${cls}>`;
    // 壁を切り欠く
    if (op.wall === 'free') {
      const g = openingGapRect(op, 30);
      s += `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" fill="#ffffff" fill-opacity="0.92"/>`;
    } else {
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ffffff" stroke-width="${wallW + 2}"/>`;
    }
    if (op.type === 'door' && doorStyle(op) === 'sliding') {
      // 引き戸：壁の中で少しずらして重なる2枚の戸
      const ux = b.x - a.x, uy = b.y - a.y;
      const panel = (t0, t1, off) => `<line x1="${a.x + ux * t0 + nx * off}" y1="${a.y + uy * t0 + ny * off}" x2="${a.x + ux * t1 + nx * off}" y2="${a.y + uy * t1 + ny * off}" stroke="#d07a2a" stroke-width="2.6" vector-effect="non-scaling-stroke"/>`;
      s += panel(0, 0.58, -2.5) + panel(0.42, 1, 2.5);
    } else if (op.type === 'door' && doorStyle(op) === 'folding') {
      // 折れ戸：2枚の戸がくの字に折れて手前に出る
      const hingeStart = op.hinge !== 'end';
      const h = hingeStart ? a : b, e = hingeStart ? b : a;
      const fold = op.width / 2;
      const mid = { x: (h.x + e.x) / 2 + nx * fold * 0.85, y: (h.y + e.y) / 2 + ny * fold * 0.85 };
      s += `<path d="M${h.x},${h.y} L${mid.x},${mid.y} L${e.x},${e.y}" fill="rgba(240,150,60,0.10)" stroke="#d07a2a" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    } else if (op.type === 'door') {
      const hingeStart = op.hinge !== 'end';
      const h = hingeStart ? a : b, e = hingeStart ? b : a;
      const open = { x: h.x + nx * op.width, y: h.y + ny * op.width };
      const cross = (e.x - h.x) * ny - (e.y - h.y) * nx;
      const sweep = cross > 0 ? 0 : 1;
      s += `<path d="M${h.x},${h.y} L${open.x},${open.y} A${op.width},${op.width} 0 0 ${sweep} ${e.x},${e.y}" fill="rgba(240,150,60,0.10)" stroke="#d07a2a" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-dasharray="4 3"/>`;
      s += `<line x1="${h.x}" y1="${h.y}" x2="${open.x}" y2="${open.y}" stroke="#d07a2a" stroke-width="2.2" vector-effect="non-scaling-stroke"/>`;
    } else if (op.type === 'window') {
      const off = 3;
      for (const k of [-off, off]) {
        s += `<line x1="${a.x + nx * k}" y1="${a.y + ny * k}" x2="${b.x + nx * k}" y2="${b.y + ny * k}" stroke="#3b82c4" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
      }
      if (op.sill === 'floor') {
        const z = openingClearZone(r, op);
        s += `<polygon points="${z.map(p => `${p.x},${p.y}`).join(' ')}" fill="rgba(59,130,196,0.06)" stroke="none"/>`;
      }
    } else {
      const d = 8;
      s += `<path d="M${a.x},${a.y} L${a.x + nx * d},${a.y + ny * d} L${b.x + nx * d},${b.y + ny * d} L${b.x},${b.y}" fill="rgba(140,120,200,0.12)" stroke="#7a68b8" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
    }
    // クリック判定用の透明な帯
    if (interactive) {
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="${Math.max(16 * px, 14)}"/>`;
    }
    if (sel) {
      s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#1f6feb" stroke-width="3" vector-effect="non-scaling-stroke" stroke-opacity="0.85"/>`;
    }
    const fs = 11 * px;
    const labelOff = op.type !== 'door' ? 18 * px : doorStyle(op) === 'sliding' ? 16 * px : doorStyle(op) === 'folding' ? op.width * 0.25 : op.width * 0.5;
    const mx = (a.x + b.x) / 2 + nx * labelOff, my = (a.y + b.y) / 2 + ny * labelOff;
    s += `<text x="${mx}" y="${my}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="#6b625a" stroke="#fff" stroke-width="${fs * 0.25}" paint-order="stroke" style="pointer-events:none">${escapeHtml(op.label || OPENING_LABELS[op.type])}</text>`;
    s += `</g>`;
  }

  if (dims) s += roomDimsSVG(r, px);
  return s;
}

function dimLine(x1, y1, x2, y2, label, px, offX, offY) {
  const fs = 12 * px;
  const tick = 6 * px;
  const ax = x1 + offX, ay = y1 + offY, bx = x2 + offX, by = y2 + offY;
  const vertical = Math.abs(bx - ax) < Math.abs(by - ay);
  let s = `<g class="dim" style="pointer-events:none">`;
  s += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#7d756d" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  if (vertical) {
    s += `<line x1="${ax - tick}" y1="${ay}" x2="${ax + tick}" y2="${ay}" stroke="#7d756d" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    s += `<line x1="${bx - tick}" y1="${by}" x2="${bx + tick}" y2="${by}" stroke="#7d756d" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  } else {
    s += `<line x1="${ax}" y1="${ay - tick}" x2="${ax}" y2="${ay + tick}" stroke="#7d756d" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    s += `<line x1="${bx}" y1="${by - tick}" x2="${bx}" y2="${by + tick}" stroke="#7d756d" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const rot = vertical ? `rotate(-90 ${mx} ${my})` : '';
  s += `<text x="${mx}" y="${my}" transform="${rot}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="#4a443f" stroke="#fafaf8" stroke-width="${fs * 0.35}" paint-order="stroke">${label}</text>`;
  return s + '</g>';
}

export function roomDimsSVG(r, px) {
  const gap = 26 * px;
  return dimLine(r.x, r.y, r.x + r.width, r.y, `${Math.round(r.width)} cm`, px, 0, -gap)
    + dimLine(r.x, r.y, r.x, r.y + r.depth, `${Math.round(r.depth)} cm`, px, -gap, 0);
}

/** 家具から壁までの距離表示 */
export function wallDistanceSVG(room, box, px) {
  const fs = 10.5 * px;
  const midX = (box.minX + box.maxX) / 2, midY = (box.minY + box.maxY) / 2;
  const segs = [
    { x1: room.x, y1: midY, x2: box.minX, y2: midY, v: box.minX - room.x },
    { x1: box.maxX, y1: midY, x2: room.x + room.width, y2: midY, v: room.x + room.width - box.maxX },
    { x1: midX, y1: room.y, x2: midX, y2: box.minY, v: box.minY - room.y },
    { x1: midX, y1: box.maxY, x2: midX, y2: room.y + room.depth, v: room.y + room.depth - box.maxY },
  ];
  let s = '<g style="pointer-events:none">';
  for (const g of segs) {
    if (g.v < 1 || g.v > 1500) continue;
    s += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#1f6feb" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" stroke-opacity="0.7"/>`;
    s += `<text x="${(g.x1 + g.x2) / 2}" y="${(g.y1 + g.y2) / 2}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="#1f6feb" stroke="#fff" stroke-width="${fs * 0.35}" paint-order="stroke">${Math.round(g.v)}</text>`;
  }
  return s + '</g>';
}

// ---------- 背景画像 ----------

const MAX_IMAGE_SIDE = 2400;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('ファイルを読み込めませんでした'));
    fr.readAsDataURL(file);
  });
}

/** 大きな画像は縮小して保存容量を抑える */
async function normalizeImage(dataUrl) {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth, h = img.naturalHeight;
  const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h));
  const cw = Math.round(w * k), ch = Math.round(h * k);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.86), width: cw, height: ch, scaledBy: k };
}

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        const lib = window.pdfjsLib;
        lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(lib);
      };
      s.onerror = () => { pdfjsPromise = null; reject(new Error('PDF読み込みライブラリを取得できませんでした（インターネット接続が必要です）')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

async function pdfToDataURL(file) {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(3, MAX_IMAGE_SIDE / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** PNG / JPG / PDF(1ページ目) を読み込んで dataURL と画素サイズを返す */
export async function importFloorplanFile(file) {
  const name = file.name.toLowerCase();
  let raw;
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    raw = await pdfToDataURL(file);
  } else if (/image\/(png|jpe?g)/.test(file.type) || /\.(png|jpe?g)$/.test(name)) {
    raw = await readAsDataURL(file);
  } else {
    throw new Error('対応していない形式です（PNG / JPG / JPEG / PDF に対応）');
  }
  return normalizeImage(raw);
}

/**
 * 縮尺設定：背景画像上の2点 p1, p2（現在のワールド座標 cm）の実寸が realCm になるよう背景を拡大縮小する。
 * p1 の位置は固定したまま拡大縮小する。
 */
export function applyCalibration(project, p1, p2, realCm) {
  const bg = project.background;
  const d = dist(p1, p2);
  if (!bg || d < 1 || !(realCm > 0)) return false;
  const f = realCm / d;
  bg.x = p1.x + (bg.x - p1.x) * f;
  bg.y = p1.y + (bg.y - p1.y) * f;
  bg.width *= f;
  bg.height *= f;
  project.scale = { status: 'set', cmPerPx: bg.width / bg.naturalWidth, reference: { realCm: Math.round(realCm) } };
  syncRoomToImage(project);
  return true;
}

/** 「画像だけ使う」場合は、配置範囲（部屋）を背景画像の範囲に合わせる */
export function syncRoomToImage(project) {
  const bg = project.background, r = project.room;
  if (!r.followImage || !bg) return;
  r.x = Math.round(bg.x); r.y = Math.round(bg.y);
  r.width = Math.round(bg.width); r.depth = Math.round(bg.height);
}

export function scaleStatusText(project) {
  const s = project.scale || {};
  if (!project.background) return { ok: true, text: '背景画像なし（部屋寸法は入力値）' };
  if (s.status === 'set') return { ok: true, text: `縮尺設定済み（画像1px ≒ ${(s.cmPerPx || 0).toFixed(2)}cm）` };
  if (s.status === 'sample') return { ok: true, text: 'サンプル図面（1px = 1cm、寸法は架空）' };
  return { ok: false, text: '縮尺未設定：背景画像の寸法は目安です' };
}
