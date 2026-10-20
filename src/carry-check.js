// 搬入チェック：家具が玄関と置く部屋のドアを通るか
// 家具はいちばん薄い向き（横に倒した状態）で運ぶものとして、
//   いちばん短い寸法 ≦ ドアの有効幅、2番目に短い寸法 ≦ ドアの高さ（約200cm）なら通れるとみなす。
// 斜めにしたり分解したりすれば通ることもあるので、結果は「可能性」として知らせる。
import { getSpec, layerOf } from './data/furniture-library.js';
import { openingEnds, doorStyle } from './floorplan.js';

export const DOOR_HEIGHT = 200;

// 運び込まないもの（作り付け・敷くもの・天井・部屋そのもの・小さなもの）
const SKIP_GROUPS = ['rug', 'kitchen', 'toilet', 'bath', 'washbasin', 'wic', 'robot', 'robot-dock', 'lamp', 'plant', 'pendant', 'tv'];

/** 運ぶときの寸法 [幅, 奥行き, 高さ]（セットは一番大きい部品） */
export function carryDims(f) {
  const spec = getSpec(f.type);
  if (spec.group === 'dining-set') return [f.width, Math.max(30, f.depth - 84), 72];
  if (spec.group === 'living-set') return [f.width, Math.min(spec.sofaDepth || 85, f.depth), f.height];
  if (spec.group === 'bed-set') return [Math.max(60, f.width - (spec.nightstands || 1) * 43), f.depth, 40];
  return [f.width, f.depth, f.height || 0];
}

export function isCarried(f) {
  if (f.autoFixture || layerOf(f) === 'ceiling') return false;
  return !SKIP_GROUPS.includes(getSpec(f.type).group);
}

/** ドアの有効幅（実際に物が通る幅）。開き戸は枠と扉の厚みの分、引き戸は片側の戸が重なる分を引く */
export function doorClearWidth(op) {
  const s = doorStyle(op);
  if (s === 'sliding') return op.width >= 120 ? Math.round(op.width / 2 - 3) : Math.round(op.width - 8);
  if (s === 'folding') return Math.round(op.width * 0.8);
  return Math.round(op.width - 5);
}

const doorName = op => op.label || 'ドア';

/**
 * 間取りのドアを、玄関（外に面したドア）と、部屋ごとの入口に分ける。
 * 部屋（エリア）がない間取りでは、部屋の外周にあるドアを玄関とみなす
 */
function doorMap(project) {
  const room = project.room;
  const areas = project.areas || [];
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.depth;
  const inside = p => (areas.length ? areas.some(a => inRect(p, a)) : inRect(p, room));
  const doors = project.openings.filter(o => o.type === 'door').map(op => {
    const { a, b, nx, ny } = openingEnds(room, op);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const sides = [30, -30].map(d => ({ x: m.x + nx * d, y: m.y + ny * d }));
    return { op, sides, exterior: sides.some(p => !inside(p)), clear: doorClearWidth(op) };
  });
  const ext = doors.filter(d => d.exterior);
  // 玄関：名前に「玄関」「入口」があればそれ、なければ外に面したドアのうち一番広いもの
  const entrance = ext.find(d => /玄関|入口/.test(d.op.label || '')) || ext.sort((p, q) => q.clear - p.clear)[0] || null;
  const roomDoor = area => doors
    .filter(d => d !== entrance && d.sides.some(p => inRect(p, area)))
    .sort((p, q) => q.clear - p.clear)[0] || null;
  return { entrance, roomDoor, areas, inRect };
}

/**
 * 通らない可能性のある家具の一覧：[{ item, door, clear, need, reason }]
 * results に Map を渡すと、すべての家具の結果（通る／通らない）も入れる（家具リスト用）
 */
export function carryProblems(project, furniture, results = null) {
  const { entrance, roomDoor, areas, inRect } = doorMap(project);
  const out = [];
  for (const f of furniture) {
    if (!isCarried(f)) continue;
    const path = [];
    if (entrance) path.push(entrance);
    const area = areas.find(a => inRect(f, a));
    const rd = area && roomDoor(area);
    if (rd) path.push(rd);
    if (!path.length) continue;
    const narrow = path.reduce((p, q) => (q.clear < p.clear ? q : p));
    const [a, b] = carryDims(f).slice().sort((p, q) => p - q);
    let reason = null;
    if (a > narrow.clear) reason = `いちばん薄い向きでも${Math.round(a)}cm`;
    else if (b > DOOR_HEIGHT) reason = `立てても高さが${Math.round(b)}cm（ドアの高さ約${DOOR_HEIGHT}cm）`;
    // 図面から自動で読み取ったドアは幅が推定なので「要確認」にとどめる
    const r = { item: f, door: narrow.op, clear: narrow.clear, need: Math.round(a), reason, estimated: /（自動/.test(narrow.op.label || '') && !narrow.op.measured };
    results?.set(f.id, r);
    if (reason) out.push(r);
  }
  return out;
}

export function carryMessage(r) {
  if (r.estimated) {
    return `「${r.item.name}」は${doorName(r.door)}（図面からの推定で有効幅 約${r.clear}cm）を通らないかもしれません（${r.reason}）。ドアの幅は推定なので、実際に測って右パネルで直すと正確に判定できます`;
  }
  return `「${r.item.name}」が${doorName(r.door)}（有効幅 約${r.clear}cm）を通らない可能性があります（${r.reason}）。斜めにする・分解する・窓から吊り上げるなどを検討してください`;
}
