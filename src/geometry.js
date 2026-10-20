// 幾何ユーティリティ（単位はすべて cm）
// 家具は「中心 (x,y)・幅 width・奥行き depth・回転 rotation(度, 時計回り)」の矩形として扱う。
// ローカル座標では「正面」は +y 方向（画面下向き）、背面は -y 方向。

export const DEG = Math.PI / 180;

export function rotatePoint(px, py, deg) {
  const r = deg * DEG;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: px * c - py * s, y: px * s + py * c };
}

/** ローカル座標 → ワールド座標 */
export function localToWorld(item, lx, ly) {
  const p = rotatePoint(lx, ly, item.rotation || 0);
  return { x: item.x + p.x, y: item.y + p.y };
}

/** ワールド座標 → ローカル座標 */
export function worldToLocal(item, wx, wy) {
  return rotatePoint(wx - item.x, wy - item.y, -(item.rotation || 0));
}

/** 回転を考慮した四隅（ワールド座標） */
export function corners(item, margin = 0) {
  const hw = item.width / 2 + margin, hd = item.depth / 2 + margin;
  return [
    localToWorld(item, -hw, -hd),
    localToWorld(item, hw, -hd),
    localToWorld(item, hw, hd),
    localToWorld(item, -hw, hd),
  ];
}

export function aabb(item, margin = 0) {
  const pts = corners(item, margin);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function polyAxes(pts) {
  const axes = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    axes.push({ x: -ey / len, y: ex / len });
  }
  return axes;
}

function project(pts, axis) {
  let min = Infinity, max = -Infinity;
  for (const p of pts) {
    const v = p.x * axis.x + p.y * axis.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** 凸多角形同士の重なり量（SAT）。0 以下なら重なっていない */
export function polygonOverlapDepth(a, b) {
  let minOverlap = Infinity;
  for (const axis of [...polyAxes(a), ...polyAxes(b)]) {
    const pa = project(a, axis), pb = project(b, axis);
    const o = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (o <= 0) return o;
    if (o < minOverlap) minOverlap = o;
  }
  return minOverlap;
}

/** 2つの家具矩形が tolerance(cm) を超えて重なっているか */
export function itemsOverlap(a, b, tolerance = 0.5) {
  return polygonOverlapDepth(corners(a), corners(b)) > tolerance;
}

export function rectPolygon(r) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** 矩形の外にはみ出している量の最大値(cm) */
export function outsideAmount(item, room) {
  let worst = 0;
  for (const p of corners(item)) {
    worst = Math.max(worst, room.x - p.x, p.x - (room.x + room.width), room.y - p.y, p.y - (room.y + room.depth));
  }
  return worst;
}

/** 家具の正面側に伸びるクリアランス領域（ワールド座標の多角形） */
export function frontZone(item, distance) {
  const hw = item.width / 2, hd = item.depth / 2;
  return [
    localToWorld(item, -hw, hd),
    localToWorld(item, hw, hd),
    localToWorld(item, hw, hd + distance),
    localToWorld(item, -hw, hd + distance),
  ];
}

export function normAngle(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return Math.round(a * 10) / 10;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function round(v, step = 1) {
  return Math.round(v / step) * step;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 点が凸多角形の内側にあるか */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 点から多角形までの距離（内側なら 0） */
export function pointPolygonDistance(p, poly) {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter = (idCounter + 1) % 100000;
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${idCounter}`;
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 長方形 r（{x, y, w, h}）から cut を取り除いた残りの長方形（最大4つ） */
export function subtractRect(r, cut) {
  const x0 = Math.max(r.x, cut.x), y0 = Math.max(r.y, cut.y);
  const x1 = Math.min(r.x + r.w, cut.x + cut.w), y1 = Math.min(r.y + r.h, cut.y + cut.h);
  if (x1 <= x0 || y1 <= y0) return [r];
  const out = [];
  if (y0 > r.y) out.push({ ...r, x: r.x, y: r.y, w: r.w, h: y0 - r.y });
  if (y1 < r.y + r.h) out.push({ ...r, x: r.x, y: y1, w: r.w, h: r.y + r.h - y1 });
  if (x0 > r.x) out.push({ ...r, x: r.x, y: y0, w: x0 - r.x, h: y1 - y0 });
  if (x1 < r.x + r.w) out.push({ ...r, x: x1, y: y0, w: r.x + r.w - x1, h: y1 - y0 });
  return out;
}
