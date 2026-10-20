// 部屋（区切り）を描く
// クリックした所から、壁とドア・窓の線で囲まれた範囲を塗りつぶして探し、その範囲を「部屋（区切り）」にする。
// 部屋の区切りは長方形で持つので、L字の部屋などは外接する長方形になる。
import { state, commit } from './state.js';
import { modal } from './ui.js';
import { uid, escapeHtml } from './geometry.js';
import { openingEnds } from './floorplan.js';

const CELL = 5; // 塗りつぶしのマス目（cm）

/** 塗りつぶしをさえぎるもの（壁と、ドア・窓の線）の長方形 */
function barriers(p) {
  const out = (p.walls || []).map(w => ({ x: w.x - 1, y: w.y - 1, w: w.w + 2, h: w.h + 2 }));
  for (const op of p.openings) {
    if (op.wall !== 'free') continue; // 部屋の外周のドア・窓は外周そのもの
    const { a, b } = openingEnds(p.room, op);
    out.push({ x: Math.min(a.x, b.x) - 4, y: Math.min(a.y, b.y) - 4, w: Math.abs(b.x - a.x) + 8, h: Math.abs(b.y - a.y) + 8 });
  }
  return out;
}

/** pt を含む、壁で囲まれた範囲の外接長方形（見つからなければ null） */
export function enclosedRect(p, pt) {
  const r = p.room;
  const nx = Math.ceil(r.width / CELL), ny = Math.ceil(r.depth / CELL);
  const bs = barriers(p);
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = r.x + (i + 0.5) * CELL, cy = r.y + (j + 0.5) * CELL;
    if (bs.some(b => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h)) blocked[j * nx + i] = 1;
  }
  const si = Math.floor((pt.x - r.x) / CELL), sj = Math.floor((pt.y - r.y) / CELL);
  if (si < 0 || sj < 0 || si >= nx || sj >= ny || blocked[sj * nx + si]) return null;
  const seen = new Uint8Array(nx * ny);
  const stack = [sj * nx + si];
  seen[stack[0]] = 1;
  let minI = si, maxI = si, minJ = sj, maxJ = sj, n = 0;
  while (stack.length) {
    const k = stack.pop();
    const i = k % nx, j = (k - i) / nx;
    n++;
    if (i < minI) minI = i; if (i > maxI) maxI = i; if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const kk = jj * nx + ii;
      if (seen[kk] || blocked[kk]) continue;
      seen[kk] = 1;
      stack.push(kk);
    }
  }
  return {
    x: r.x + minI * CELL, y: r.y + minJ * CELL,
    width: Math.min(r.width, (maxI - minI + 1) * CELL), depth: Math.min(r.depth, (maxJ - minJ + 1) * CELL),
    whole: n >= nx * ny * 0.97, // 壁で区切られていない（部屋全体）
  };
}

const NAMES = ['LDK', 'リビング', 'ダイニング', 'キッチン', '洋室', '和室', '寝室', '子ども部屋', '書斎', '玄関', '廊下', '浴室', '洗面所', 'トイレ', 'WIC', '収納'];

/** 名前を聞いて部屋（区切り）を作る */
export async function createArea(rect) {
  const p = state.project;
  const n = (p.areas || []).length + 1;
  const res = await modal({
    title: '部屋（区切り）の名前',
    body: `
      <p style="margin:0">${Math.round(rect.width)} × ${Math.round(rect.depth)} cm（約${(rect.width * rect.depth / 16200).toFixed(1)}畳）の部屋を作ります。名前を付けてください。</p>
      <label class="field">名前<input type="text" id="area-name" value="部屋${n}" maxlength="20"></label>
      <div class="chips">${NAMES.map(s => `<button type="button" class="chip" data-name="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: '作る', value: 'ok', primary: true }],
    onMount: body => {
      body.querySelectorAll('[data-name]').forEach(b => b.addEventListener('click', () => {
        body.querySelector('#area-name').value = b.dataset.name;
        body.querySelector('#area-name').focus();
      }));
    },
    collect: body => body.querySelector('#area-name').value.trim(),
  });
  if (res.value !== 'ok') return null;
  const area = {
    id: uid('area'), label: res.data || `部屋${n}`,
    x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), depth: Math.round(rect.depth), openings: [],
  };
  commit(pr => { pr.areas = [...(pr.areas || []), area]; });
  return area;
}
