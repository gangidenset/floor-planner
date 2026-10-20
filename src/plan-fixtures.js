// 間取り図の画像から水まわりなどの設備（浴槽・トイレ・洗面台・洗濯機置き場・キッチン・WIC のハンガーラック）を判定する。
// 部屋の大きさ（cm）と、部屋の中の記号（plan-detect.js の symbols）の形・大きさから決める。
// 位置は元画像のピクセル（中心）、大きさは cm、向きは「背面を付ける壁」から決めた回転角で返す。
import { getSpec } from './data/furniture-library.js';

const ROT = { top: 0, right: 90, bottom: 180, left: 270 };
const SIDES = ['top', 'bottom', 'left', 'right'];
const isHoriz = side => side === 'top' || side === 'bottom';
const clamp = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));

/**
 * 四角い記号か（壁に付いた辺は壁と一緒に消えるので、4辺のうち3辺以上に線があればよい）。
 * 設備の記号は輪郭線なので中がすいている。線が詰まった塊（「洗面所」などの文字）は除く
 */
function boxLike(s) {
  const e = s.edges;
  return s.fill <= 0.5 && [e.top, e.bottom, e.left, e.right].filter(v => v >= 0.5).length >= 3;
}

/**
 * 便器の記号か：タンク＋楕円の便座で、幅 25〜60cm・長さ 40〜90cm ほどの縦長の図形。
 * 楕円は外接矩形の辺に少ししか触れないので、四角い記号（洗面台・洗濯機パン）のように3辺以上に沿う図形は除く
 */
function isToiletSymbol(s) {
  const short = Math.min(s.cw, s.ch), long = Math.max(s.cw, s.ch);
  if (short < 25 || short > 60 || long < 40 || long > 90 || long / short < 1.15 || long / short > 2.8 || s.fill > 0.5) return false;
  const e = s.edges;
  return [e.top, e.bottom, e.left, e.right].filter(v => v >= 0.5).length <= 2;
}

/** 記号にいちばん近い部屋の壁 */
function nearestSide(r, s) {
  const d = {
    top: s.y - r.y, bottom: r.y + r.h - (s.y + s.h),
    left: s.x - r.x, right: r.x + r.w - (s.x + s.w),
  };
  return SIDES.reduce((a, b) => (d[b] < d[a] ? b : a));
}

/**
 * 部屋 r の壁 side に背面を付けて置く。along は壁に沿った位置（画像px、x か y）。
 * width は壁に沿った長さ、depth は壁から手前への長さ（cm）
 */
function placeAgainst(r, side, along, width, depth, k) {
  // 部屋より大きい場合は部屋に収まるように縮める（部屋の枠が設備の線で小さめに切れた場合など）
  width = Math.min(width, (isHoriz(side) ? r.w : r.h) * k);
  depth = Math.min(depth, (isHoriz(side) ? r.h : r.w) * k);
  const hw = width / 2 / k, hd = depth / 2 / k;
  const item = { width, depth, rotation: ROT[side] };
  if (isHoriz(side)) {
    item.cx = clamp(along, r.x + hw, r.x + r.w - hw);
    item.cy = side === 'top' ? r.y + hd : r.y + r.h - hd;
  } else {
    item.cy = clamp(along, r.y + hw, r.y + r.h - hw);
    item.cx = side === 'left' ? r.x + hd : r.x + r.w - hd;
  }
  return item;
}

/** 画像上の占有範囲（回転は 90 度単位） */
function footprint(it, k) {
  const turned = it.rotation === 90 || it.rotation === 270;
  const w = (turned ? it.depth : it.width) / k, h = (turned ? it.width : it.depth) / k;
  return { x0: it.cx - w / 2, y0: it.cy - h / 2, x1: it.cx + w / 2, y1: it.cy + h / 2 };
}

function overlaps(a, b, k) {
  const p = footprint(a, k), q = footprint(b, k);
  return p.x0 < q.x1 - 1 && q.x0 < p.x1 - 1 && p.y0 < q.y1 - 1 && q.y0 < p.y1 - 1;
}

/** 部屋の中で、ほかの設備と重ならない壁ぎわの位置を探す（ドアのない壁を優先） */
function placeFree(R, type, placed, k) {
  const spec = getSpec(type);
  const r = R.ri;
  const doors = new Set((r.openings || []).map(o => o.wall));
  const sides = SIDES.slice()
    .sort((a, b) => (doors.has(a) - doors.has(b)) || ((isHoriz(b) ? r.w : r.h) - (isHoriz(a) ? r.w : r.h)));
  for (const side of sides) {
    const start = isHoriz(side) ? r.x : r.y, len = isHoriz(side) ? r.w : r.h;
    if (len * k < spec.width) continue;
    for (const along of [start, start + len, start + len / 2]) {
      const it = placeAgainst(r, side, along, spec.width, spec.depth, k);
      if (placed.every(p => !overlaps(p, it, k))) return it;
    }
  }
  return null;
}

/**
 * rooms: 部屋の枠（画像px、openings 付き）、symbols: 室内の記号、k: 画像1pxあたりの cm
 * inset: 設備を壁から離す量（画像px）。自動で作る壁は少し粗く部屋の内側へはみ出すので、その分だけ内側に置く
 * paper: 図面の背景（紙）の色。水まわりの色分けを見分ける基準
 * 戻り値: { fixtures: [{ type, cx, cy, width, depth, rotation, room }], labels: { 部屋の番号: '浴室' など } }
 */
export function findFixtures(rooms, symbols, k, inset = 0, paper = [255, 255, 255]) {
  const info = rooms.map((r, i) => {
    // 判定は部屋の枠の大きさで行い、置くときは壁から inset だけ内側の枠（ri）を使う
    const ri = { ...r, x: r.x + inset, y: r.y + inset, w: Math.max(1, r.w - inset * 2), h: Math.max(1, r.h - inset * 2) };
    const w = r.w * k, h = r.h * k;
    const syms = (symbols || [])
      .filter(s => {
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        return cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
      })
      .map(s => ({ ...s, cw: s.w * k, ch: s.h * k }));
    return { r, ri, i, w, h, short: Math.min(w, h), long: Math.max(w, h), m2: (w * h) / 10000, syms, kind: null };
  });
  const fixtures = [];
  const labels = {};
  const add = (R, type, it) => { if (it) fixtures.push({ type, room: R.i, ...it }); };
  const largest = info.reduce((a, b) => (!a || b.m2 > a.m2 ? b : a), null);

  // 水まわりの色：物件の図面では浴室・洗面所・トイレが水色（写真では青みのある灰色）で塗られていることが多い。
  // 図面の背景（紙）より青寄りで、紫（赤 > 緑）ではない部屋を水まわりとみなす。白い廊下は背景と同じ色なので含めない
  const coolness = c => c[2] - c[0];
  for (const R of info) {
    const c = R.r.color;
    R.water = !!c && R !== largest && coolness(c) >= coolness(paper) + 12 && c[1] >= c[0] - 2;
  }
  // ドアでつながった部屋（key → 部屋）
  const byKey = new Map(info.filter(R => R.r.key !== undefined).map(R => [R.r.key, R]));
  const doorNeighbors = R => (R.r.openings || [])
    .filter(o => o.side === 'room' && o.width * k >= 45 && byKey.has(o.neighbor))
    .map(o => byKey.get(o.neighbor));

  // 浴室：幅 90cm 以上・1〜4.5㎡ほどの部屋に、部屋の大部分を占める四角い記号（浴槽）がある。
  // 記号が読み取れなくても、水まわりの色で、ドアの先が水まわり（洗面所）だけの部屋は浴室とみなす。
  // 浴室は1か所だけ（浴槽の記号がある部屋を優先。浴室が白く浴槽だけ水色の図面で、洗面所を浴室と間違えないように）
  const bathCands = [];
  for (const R of info) {
    if (R.short < 90 || R.long > 270 || R.m2 < 1.0 || R.m2 > 4.5) continue;
    const tub = R.syms
      .filter(s => boxLike(s) && s.cw * s.ch >= R.w * R.h * 0.2 && Math.max(s.cw / R.w, s.ch / R.h) >= 0.4)
      .sort((a, b) => b.cw * b.ch - a.cw * a.ch)[0];
    const nb = doorNeighbors(R);
    if (!tub && !(R.water && nb.length && nb.every(N => N.water))) continue;
    bathCands.push({ R, tub, score: (tub ? 2 : 0) + (R.water ? 1 : 0) + (tub ? (tub.cw * tub.ch) / (R.w * R.h) : 0) });
  }
  for (const { R, tub } of bathCands.sort((a, b) => b.score - a.score).slice(0, 1)) {
    R.kind = 'bath';
    labels[R.i] = '浴室';
    // 浴槽のある側を奥（背面）にする。浴槽が分からなければドアの反対側
    let side;
    if (tub) {
      const dx = (tub.x + tub.w / 2 - (R.r.x + R.r.w / 2)) / R.r.w, dy = (tub.y + tub.h / 2 - (R.r.y + R.r.h / 2)) / R.r.h;
      side = Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'top' : 'bottom') : (dx < 0 ? 'left' : 'right');
    } else {
      const door = (R.r.openings || []).find(o => o.side === 'room' && o.width * k >= 45);
      side = door ? { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[door.wall] : 'top';
    }
    // 浴槽を奥の壁に置き、手前は洗い場として空ける。大きさは図面の浴槽の記号に合わせる（なければ 140×75cm）
    const along = isHoriz(side) ? R.r.x + R.r.w / 2 : R.r.y + R.r.h / 2;
    const wallLen = (isHoriz(side) ? R.ri.w : R.ri.h) * k;
    const spec = getSpec('bathtub');
    const tubLen = tub ? (isHoriz(side) ? tub.cw : tub.ch) : spec.width;
    const tubDepth = tub ? (isHoriz(side) ? tub.ch : tub.cw) : spec.depth;
    add(R, 'bathtub', placeAgainst(R.ri, side, along, Math.min(wallLen, Math.max(tubLen, 100)), clamp(tubDepth, 55, 90), k));
  }

  // トイレ：小さな部屋（幅 50〜130cm・奥行き 60〜240cm）に便器の記号がある。部屋の色（水色など）では決めない
  const anyWater = info.some(R => R.water);
  let toilets = 0;
  for (const R of info) {
    if (R.kind || toilets >= 2 || R.short < 50 || R.short > 130 || R.long < 60 || R.long > 240 || R.m2 > 2.4) continue;
    const bowl = R.syms.filter(isToiletSymbol).sort((a, b) => b.cw * b.ch - a.cw * a.ch)[0];
    if (!bowl) continue;
    toilets++;
    R.kind = 'toilet';
    labels[R.i] = 'トイレ';
    // 背面は短い辺の壁。便器の記号に近い方、なければドアの反対側
    const shortSides = R.w <= R.h ? ['top', 'bottom'] : ['left', 'right'];
    const door = (R.r.openings || []).find(o => shortSides.includes(o.wall) && o.width * k >= 45);
    let side = nearestSide(R.r, bowl);
    if (!shortSides.includes(side)) side = door ? shortSides.find(s => s !== door.wall) : shortSides[0];
    const along = isHoriz(side) ? R.r.x + R.r.w / 2 : R.r.y + R.r.h / 2;
    const spec = getSpec('toilet');
    add(R, 'toilet', placeAgainst(R.ri, side, along, spec.width, spec.depth, k));
  }

  // 洗面所：浴室のとなりの部屋か、洗濯機パン・洗面台らしい四角い記号がある小さな部屋
  const baths = info.filter(R => R.kind === 'bath');
  const gapCm = (a, b) => {
    const gx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
    const gy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
    return Math.max(gx, gy) * k;
  };
  const pickWater = R => {
    const cands = R.syms.filter(s => boxLike(s) && Math.min(s.cw, s.ch) >= 35 && Math.max(s.cw, s.ch) <= 105);
    const washer = cands.filter(s => Math.min(s.cw, s.ch) >= 50 && Math.max(s.cw, s.ch) / Math.min(s.cw, s.ch) <= 1.3)
      .sort((a, b) => b.cw * b.ch - a.cw * a.ch)[0] || null;
    const sink = cands.filter(s => s !== washer && Math.max(s.cw, s.ch) >= 50)
      .sort((a, b) => b.cw * b.ch - a.cw * a.ch)[0] || null;
    return { washer, sink };
  };
  const smallRooms = info.filter(R => !R.kind && R !== largest && R.m2 >= 1.0 && R.m2 <= 6.5 && R.short >= 80);
  const nextToBath = R => baths.some(B => doorNeighbors(B).includes(R) || gapCm(R.r, B.r) <= 40);
  const washrooms = new Map();
  for (const R of smallRooms) {
    const found = pickWater(R);
    // 色分けされた図面では、水まわりの色の部屋か浴室のとなりの部屋だけ（収納の棚などを洗濯機と間違えないように）
    if ((found.washer || found.sink) && (!anyWater || R.water || nextToBath(R))) washrooms.set(R, found);
  }
  // 記号が見つからなくても、浴室のとなりの部屋は洗面所とみなす（浴室とドアでつながる部屋、水まわりの色の部屋を優先）
  if (baths.length && ![...washrooms.keys()].some(nextToBath)) {
    const score = R => (baths.some(B => doorNeighbors(B).includes(R)) ? 2 : 0) + (R.water ? 1 : 0);
    const next = smallRooms.filter(nextToBath).sort((a, b) => score(b) - score(a) || b.m2 - a.m2)[0];
    if (next) washrooms.set(next, { washer: null, sink: null });
  }
  for (const [R, found] of washrooms) {
    R.kind = 'wash';
    labels[R.i] = '洗面所';
    const placed = [];
    for (const [type, sym] of [['washbasin', found.sink], ['washer', found.washer]]) {
      const spec = getSpec(type);
      let it = null;
      if (sym) {
        const side = nearestSide(R.r, sym);
        const along = isHoriz(side) ? sym.x + sym.w / 2 : sym.y + sym.h / 2;
        it = placeAgainst(R.ri, side, along, spec.width, spec.depth, k);
        if (placed.some(p => overlaps(p, it, k))) it = null;
      }
      it = it || placeFree(R, type, placed, k);
      if (it) { placed.push(it); add(R, type, it); }
    }
  }

  // WIC（ウォークインクローゼット）：収納は赤などの鮮やかな色で塗られていることが多い。
  // 人が入れる幅（90cm 以上）がある鮮やかな色の部屋は WIC とし、長い壁ぎわにハンガーラックを置く（幅の狭い収納には置かない）
  for (const R of info) {
    const c = R.r.color;
    if (R.kind || R.water || !c || R.short < 90 || R.long < 100 || R.m2 > 6) continue;
    if (Math.max(...c) - Math.min(...c) < 80) continue;
    R.kind = 'wic';
    labels[R.i] = 'WIC';
    const doors = new Set((R.r.openings || []).filter(o => o.width * k >= 45).map(o => o.wall));
    const longSides = R.w >= R.h ? ['top', 'bottom'] : ['left', 'right'];
    const side = longSides.find(s => !doors.has(s)) || longSides[0];
    const len = (isHoriz(side) ? R.ri.w : R.ri.h) * k;
    const spec = getSpec('hanger-rack');
    const along = isHoriz(side) ? R.ri.x + R.ri.w / 2 : R.ri.y + R.ri.h / 2;
    add(R, 'hanger-rack', placeAgainst(R.ri, side, along, Math.min(spec.width, len - 10), spec.depth, k));
  }

  // キッチン：6㎡以上の部屋で、壁ぎわにある細長い四角い記号（長さ 120〜330cm・奥行き 40〜110cm）
  for (const R of info) {
    if (R.kind || R.m2 < 6) continue;
    const counter = R.syms.filter(s => {
      const long = Math.max(s.cw, s.ch), short = Math.min(s.cw, s.ch);
      if (!boxLike(s) || long < 120 || long > 330 || short < 40 || short > 110 || long / short < 1.8) return false;
      const side = nearestSide(R.r, s);
      // 長い辺が壁に沿っていて、壁から 30cm 以内
      if (isHoriz(side) !== (s.cw >= s.ch)) return false;
      const gap = { top: s.y - R.r.y, bottom: R.r.y + R.r.h - s.y - s.h, left: s.x - R.r.x, right: R.r.x + R.r.w - s.x - s.w }[side];
      return gap * k <= 30;
    }).sort((a, b) => Math.max(b.cw, b.ch) - Math.max(a.cw, a.ch))[0];
    if (!counter) continue;
    const side = nearestSide(R.r, counter);
    const along = isHoriz(side) ? counter.x + counter.w / 2 : counter.y + counter.h / 2;
    const long = Math.max(counter.cw, counter.ch), short = Math.min(counter.cw, counter.ch);
    add(R, 'kitchen', placeAgainst(R.ri, side, along, Math.round(long), Math.round(clamp(short, 60, 100)), k));
  }

  return { fixtures, labels };
}
