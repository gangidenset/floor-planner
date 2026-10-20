// 立体（3D風）表示
// 斜め上から見た図（等角投影）を SVG で描く。壁・ドアや窓の開口・家具を、それぞれの高さで立ち上げる。
// 外部のライブラリを使わず、奥から手前へ順に塗り重ねる（画家のアルゴリズム）。90°ずつ回して見られる。
import { state, furnitureList } from './state.js';
import { modal } from './ui.js';
import { corners, subtractRect, escapeHtml } from './geometry.js';
import { openingEnds, openingGapRect } from './floorplan.js';
import { layerOf } from './data/furniture-library.js';
import { shade } from './furniture.js';

const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
const OUTER = 10; // 外壁の厚み（cm）
const DOOR_TOP = 200; // ドア・窓の上端（cm）
const FRONT_H = 12; // 手前の外壁を切ったときの高さ（cm）

const intersect = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};
const rectPts = r => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

/** 長い箱を短く切る（塗り重ねの順番が崩れにくいように） */
function chunk(r, size = 60) {
  const out = [];
  if (r.w >= r.h) { for (let x = r.x; x < r.x + r.w - 0.01; x += size) out.push({ ...r, x, w: Math.min(size, r.x + r.w - x) }); }
  else { for (let y = r.y; y < r.y + r.h - 0.01; y += size) out.push({ ...r, y, h: Math.min(size, r.y + r.h - y) }); }
  return out;
}

/** 壁（外周と内壁）を、ドア・窓の所をくり抜いた箱の集まりにする */
function wallBoxes(p, wallH) {
  const r = p.room;
  const walls = [
    { outer: true, x: r.x - OUTER, y: r.y - OUTER, w: r.width + OUTER * 2, h: OUTER },
    { outer: true, x: r.x - OUTER, y: r.y + r.depth, w: r.width + OUTER * 2, h: OUTER },
    { outer: true, x: r.x - OUTER, y: r.y, w: OUTER, h: r.depth },
    { outer: true, x: r.x + r.width, y: r.y, w: OUTER, h: r.depth },
    ...(p.walls || []).map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
  ];
  // ドア・窓の開口：壁を貫く長方形と、開口の下（腰壁）・上（垂れ壁）の高さ
  const gaps = p.openings.map(op => {
    let g;
    if (op.wall === 'free') g = openingGapRect(op, 40);
    else {
      const { a, b } = openingEnds(r, op);
      g = { x: Math.min(a.x, b.x) - 15, y: Math.min(a.y, b.y) - 15, w: Math.abs(b.x - a.x) + 30, h: Math.abs(b.y - a.y) + 30 };
      if (a.y === b.y) { g.x += 15; g.w -= 30; } else { g.y += 15; g.h -= 30; }
    }
    const bands = op.type === 'window'
      ? (op.sill === 'floor' ? [[DOOR_TOP, Infinity]] : [[0, 90], [DOOR_TOP, Infinity]])
      : [[DOOR_TOP, Infinity]]; // ドア（開き戸・引き戸・折れ戸）は上の垂れ壁だけ
    return { g, bands, glass: op.type === 'window' };
  });
  const boxes = [];
  for (const w of walls) {
    let pieces = [w];
    for (const { g } of gaps) pieces = pieces.flatMap(pc => subtractRect(pc, g));
    for (const pc of pieces) if (pc.w > 0.5 && pc.h > 0.5) for (const c of chunk(pc)) boxes.push({ pts: rectPts(c), z0: 0, z1: wallH, kind: 'wall', outer: w.outer });
    for (const { g, bands, glass } of gaps) {
      const it = intersect(w, g);
      if (!it) continue;
      for (const [z0, z1] of bands) {
        const top = Math.min(z1, wallH);
        if (top > z0) for (const c of chunk(it)) boxes.push({ pts: rectPts(c), z0, z1: top, kind: 'wall', outer: w.outer });
      }
      if (glass && wallH > 90) for (const c of chunk(it)) boxes.push({ pts: rectPts(c), z0: 90, z1: Math.min(DOOR_TOP, wallH), kind: 'glass', outer: w.outer });
    }
  }
  return boxes;
}

/**
 * 立体の SVG を作る。rot は 0〜3（90°刻みの回転）、wallH は壁の高さ（cm）
 */
export function render3D(p, furniture, { rot = 0, wallH = 100, labels = true, cutFront = true } = {}) {
  const r = p.room;
  const cx = r.x + r.width / 2, cy = r.y + r.depth / 2;
  const ang = (rot * Math.PI) / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  const R = pt => { const dx = pt.x - cx, dy = pt.y - cy; return { x: dx * ca - dy * sa, y: dx * sa + dy * ca }; };
  const P = (pt, z) => ({ X: (pt.x - pt.y) * COS, Y: (pt.x + pt.y) * SIN - z });

  let boxes = wallBoxes(p, wallH);
  // 手前（見る人の側）の外壁は低く切って、部屋の中が見えるようにする
  if (cutFront) {
    const fr = rectPts({ x: r.x, y: r.y, w: r.width, h: r.depth }).map(R);
    const mx = Math.max(...fr.map(q => q.x)), my = Math.max(...fr.map(q => q.y));
    boxes = boxes.filter(b => {
      if (!b.outer) return true;
      const rp = b.pts.map(R), c = { x: rp.reduce((s, q) => s + q.x, 0) / 4, y: rp.reduce((s, q) => s + q.y, 0) / 4 };
      if (c.x < mx && c.y < my) return true;
      if (b.z0 >= FRONT_H) return false;
      b.z1 = Math.min(b.z1, FRONT_H);
      return true;
    });
  }
  for (const f of furniture) {
    if (layerOf(f) === 'ceiling') continue;
    const h = layerOf(f) === 'floor' ? 1 : Math.max(2, f.height || 40);
    boxes.push({ pts: corners(f), z0: 0, z1: h, kind: 'item', color: f.color || '#bbb', label: f.name, center: { x: f.x, y: f.y } });
  }
  // 回転した座標で、奥（x + y が小さい）から手前へ
  for (const b of boxes) {
    b.rp = b.pts.map(R);
    b.depth = Math.max(...b.rp.map(q => q.x + q.y)) * 0.5 + b.rp.reduce((s, q) => s + q.x + q.y, 0) / b.rp.length * 0.5;
  }
  boxes.sort((a, b) => a.depth - b.depth || a.z0 - b.z0 || (a.kind === 'item') - (b.kind === 'item'));

  let svg = '';
  const allX = [], allY = [];
  const poly = (pts, fill, extra = '') => {
    for (const q of pts) { allX.push(q.X); allY.push(q.Y); }
    return `<polygon points="${pts.map(q => `${q.X.toFixed(1)},${q.Y.toFixed(1)}`).join(' ')}" fill="${fill}" ${extra}/>`;
  };
  // 床
  const floor = rectPts({ x: r.x, y: r.y, w: r.width, h: r.depth }).map(R).map(q => P(q, 0));
  svg += poly(floor, '#f4efe6', 'stroke="#d8d0c4" stroke-width="1"');
  for (const a of p.areas || []) {
    const pts = rectPts({ x: a.x, y: a.y, w: a.width, h: a.depth }).map(R).map(q => P(q, 0));
    svg += poly(pts, 'none', 'stroke="#b9ae9f" stroke-width="1" stroke-dasharray="6 4"');
  }
  const labelsSvg = [];
  for (const b of boxes) {
    const base = b.rp;
    // 外向きの法線を求めるため、点の並び順（時計回りか）を調べる
    let area2 = 0;
    for (let i = 0; i < base.length; i++) { const a = base[i], c = base[(i + 1) % base.length]; area2 += a.x * c.y - c.x * a.y; }
    const sign = area2 > 0 ? 1 : -1;
    const top = b.kind === 'wall' ? '#4a4642' : b.kind === 'glass' ? 'rgba(150,200,235,0.35)' : shade(b.color, 0.1);
    const sideA = b.kind === 'wall' ? '#a69e94' : b.kind === 'glass' ? 'rgba(150,200,235,0.45)' : shade(b.color, -0.15);
    const sideB = b.kind === 'wall' ? '#8c857c' : b.kind === 'glass' ? 'rgba(130,185,225,0.5)' : shade(b.color, -0.3);
    const stroke = b.kind === 'glass' ? 'stroke="#7fb3d9" stroke-width="0.6"' : 'stroke="rgba(0,0,0,0.25)" stroke-width="0.6"';
    for (let i = 0; i < base.length; i++) {
      const a = base[i], c = base[(i + 1) % base.length];
      const nx = (c.y - a.y) * sign, ny = -(c.x - a.x) * sign;
      if (nx + ny <= 0) continue; // 見えない面
      const fill = Math.abs(nx) >= Math.abs(ny) ? sideA : sideB;
      svg += poly([P(a, b.z0), P(c, b.z0), P(c, b.z1), P(a, b.z1)], fill, stroke);
    }
    svg += poly(base.map(q => P(q, b.z1)), top, stroke);
    if (labels && b.label) {
      const c = P(R(b.center), b.z1);
      labelsSvg.push(`<text x="${c.X.toFixed(1)}" y="${(c.Y - 4).toFixed(1)}" font-size="13" text-anchor="middle" fill="#2f2b28" stroke="#fff" stroke-width="3.5" paint-order="stroke">${escapeHtml(b.label)}</text>`);
    }
  }
  const pad = 30;
  const x0 = Math.min(...allX) - pad, x1 = Math.max(...allX) + pad, y0 = Math.min(...allY) - pad, y1 = Math.max(...allY) + pad;
  return `<svg viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}" width="100%" style="max-height:66vh;background:#fbfaf8;border-radius:8px" preserveAspectRatio="xMidYMid meet" font-family="'Hiragino Sans','Yu Gothic UI','Meiryo',sans-serif">${svg}${labelsSvg.join('')}</svg>`;
}

export async function open3DView() {
  const furniture = state.preview ? state.preview.proposal.furniture : furnitureList();
  let opts = { rot: 0, wallH: 100, labels: true, cutFront: true };
  await modal({
    title: '立体表示（斜め上から見た図）',
    wide: true,
    body: `
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <button type="button" data-v3="left">⟲ 左に回す</button>
        <button type="button" data-v3="right">右に回す ⟳</button>
        <label style="display:flex;align-items:center;gap:6px">壁の高さ
          <select id="v3-wall"><option value="40">とても低く（床の見取り図）</option><option value="100" selected>低く（家具が見やすい）</option><option value="150">中くらい</option><option value="240">実際の高さ（約240cm）</option></select></label>
        <label class="check"><input type="checkbox" id="v3-labels" checked> 家具の名前</label>
        <label class="check"><input type="checkbox" id="v3-front" checked> 手前の壁を低くする</label>
      </div>
      <div id="v3-view"></div>
      <p class="muted" style="margin:0">家具は登録した高さで立ち上げています。背の高い家具が窓（水色）をふさいでいないか、圧迫感がないかの確認に使えます。重なり方は簡略化しているので、見え方が少しおかしい所があるかもしれません。</p>`,
    buttons: [{ label: '閉じる', value: true, primary: true }],
    onMount: body => {
      const draw = () => { body.querySelector('#v3-view').innerHTML = render3D(state.project, furniture, opts); };
      body.querySelectorAll('[data-v3]').forEach(b => b.addEventListener('click', () => {
        opts = { ...opts, rot: (opts.rot + (b.dataset.v3 === 'left' ? 3 : 1)) % 4 };
        draw();
      }));
      body.querySelector('#v3-wall').addEventListener('change', e => { opts = { ...opts, wallH: Number(e.target.value) }; draw(); });
      body.querySelector('#v3-labels').addEventListener('change', e => { opts = { ...opts, labels: e.target.checked }; draw(); });
      body.querySelector('#v3-front').addEventListener('change', e => { opts = { ...opts, cutFront: e.target.checked }; draw(); });
      draw();
    },
  });
}
