// デモモード：ルールベースの家具配置生成（AI API 未設定時に使用）
// 出力は AI API と同じ形式 { proposals: [{ id, title, concept, features, reasons, merits, cautions, furniture }] }
import {
  DEG, corners, outsideAmount, polygonOverlapDepth, localToWorld, rotatePoint, normAngle, uid, deepClone, dist,
} from './geometry.js';
import { getSpec, canOverlap, accessExempt, layerOf, groupOf, ACCESS_RULES } from './data/furniture-library.js';
import { createItem, shade } from './furniture.js';
import { openingClearZone, openingEnds, wallSegment } from './floorplan.js';
import { sideZone, validateLayout, wallPolygons } from './layout-validator.js';

export const TASTES = {
  natural: { label: 'ナチュラル', wood: '#C9A77C', fabric: '#D9CBB5', accent: '#8DA382' },
  nordic: { label: '北欧', wood: '#D8C3A0', fabric: '#B9C3C9', accent: '#E2B654' },
  modern: { label: 'モダン', wood: '#6B5B4E', fabric: '#8E9196', accent: '#3F4A5A' },
  industrial: { label: 'インダストリアル', wood: '#7A5C43', fabric: '#5E5A55', accent: '#B5651D' },
  japanese: { label: '和モダン', wood: '#A88456', fabric: '#CFC4AE', accent: '#6E7F5C' },
  minimal: { label: 'ミニマル', wood: '#E3D7C3', fabric: '#ECEAE5', accent: '#9AA0A6' },
};

export const PURPOSES = {
  ldk: 'LDK（リビング・ダイニング）',
  living: 'リビング',
  bedroom: '寝室',
  study: '書斎・ワークスペース',
  oneroom: 'ワンルーム',
};

const WOOD_GROUPS = ['table', 'dining-set', 'tvboard', 'storage', 'coffee', 'side', 'desk', 'nightstand', 'chair'];
const FABRIC_GROUPS = ['sofa', 'living-set', 'armchair', 'beanbag', 'rug', 'bed', 'bed-set'];

// ---------------------------------------------------------------------------
// 家具セットの準備
// ---------------------------------------------------------------------------
function applyPalette(item, cond) {
  const t = TASTES[cond.taste] || TASTES.natural;
  const g = groupOf(item);
  const fav = cond.favoriteColor;
  if (WOOD_GROUPS.includes(g)) item.color = g === 'chair' ? shade(t.wood, -0.12) : t.wood;
  if (FABRIC_GROUPS.includes(g)) item.color = t.fabric;
  if (fav && (g === 'sofa' || g === 'living-set' || g === 'armchair')) item.color = fav;
  if (fav && g === 'rug') item.color = shade(fav, 0.6);
  if (fav && (g === 'bed' || g === 'bed-set')) item.color = shade(fav, 0.35);
  if (g === 'deskchair') item.color = t.accent;
}

export function buildItemSet(furniture, cond, area = null) {
  const inArea = f => !area || (f.x >= area.x && f.x <= area.x + area.width && f.y >= area.y && f.y <= area.y + area.depth);
  const fixed = furniture.filter(f => f.locked || !inArea(f)).map(deepClone);
  const owned = furniture.filter(f => !f.locked && inArea(f) && (cond.owned || []).includes(f.id)).map(deepClone);
  const notes = [];
  const added = (cond.wanted || []).map(type => {
    const it = createItem(getSpec(type), { id: uid(type) });
    applyPalette(it, cond);
    return it;
  });
  const all = [...owned, ...added];
  const has = g => all.some(i => groupOf(i) === g) || fixed.some(i => groupOf(i) === g);
  const addNew = (type, why) => {
    const it = createItem(getSpec(type), { id: uid(type) });
    applyPalette(it, cond);
    all.push(it);
    if (why) notes.push(why);
  };

  // 人数に合わせてダイニングチェアを調整
  const table = all.find(i => groupOf(i) === 'table');
  if (table && cond.adjustChairs !== false) {
    const people = Math.max(1, Math.min(8, Number(cond.people) || 2));
    const seats = getSpec(table.type).seats || Math.max(2, Math.floor(table.width / 60) * 2);
    const want = Math.min(people, Math.max(seats, 2) + 2);
    let have = all.filter(i => i.type === 'chair').length + all.filter(i => i.type === 'bench').length * 2;
    if (have < want) {
      const n = want - have;
      for (let k = 0; k < n; k++) addNew('chair');
      notes.push(`使用人数（${people}人）に合わせてダイニングチェアを${n}脚追加しました`);
    }
  }
  const pr = cond.priorities || {};
  if (pr.storage && !has('storage')) addNew('shelf-low', '収納重視のため、圧迫感の少ないローボード収納を追加しました');
  const hasSofa = has('sofa') || has('living-set');
  if (pr.relax && hasSofa && !has('rug')) addNew('rug', 'くつろぎ重視のため、ソファ前にラグを追加しました');
  if (pr.relax && hasSofa && !has('lamp')) addNew('floor-lamp', 'くつろぎ重視のため、間接照明（フロアランプ）を追加しました');
  if (pr.design && !has('plant')) addNew('plant-l', 'デザイン重視のため、観葉植物を追加しました');
  return { fixed, items: all, notes };
}

// ---------------------------------------------------------------------------
// 配置エンジン
// ---------------------------------------------------------------------------
function facingVector(rot) {
  return rotatePoint(0, 1, rot);
}

function rotationFacing(vx, vy) {
  return normAngle(Math.atan2(-vx, vy) / DEG);
}

/** 壁に背を向けて置く姿勢。along は壁の始点（左上側）からの距離 */
export function wallPose(room, wall, along, item, gap = 2) {
  const { x, y, width: W, depth: D } = room;
  const d = item.depth;
  switch (wall) {
    case 'top': return { x: x + along, y: y + d / 2 + gap, rotation: 0 };
    case 'bottom': return { x: x + along, y: y + D - d / 2 - gap, rotation: 180 };
    case 'left': return { x: x + d / 2 + gap, y: y + along, rotation: 270 };
    case 'right': default: return { x: x + W - d / 2 - gap, y: y + along, rotation: 90 };
  }
}

function makeCtx(project, fixed, strategy) {
  const room = project.room;
  const ctx = {
    room, strategy,
    openings: project.openings,
    placed: [],
    polys: new Map(),
    freeSides: new Map(),
    zones: project.openings.map(op => ({ op, poly: openingClearZone(room, op) })),
    walls: wallPolygons(project),
    band: null,
    bandPenalty: 0,
  };
  for (const f of fixed) commitItem(ctx, f);
  return ctx;
}

function accessSides(ctx, item) {
  const rule = ACCESS_RULES[groupOf(item)];
  if (!rule) return null;
  const res = [];
  for (const side of rule.sides) {
    const z = sideZone(item, side, rule.distance);
    if (zoneOutside(z, ctx.room) > 3) continue;
    let blocked = ctx.walls.some(w => polygonOverlapDepth(z, w) > 2);
    for (const p of ctx.placed) {
      if (p.id === item.id || accessExempt(item, p)) continue;
      if (polygonOverlapDepth(z, ctx.polys.get(p.id)) > 2) { blocked = true; break; }
    }
    if (!blocked) res.push(z);
  }
  return res;
}

function zoneOutside(poly, room) {
  let w = 0;
  for (const p of poly) w = Math.max(w, room.x - p.x, p.x - room.x - room.width, room.y - p.y, p.y - room.y - room.depth);
  return w;
}

function commitItem(ctx, item) {
  ctx.placed.push(item);
  ctx.polys.set(item.id, corners(item));
  for (const p of ctx.placed) {
    const sides = accessSides(ctx, p);
    if (sides) ctx.freeSides.set(p.id, sides);
  }
}

/** 置いた家具を取り消す（ダイニングの置き方を試し直すとき用） */
function uncommitItems(ctx, items) {
  const ids = new Set(items.map(i => i.id));
  for (let i = ctx.placed.length - 1; i >= 0; i--) if (ids.has(ctx.placed[i].id)) ctx.placed.splice(i, 1);
  for (const id of ids) ctx.polys.delete(id);
  ctx.freeSides.clear();
  for (const p of ctx.placed) {
    const sides = accessSides(ctx, p);
    if (sides) ctx.freeSides.set(p.id, sides);
  }
}

function hardOK(ctx, c) {
  const layer = layerOf(c);
  const room = ctx.room;
  if (layer === 'ceiling') {
    return c.x > room.x && c.x < room.x + room.width && c.y > room.y && c.y < room.y + room.depth;
  }
  if (outsideAmount(c, room) > 0.5) return false;
  const poly = corners(c, 1);
  if (ctx.walls.some(w => polygonOverlapDepth(poly, w) > 0)) return false;
  for (const p of ctx.placed) {
    if (canOverlap(c, p)) continue;
    if (polygonOverlapDepth(poly, ctx.polys.get(p.id)) > 0) return false;
  }
  if (layer === 'floor') return true;
  const g = groupOf(c);
  for (const { op, poly: z } of ctx.zones) {
    if (polygonOverlapDepth(poly, z) <= 0) continue;
    if (op.type === 'door' || op.type === 'closet') return false;
    if (op.sill === 'floor' && g !== 'plant' && g !== 'lamp') return false;
    if (op.sill !== 'floor' && (c.height || 0) >= 90) return false;
  }
  // 自分の「使う側」が確保できるか
  const rule = ACCESS_RULES[g];
  if (rule) {
    const ok = rule.sides.some(side => {
      const z = sideZone(c, side, rule.distance);
      if (zoneOutside(z, room) > 3) return false;
      if (ctx.walls.some(w => polygonOverlapDepth(z, w) > 2)) return false;
      for (const p of ctx.placed) {
        if (accessExempt(c, p)) continue;
        if (polygonOverlapDepth(z, ctx.polys.get(p.id)) > 2) return false;
      }
      for (const { op, poly: dz } of ctx.zones) {
        if (op.type === 'door' && polygonOverlapDepth(z, dz) > 20) return false;
      }
      return true;
    });
    if (!ok) return false;
  }
  // 既に置いた家具の「使う側」をすべてふさがないか
  for (const p of ctx.placed) {
    const sides = ctx.freeSides.get(p.id);
    if (!sides || !sides.length || accessExempt(p, c)) continue;
    if (sides.every(z => polygonOverlapDepth(z, poly) > 2)) return false;
  }
  return true;
}

function bandCost(ctx, c) {
  if (!ctx.band || layerOf(c) !== 'normal') return 0;
  return polygonOverlapDepth(corners(c), ctx.band) > 0 ? ctx.bandPenalty : 0;
}

/**
 * ideal に最も近い、制約を満たす姿勢を探す
 * opts.walls: 壁付け候補を探す壁の配列（null で壁候補なし）
 * opts.grid: グリッド候補を使うか / opts.radius: 探索半径 / opts.rotations: グリッド候補の回転
 */
function findSpot(ctx, item, ideal, opts = {}) {
  const room = ctx.room;
  const cands = [];
  const push = (x, y, rotation, extra) => cands.push({ x, y, rotation: normAngle(rotation), cost: Math.hypot(x - ideal.x, y - ideal.y) + extra });
  push(ideal.x, ideal.y, ideal.rotation, 0);
  const radius = opts.radius ?? Infinity;
  if (opts.walls) {
    for (const wall of opts.walls) {
      const len = wallSegment(room, wall).len;
      for (let a = item.width / 2; a <= len - item.width / 2 + 0.01; a += 10) {
        const p = wallPose(room, wall, a, item, opts.gap ?? 2);
        if (Math.hypot(p.x - ideal.x, p.y - ideal.y) > radius) continue;
        push(p.x, p.y, p.rotation, (opts.wallCost?.(wall) || 0));
      }
    }
  }
  if (opts.grid !== false) {
    const rots = opts.rotations || [ideal.rotation];
    const step = opts.step || 10;
    for (let x = room.x + 10; x < room.x + room.width; x += step) {
      for (let y = room.y + 10; y < room.y + room.depth; y += step) {
        if (Math.hypot(x - ideal.x, y - ideal.y) > radius) continue;
        rots.forEach((r, i) => push(x, y, r, i === 0 ? (opts.gridCost || 0) : (opts.gridCost || 0) + 40));
      }
    }
  }
  if (ctx.band) for (const c of cands) c.cost += bandCost(ctx, { ...item, ...c });
  if (opts.cost) for (const c of cands) c.cost += opts.cost({ ...item, ...c });
  cands.sort((a, b) => a.cost - b.cost);
  for (const c of cands) {
    const test = { ...item, x: Math.round(c.x), y: Math.round(c.y), rotation: c.rotation };
    if (hardOK(ctx, test)) return test;
  }
  return null;
}

function place(ctx, item, ideal, opts, skipped) {
  const res = findSpot(ctx, item, ideal, opts);
  if (res) { commitItem(ctx, res); return res; }
  skipped.push(item);
  return null;
}

// ---------------------------------------------------------------------------
// 部屋の座標系（u: ダイニング側 → リビング側、v: 横方向）
// ---------------------------------------------------------------------------
function makeFrame(room, livingEnd) {
  const { x, y, width: W, depth: D } = room;
  let o, eu, ev, L, S, walls;
  switch (livingEnd) {
    case 'left': o = { x: x + W, y }; eu = { x: -1, y: 0 }; ev = { x: 0, y: 1 }; L = W; S = D; walls = { u0: 'right', uL: 'left', v0: 'top', vS: 'bottom' }; break;
    case 'bottom': o = { x, y }; eu = { x: 0, y: 1 }; ev = { x: 1, y: 0 }; L = D; S = W; walls = { u0: 'top', uL: 'bottom', v0: 'left', vS: 'right' }; break;
    case 'top': o = { x, y: y + D }; eu = { x: 0, y: -1 }; ev = { x: 1, y: 0 }; L = D; S = W; walls = { u0: 'bottom', uL: 'top', v0: 'left', vS: 'right' }; break;
    case 'right': default: o = { x, y }; eu = { x: 1, y: 0 }; ev = { x: 0, y: 1 }; L = W; S = D; walls = { u0: 'left', uL: 'right', v0: 'top', vS: 'bottom' };
  }
  return {
    L, S, walls, livingEnd,
    P: (u, v) => ({ x: o.x + eu.x * u + ev.x * v, y: o.y + eu.y * u + ev.y * v }),
    U: p => (p.x - o.x) * eu.x + (p.y - o.y) * eu.y,
    V: p => (p.x - o.x) * ev.x + (p.y - o.y) * ev.y,
    face: (du, dv) => rotationFacing(eu.x * du + ev.x * dv, eu.y * du + ev.y * dv),
  };
}

function openingSpanOnWall(room, frame, op, wall, u1, u2) {
  if (op.wall !== wall) return 0;
  const { a, b } = openingEnds(room, op);
  const ua = frame.U(a), ub = frame.U(b);
  return Math.max(0, Math.min(u2, Math.max(ua, ub)) - Math.max(u1, Math.min(ua, ub)));
}

function chooseLivingEnd(project, fixed) {
  const room = project.room;
  const ends = room.width >= room.depth ? ['left', 'right'] : ['top', 'bottom'];
  const scored = ends.map(end => {
    const f = makeFrame(room, end);
    const half = [f.L / 2, f.L];
    let score = 0;
    for (const op of project.openings) {
      if (op.type === 'window') {
        score += openingSpanOnWall(room, f, op, f.walls.uL, -1, f.L + 1) * 1.0;
        score += openingSpanOnWall(room, f, op, f.walls.v0, ...half) + openingSpanOnWall(room, f, op, f.walls.vS, ...half);
      }
      if (op.type === 'door') {
        const { a, b } = openingEnds(room, op);
        const u = f.U({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        if (u > f.L / 2) score -= 60;
      }
    }
    for (const it of fixed) {
      if (['kitchen', 'fridge'].includes(groupOf(it)) && f.U(it) > f.L / 2) score -= 1000;
    }
    return { end, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].end;
}

function doorPoints(project) {
  return project.openings.filter(o => o.type === 'door').map(op => {
    const { a, b, nx, ny } = openingEnds(project.room, op);
    return { x: (a.x + b.x) / 2 + nx * 40, y: (a.y + b.y) / 2 + ny * 40 };
  });
}

function bandPolygon(p, q, width) {
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * width / 2, ny = (dx / len) * width / 2;
  return [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
}

// ---------------------------------------------------------------------------
// 配置プラン
// ---------------------------------------------------------------------------
const ALL_WALLS = ['top', 'right', 'bottom', 'left'];

function takeAll(items, pred) {
  const out = [];
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) out.unshift(items.splice(i, 1)[0]);
  return out;
}
function takeOne(items, pred) {
  const i = items.findIndex(pred);
  return i >= 0 ? items.splice(i, 1)[0] : null;
}

const byGroup = g => it => groupOf(it) === g;

function placeChairs(ctx, table, chairs, mode, skipped) {
  const placedChairs = [];
  const tw = table.width, td = table.depth;
  const round = getSpec(table.type).shape === 'table-round';
  for (const chair of chairs) {
    const isBench = chair.type === 'bench';
    const cd = chair.depth;
    const slots = [];
    if (round) {
      const n = Math.max(chairs.length, 2);
      for (let k = 0; k < n; k++) {
        const a = (k * 360) / n;
        const r = tw / 2 + cd / 2 - 8;
        const p = rotatePoint(0, r, a);
        slots.push({ lx: p.x, ly: p.y, rot: a + 180 });
      }
    } else {
      const perSide = isBench ? 1 : Math.max(1, Math.floor(tw / 58));
      // tuck: テーブルの下に入れる深さ。ふつうは 8cm、置けないときは深く入れた位置（22cm）も試す
      const sideSlots = tuck => {
        const front = [], back = [], out = [];
        for (let i = 0; i < perSide; i++) {
          const lx = isBench ? 0 : -tw / 2 + (tw * (i + 0.5)) / perSide;
          front.push({ lx, ly: td / 2 + cd / 2 - tuck, rot: 180 });
          back.push({ lx, ly: -(td / 2 + cd / 2 - tuck), rot: 0 });
        }
        if (mode === 'one') out.push(...front);
        else for (let i = 0; i < perSide; i++) out.push(front[i], back[i]);
        if (!isBench) out.push({ lx: -(tw / 2 + cd / 2 - tuck), ly: 0, rot: 270 }, { lx: tw / 2 + cd / 2 - tuck, ly: 0, rot: 90 });
        return out;
      };
      slots.push(...sideSlots(8), ...sideSlots(22));
    }
    let ok = null;
    for (const s of slots) {
      const p = localToWorld(table, s.lx, s.ly);
      const test = { ...chair, x: Math.round(p.x), y: Math.round(p.y), rotation: normAngle(table.rotation + s.rot) };
      if (hardOK(ctx, test)) { ok = test; break; }
    }
    // 置いた椅子はテーブルにつなげる（反映後、テーブルを動かすと一緒に動く）
    if (ok) { ok.tableId = table.id; table.chairsAttached = true; commitItem(ctx, ok); placedChairs.push(ok); } else skipped.push(chair);
  }
  return placedChairs;
}

/** 壁付けが基本の家具か */
function isWallItem(it) {
  return ['storage', 'tvboard', 'desk', 'kitchen', 'fridge', 'bed', 'bed-set', 'nightstand', 'robot-dock', 'toilet', 'bath', 'washbasin', 'washer', 'wic'].includes(groupOf(it));
}

function placeGeneric(ctx, item, anchor, skipped, extra = {}) {
  const ideal = { x: anchor.x, y: anchor.y, rotation: anchor.rotation ?? item.rotation ?? 0 };
  if (isWallItem(item)) {
    return place(ctx, item, ideal, { walls: ALL_WALLS, grid: true, gridCost: 250, rotations: [0, 90], ...extra }, skipped);
  }
  return place(ctx, item, ideal, { walls: null, grid: true, rotations: [ideal.rotation, ideal.rotation + 90], ...extra }, skipped);
}

function farthestCorner(room, from) {
  const cs = [
    { x: room.x + 30, y: room.y + 30 }, { x: room.x + room.width - 30, y: room.y + 30 },
    { x: room.x + room.width - 30, y: room.y + room.depth - 30 }, { x: room.x + 30, y: room.y + room.depth - 30 },
  ];
  if (!from) return cs[0];
  return cs.sort((a, b) => dist(b, from) - dist(a, from))[0];
}

function planLDK(ctx, project, items, key, facts, skipped) {
  const room = project.room;
  const fixed = ctx.placed.slice();
  const livingEnd = chooseLivingEnd(project, fixed);
  const F = makeFrame(room, livingEnd);
  facts.livingEnd = livingEnd;

  const tvb = takeOne(items, byGroup('tvboard'));
  const tv = takeOne(items, byGroup('tv'));
  // リビングセット（ソファ＋センターテーブルが1つの家具）もソファと同じ場所に置く
  const sofa = takeOne(items, byGroup('sofa')) || takeOne(items, byGroup('living-set'));
  // ソファ部分の奥行き（リビングセットは外形の奥側だけがソファ）
  const sofaPart = it => (groupOf(it) === 'living-set' ? Math.min(getSpec(it.type).sofaDepth || 85, it.depth) : it.depth);
  // ダイニングセット（テーブル＋椅子が1つの家具）もテーブルと同じ場所に置く。椅子は含まれているので足さない
  const table = takeOne(items, byGroup('table')) || takeOne(items, byGroup('dining-set'));
  const chairs = takeAll(items, byGroup('chair'));
  const coffee = takeOne(items, byGroup('coffee'));
  const rugs = takeAll(items, byGroup('rug'));
  const armchairs = takeAll(items, byGroup('armchair'));
  const sides = takeAll(items, byGroup('side'));
  const pendants = takeAll(items, byGroup('pendant'));
  const lamps = takeAll(items, byGroup('lamp'));
  const plants = takeAll(items, byGroup('plant'));
  const desk = takeOne(items, byGroup('desk'));
  const deskchair = takeOne(items, byGroup('deskchair'));
  const storages = takeAll(items, it => ['storage', 'nightstand'].includes(groupOf(it)));

  // ダイニング・リビングのゾーン分け
  let fixedEdge = 0;
  for (const f of fixed) {
    const us = corners(f).map(F.U);
    if (Math.min(...us) < F.L / 2) fixedEdge = Math.max(fixedEdge, Math.max(...us));
  }
  const hasLiving = !!(sofa || tvb);
  const diningStart = fixedEdge > 0 ? fixedEdge + 70 : 0;
  const tableLenU = table ? (key === 'C' ? table.depth : table.width) : 0;
  const diningLen = table ? Math.max(tableLenU + 140, F.L * 0.3) : 0;
  const livingStart = table && hasLiving ? Math.min(diningStart + diningLen, F.L * 0.62) : (table ? F.L : 0);
  const livingMidU = (livingStart + F.L) / 2;
  const diningMidU = table ? (hasLiving ? (diningStart + livingStart) / 2 : (diningStart + F.L) / 2) : 0;
  facts.zones = { diningStart, livingStart };

  // 動線の帯（入口→部屋の中心・リビング）
  const doors = doorPoints(project);
  if (doors.length) {
    const target = hasLiving ? F.P(livingMidU, F.S / 2) : F.P(F.L / 2, F.S / 2);
    ctx.band = bandPolygon(doors[0], target, key === 'A' ? 90 : 70);
    ctx.bandPenalty = key === 'A' ? 400 : 60;
  }

  // テレビ側の壁：リビング部分に窓・ドアが少ない側
  const openLen = wall => project.openings.reduce((s, op) => s + openingSpanOnWall(room, F, op, wall, livingStart, F.L) * (op.type === 'window' && op.sill === 'floor' ? 3 : 1), 0);
  const tvSideV0 = openLen(F.walls.v0) <= openLen(F.walls.vS);
  const tvWall = tvSideV0 ? F.walls.v0 : F.walls.vS;
  const sofaWall = tvSideV0 ? F.walls.vS : F.walls.v0;

  // ---- リビング ----
  let placedTvb = null, placedSofa = null;
  if (tvb) {
    let ideal;
    if (key === 'C') {
      const p = F.P(F.L - tvb.depth / 2 - 2, F.S / 2);
      ideal = { ...p, rotation: F.face(-1, 0) };
    } else {
      const v = tvSideV0 ? tvb.depth / 2 + 2 : F.S - tvb.depth / 2 - 2;
      const p = F.P(livingMidU, v);
      ideal = { ...p, rotation: F.face(0, tvSideV0 ? 1 : -1) };
    }
    const prefer = key === 'C' ? F.walls.uL : tvWall;
    placedTvb = place(ctx, tvb, ideal, { walls: ALL_WALLS, grid: false, wallCost: w => (w === prefer ? 0 : 150) }, skipped);
  }
  if (tv) {
    if (placedTvb) {
      const p = localToWorld(placedTvb, 0, -placedTvb.depth / 2 + tv.depth / 2 + 1);
      const t = { ...tv, x: Math.round(p.x), y: Math.round(p.y), rotation: placedTvb.rotation };
      commitItem(ctx, t);
    } else {
      placeGeneric(ctx, tv, F.P(F.L - 20, F.S / 2), skipped);
    }
  }
  if (sofa) {
    let ideal, opts;
    if (placedTvb) {
      const fv = facingVector(placedTvb.rotation);
      const across = key === 'C' ? (F.L - livingStart) : F.S;
      const sd = sofaPart(sofa);
      const vd = Math.max(150, Math.min(240, across - placedTvb.depth - sd - 70));
      // テレビまでの距離 vd はソファの前面から測る（リビングセットはテーブルを挟んだ先がテレビ）
      const d = placedTvb.depth / 2 + vd + sd - sofa.depth / 2;
      ideal = { x: placedTvb.x + fv.x * d, y: placedTvb.y + fv.y * d, rotation: normAngle(placedTvb.rotation + 180) };
      // テレビの正面からずれるほどコストを上げる
      const lateral = c => Math.abs(fv.x * (c.y - placedTvb.y) - fv.y * (c.x - placedTvb.x)) * 3;
      if (key === 'B') {
        // 開放感重視：ソファは壁にぴったり寄せる
        const far = { x: placedTvb.x + fv.x * 2000, y: placedTvb.y + fv.y * 2000 };
        ideal = { ...ideal, x: Math.max(room.x, Math.min(room.x + room.width, far.x)), y: Math.max(room.y, Math.min(room.y + room.depth, far.y)) };
        opts = { walls: ALL_WALLS, grid: true, gridCost: 300, rotations: [ideal.rotation], gap: 3,
          cost: c => lateral(c) + (Math.abs(normAngle(c.rotation - ideal.rotation)) > 1 ? 400 : 0) };
      } else {
        opts = { walls: key === 'A' ? ALL_WALLS : null, grid: true, rotations: [ideal.rotation], gap: 3,
          cost: c => lateral(c) + (Math.abs(normAngle(c.rotation - ideal.rotation)) > 1 ? 400 : 0) };
      }
    } else {
      const v = F.S - sofa.depth / 2 - 3;
      ideal = { ...F.P(livingMidU, v), rotation: F.face(0, -1) };
      opts = { walls: ALL_WALLS, grid: true, gridCost: key === 'B' ? 300 : 0, wallCost: w => (w === sofaWall ? 0 : 120) };
    }
    placedSofa = place(ctx, sofa, ideal, opts, skipped);
  }
  if (placedSofa && placedTvb) {
    const vdx = Math.round(dist(placedSofa, placedTvb) - placedSofa.depth / 2 - placedTvb.depth / 2 + (placedSofa.depth - sofaPart(placedSofa)));
    facts.viewDistance = vdx;
  }

  // ソファ周り
  if (placedSofa) {
    const S = placedSofa;
    if (coffee) {
      const p = localToWorld(S, 0, S.depth / 2 + 40 + coffee.depth / 2);
      place(ctx, coffee, { ...p, rotation: S.rotation }, { radius: 60, rotations: [S.rotation] }, skipped);
    }
    for (const [i, rug] of rugs.entries()) {
      let ly = S.depth / 2 + rug.depth / 2 - 25;
      if (groupOf(S) === 'living-set') {
        // リビングセットはセンターテーブルの下を中心にラグを敷く
        const td = getSpec(S.type).tableDepth || 50;
        const p = localToWorld(S, 0, S.depth / 2 - td / 2 + i * 20);
        place(ctx, rug, { ...p, rotation: S.rotation }, { radius: 150, rotations: [S.rotation, S.rotation + 90] }, skipped);
        continue;
      }
      if (placedTvb) {
        const front = dist(S, placedTvb) - S.depth / 2 - placedTvb.depth / 2;
        ly = S.depth / 2 + Math.min(front, rug.depth) / 2 - (key === 'C' ? 30 : 15);
      }
      const p = localToWorld(S, 0, ly + i * 20);
      place(ctx, rug, { ...p, rotation: S.rotation }, { radius: 150, rotations: [S.rotation, S.rotation + 90] }, skipped);
    }
    let sideToggle = key === 'C' ? 1 : -1;
    for (const a of armchairs) {
      const p = localToWorld(S, sideToggle * (S.width / 2 + a.width / 2 + 25), S.depth / 2 + 60);
      place(ctx, a, { ...p, rotation: normAngle(S.rotation + (sideToggle > 0 ? 90 : 270)) }, { radius: 120, rotations: [normAngle(S.rotation + (sideToggle > 0 ? 90 : 270)), S.rotation] }, skipped);
      sideToggle *= -1;
    }
    for (const sd of sides) {
      const p = localToWorld(S, S.width / 2 + sd.width / 2 + 4, -S.depth / 2 + sd.depth / 2 + 5);
      place(ctx, sd, { ...p, rotation: S.rotation }, { radius: 120 }, skipped);
    }
    for (const [i, lamp] of lamps.entries()) {
      const sgn = i % 2 ? 1 : -1;
      const p = localToWorld(S, sgn * (S.width / 2 + lamp.width / 2 + 5), -S.depth / 2 + lamp.depth / 2 + 3);
      place(ctx, lamp, { ...p, rotation: 0 }, { radius: 150 }, skipped);
    }
  }

  // ---- ダイニング ----
  if (table) {
    let ideal, opts = { radius: Infinity };
    let chairMode = 'both';
    if (key === 'B') {
      // 壁付けダイニング
      const wallV0 = openLen(F.walls.v0) > openLen(F.walls.vS) ? false : true;
      const v = wallV0 ? table.depth / 2 + 2 : F.S - table.depth / 2 - 2;
      ideal = { ...F.P(diningMidU, v), rotation: F.face(0, wallV0 ? 1 : -1) };
      opts = { walls: ALL_WALLS, grid: true, gridCost: 200 };
      chairMode = 'one';
    } else if (key === 'C') {
      ideal = { ...F.P(diningMidU, F.S / 2), rotation: F.face(1, 0) };
      opts = { grid: true, rotations: [F.face(1, 0), F.face(0, 1)] };
    } else {
      ideal = { ...F.P(diningMidU, F.S / 2), rotation: F.face(0, 1) };
      opts = { grid: true, rotations: [F.face(0, 1), F.face(1, 0)] };
    }
    // テーブル周りにチェアを引くスペース（70cm）を確保できる位置を優先（ダイニングセットは椅子込みなので、椅子を引く 30cm）
    const pull = groupOf(table) === 'dining-set' ? 30 : 60;
    if (groupOf(table) === 'dining-set') chairMode = 'both';
    const chairRoom = c => {
      const z = [sideZone(c, 'front', pull), chairMode === 'both' ? sideZone(c, 'back', pull) : null].filter(Boolean);
      return z.some(p => zoneOutside(p, room) > 1 || ctx.placed.some(o => layerOf(o) === 'normal' && polygonOverlapDepth(p, ctx.polys.get(o.id)) > 1)) ? 500 : 0;
    };
    opts.cost = chairRoom;
    // 椅子が全部置けない場合は、両側に椅子を引けるスペースを強く優先した置き方も試し、いちばん多く座れる置き方にする
    const bothRoom = c => ([sideZone(c, 'front', pull), sideZone(c, 'back', pull)]
      .some(p => zoneOutside(p, room) > 1 || ctx.placed.some(o => layerOf(o) === 'normal' && polygonOverlapDepth(p, ctx.polys.get(o.id)) > 1)) ? 2000 : 0);
    const configs = [
      { opts, mode: chairMode },
      { opts: { ...opts, cost: bothRoom }, mode: 'both' },
      { opts: { grid: true, rotations: [F.face(0, 1), F.face(1, 0)], cost: bothRoom }, mode: 'both' },
    ];
    const tryConfig = cfg => {
      const t = findSpot(ctx, table, ideal, cfg.opts);
      if (!t) return -1;
      commitItem(ctx, t);
      const mode = cfg.mode === 'one' && t.rotation !== ideal.rotation ? 'both' : cfg.mode;
      const pcs = placeChairs(ctx, t, chairs, mode, []);
      uncommitItems(ctx, [t, ...pcs]);
      return pcs.length;
    };
    let best = configs[0], bestN = tryConfig(configs[0]);
    for (const cfg of configs.slice(1)) {
      if (bestN >= chairs.length) break;
      const n = tryConfig(cfg);
      if (n > bestN) { best = cfg; bestN = n; }
    }
    const placedTable = place(ctx, table, ideal, best.opts, skipped);
    if (placedTable) {
      if (best.mode === 'one' && placedTable.rotation !== ideal.rotation) chairMode = 'both';
      else chairMode = best.mode;
      // 壁付けの場合はテーブルの背面が壁側になる
      placeChairs(ctx, placedTable, chairs, chairMode, skipped);
      for (const pd of pendants.splice(0, 1)) {
        const p = { ...pd, x: placedTable.x, y: placedTable.y, rotation: 0 };
        commitItem(ctx, p);
      }
    } else skipped.push(...chairs);
  } else {
    for (const c of chairs) skipped.push(c);
  }
  for (const pd of pendants) {
    const anchor = placedSofa ? localToWorld(placedSofa, 0, placedSofa.depth / 2 + 80) : F.P(F.L / 2, F.S / 2);
    placeGeneric(ctx, pd, anchor, skipped);
  }

  // ---- デスク ----
  if (desk) {
    const anchor = key === 'B' ? farthestCorner(room, doors[0]) : F.P(livingStart, 0);
    const placedDesk = placeGeneric(ctx, desk, anchor, skipped, { grid: false });
    if (placedDesk && deskchair) {
      const p = localToWorld(placedDesk, 0, placedDesk.depth / 2 + deskchair.depth / 2 - 15);
      place(ctx, deskchair, { ...p, rotation: normAngle(placedDesk.rotation + 180) }, { radius: 40 }, skipped);
    } else if (deskchair) skipped.push(deskchair);
  } else if (deskchair) placeGeneric(ctx, deskchair, F.P(F.L / 2, F.S / 2), skipped);

  // ---- 収納 ----
  storages.sort((a, b) => (b.height || 0) - (a.height || 0));
  let cluster = null;
  for (const st of storages) {
    let anchor;
    if (key === 'A') anchor = farthestCorner(room, doors[0]);
    else if (key === 'B') anchor = cluster || F.P(Math.max(diningStart, 30), tvSideV0 ? F.S - 30 : 30);
    else anchor = placedTvb ? localToWorld(placedTvb, placedTvb.width / 2 + st.width / 2 + 30, 0) : F.P(F.L, F.S / 2);
    const tallPenalty = c => {
      if ((c.height || 0) < 100) return 0;
      // 背の高い家具は窓の近くを避ける
      return ctx.zones.some(z => z.op.type === 'window' && polygonOverlapDepth(corners(c, 60), z.poly) > 0) ? 200 : 0;
    };
    const res = placeGeneric(ctx, st, anchor, skipped, { cost: tallPenalty });
    if (res && !cluster) cluster = { x: res.x, y: res.y };
  }

  // ---- 観葉植物 ----
  plants.forEach((pl, i) => {
    let anchor;
    if (key === 'C' && placedTvb) {
      const sgn = i % 2 ? 1 : -1;
      anchor = localToWorld(placedTvb, sgn * (placedTvb.width / 2 + pl.width / 2 + 12), 0);
    } else if (key === 'B') {
      const win = ctx.zones.find(z => z.op.type === 'window');
      anchor = win ? openingEnds(room, win.op).a : farthestCorner(room, doors[0]);
    } else {
      anchor = F.P(F.L - 30, i % 2 ? 30 : F.S - 30);
    }
    placeGeneric(ctx, pl, anchor, skipped);
  });

  // ---- その他 ----
  for (const it of items.splice(0)) {
    placeGeneric(ctx, it, farthestCorner(room, doors[0]), skipped);
  }
}

function planBedroom(ctx, project, items, key, facts, skipped) {
  const room = project.room;
  const doors = doorPoints(project);
  const door = doors[0] || { x: room.x, y: room.y + room.depth };
  const wallMid = w => {
    const s = wallSegment(room, w);
    return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  };
  const winLen = w => project.openings.filter(o => o.type === 'window' && o.wall === w).reduce((s, o) => s + o.width, 0);
  // ドアから遠い壁
  const farWall = [...ALL_WALLS].sort((a, b) => dist(wallMid(b), door) - dist(wallMid(a), door))[0];
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const mainWin = [...ALL_WALLS].sort((a, b) => winLen(b) - winLen(a))[0];

  // ベッドセット（ベッド＋ナイトテーブルが1つの家具）もベッドと同じ場所に置く
  const bed = takeOne(items, byGroup('bed')) || takeOne(items, byGroup('bed-set'));
  const nights = takeAll(items, byGroup('nightstand'));
  const desk = takeOne(items, byGroup('desk'));
  const deskchair = takeOne(items, byGroup('deskchair'));
  const rugs = takeAll(items, byGroup('rug'));
  const plants = takeAll(items, byGroup('plant'));

  const placeDesk = () => {
    if (!desk) return;
    let anchor;
    if (key === 'B') anchor = farthestCorner(room, door);
    else if (winLen(mainWin) > 0) anchor = wallMid(mainWin);
    else anchor = wallMid(opposite[farWall]);
    const pd = placeGeneric(ctx, desk, anchor, skipped, { grid: false });
    if (pd && deskchair) {
      const p = localToWorld(pd, 0, pd.depth / 2 + deskchair.depth / 2 - 15);
      place(ctx, deskchair, { ...p, rotation: normAngle(pd.rotation + 180) }, { radius: 40 }, skipped);
    } else if (deskchair) skipped.push(deskchair);
  };

  if (project.__purpose === 'study') placeDesk();

  let placedBed = null;
  if (bed) {
    let headWall = farWall;
    if (key === 'C') {
      // 窓があれば窓に向かう壁、なければ入口から見て横の壁をフォーカルウォールにする
      const perp = { top: ['left', 'right'], bottom: ['left', 'right'], left: ['top', 'bottom'], right: ['top', 'bottom'] };
      headWall = winLen(mainWin) > 0 ? opposite[mainWin] : [...perp[farWall]].sort((a, b) => dist(wallMid(b), door) - dist(wallMid(a), door))[0];
    }
    const len = wallSegment(room, headWall).len;
    let along = len / 2;
    if (key === 'B') {
      // 角に寄せる（ドアから遠い側の角）
      const s = wallSegment(room, headWall);
      const endA = { x: s.x1, y: s.y1 }, endB = { x: s.x2, y: s.y2 };
      along = dist(endA, door) > dist(endB, door) ? bed.width / 2 + 2 : len - bed.width / 2 - 2;
    }
    const ideal = wallPose(room, headWall, along, bed, 2);
    placedBed = place(ctx, bed, ideal, { walls: ALL_WALLS, grid: false, wallCost: w => (w === headWall ? 0 : 200) }, skipped);
  }
  if (placedBed) {
    facts.bedWall = placedBed;
    nights.forEach((n, i) => {
      const sgn = i % 2 ? 1 : -1;
      const p = localToWorld(placedBed, sgn * (placedBed.width / 2 + n.width / 2 + 3), -placedBed.depth / 2 + n.depth / 2 + 2);
      place(ctx, n, { ...p, rotation: placedBed.rotation }, { radius: 60 }, skipped);
    });
    for (const rug of rugs) {
      const p = localToWorld(placedBed, 0, placedBed.depth * 0.2);
      place(ctx, rug, { ...p, rotation: normAngle(placedBed.rotation + (rug.width > placedBed.width ? 0 : 90)) }, { radius: 200 }, skipped);
    }
  } else {
    for (const n of nights) placeGeneric(ctx, n, farthestCorner(room, door), skipped);
    for (const r of rugs) placeGeneric(ctx, r, { x: room.x + room.width / 2, y: room.y + room.depth / 2 }, skipped);
  }
  if (project.__purpose !== 'study') placeDesk();

  if (doors.length) {
    ctx.band = bandPolygon(doors[0], { x: room.x + room.width / 2, y: room.y + room.depth / 2 }, 80);
    ctx.bandPenalty = key === 'A' ? 400 : 60;
  }
  const rest = items.splice(0).sort((a, b) => (b.width * b.depth) - (a.width * a.depth));
  let cluster = null;
  for (const it of rest) {
    let anchor;
    if (key === 'B') anchor = cluster || farthestCorner(room, door);
    else if (key === 'C' && placedBed) anchor = wallMid(opposite[farWall]);
    else anchor = farthestCorner(room, door);
    const res = placeGeneric(ctx, it, anchor, skipped);
    if (res && !cluster) cluster = res;
  }
  plants.forEach((pl, i) => {
    let anchor;
    if (key === 'C' && placedBed) anchor = localToWorld(placedBed, (i % 2 ? 1 : -1) * (placedBed.width / 2 + 70), -placedBed.depth / 2 + 25);
    else if (winLen(mainWin) > 0) anchor = openingEnds(room, project.openings.find(o => o.type === 'window' && o.wall === mainWin)).a;
    else anchor = farthestCorner(room, door);
    placeGeneric(ctx, pl, anchor, skipped);
  });
}

// ---------------------------------------------------------------------------
// 説明文
// ---------------------------------------------------------------------------
const STRATEGIES = {
  A: { title: 'A案：生活動線重視', short: '生活動線重視' },
  B: { title: 'B案：開放感重視', short: '開放感重視' },
  C: { title: 'C案：インテリア性重視', short: 'インテリア性重視' },
};

function describe(key, project, cond, facts, result, skipped, notes) {
  const room = project.room;
  const area = (room.width * room.depth) / 10000;
  const freeArea = result.freeRatio != null ? (area * result.freeRatio) : null;
  const taste = TASTES[cond.taste]?.label || 'ナチュラル';
  const living = ['ldk', 'living', 'oneroom'].includes(cond.purpose);
  const features = [], merits = [], cautions = [];
  let concept = '', reasons = '';

  if (key === 'A') {
    concept = '入口から部屋の奥まで、まっすぐ歩ける通路を最優先で確保した配置です。';
    features.push('入口から主要な家具まで幅50cm以上の通路を確保');
    if (living) features.push('ダイニングとリビングをゾーン分けし、通り抜けの動線と滞在スペースを分離');
    if (facts.viewDistance) features.push(`テレビとソファを向かい合わせに配置（視聴距離 約${facts.viewDistance}cm）`);
    features.push('収納は入口から遠い壁際に寄せ、通路をふさがない');
    reasons = '毎日の「入る・座る・片付ける」の移動距離が短く、家具を避けて歩く必要がない配置にしています。';
    merits.push('移動がスムーズで、家事や片付けの負担が少ない', '来客時や掃除の際にも通り抜けやすい', '家具の前に使うためのスペースを確保');
    cautions.push('通路を優先しているため、家具がやや分散して見える場合があります');
  } else if (key === 'B') {
    concept = '家具をできるだけ壁際に寄せ、部屋の中央に大きな空きスペースをつくる配置です。';
    features.push('ソファ・収納を壁にぴったり寄せて中央の床を広く確保');
    if (living) features.push('ダイニングテーブルを壁付けにして省スペース化');
    features.push('背の高い収納は窓から離した一角にまとめ、視線の抜けを確保');
    reasons = '床が見える面積が広いほど部屋は広く感じます。家具を壁沿いに並べ、視線をさえぎる背の高い家具をまとめました。';
    merits.push('部屋が広く見え、圧迫感が少ない', '床の掃除がしやすい', '模様替えやヨガ・子どもの遊び場などに使える空間が生まれる');
    if (living) cautions.push('壁付けダイニングは座れる人数が少なくなるため、来客時は補助椅子が必要です');
    cautions.push('家具が壁沿いに並ぶため、ゾーンのメリハリはやや弱くなります');
  } else {
    concept = 'テレビやベッドなど主役の家具を正面に据え、左右対称にまとめた雰囲気重視の配置です。';
    if (living) features.push('テレビボードを奥の壁の中央に置き、ソファで空間をゆるやかに仕切る');
    else features.push('ベッドを壁の中央に据え、ナイトテーブルや植物を左右対称に配置');
    if (facts.viewDistance) features.push(`ソファとテレビの距離 約${facts.viewDistance}cm`);
    features.push('観葉植物や照明で主役の家具を両側から引き立てる');
    if (living) features.push('ダイニングテーブルをリビングに向けて配置し、空間に一体感');
    reasons = `インテリアのテイスト「${taste}」が映えるよう、視線が集まるフォーカルポイントをつくり、家具の向きをそろえました。`;
    merits.push('ホテルライクで整った印象になる', '部屋に入ったときの第一印象が良い', 'ゾーンごとの役割が分かりやすい');
    cautions.push(living ? 'ソファを部屋の中央寄りに置くため、背面の見え方（配線など）に配慮が必要です' : 'ベッドを壁の中央に置くため、両側の通路幅を確認してください');
  }
  if (freeArea != null) features.push(`歩ける床面積（通路幅50cm以上）約${freeArea.toFixed(1)}㎡`);
  if (cond.favoriteColor) reasons += ` 新しく追加する布物（ソファ・ラグなど）は、お好みの色を基調にしています。`;
  const pr = cond.priorities || {};
  const prLabels = { storage: '収納', open: '開放感', flow: '生活動線', design: 'デザイン', relax: 'くつろぎ' };
  const chosen = Object.keys(prLabels).filter(k => pr[k]).map(k => prLabels[k]);
  if (chosen.length) reasons += ` ご希望（${chosen.join('・')}重視）も考慮しています。`;

  for (const n of notes) cautions.push(n);
  if (skipped.length) {
    // 同じ家具は「ダイニングチェア×2」のようにまとめる
    const counts = new Map();
    for (const s of skipped) counts.set(s.name, (counts.get(s.name) || 0) + 1);
    cautions.push(`スペースが足りず配置できなかった家具：${[...counts].map(([n, c]) => (c > 1 ? `${n}×${c}` : n)).join('、')}`);
  }
  const errs = result.issues.filter(i => i.level !== 'info').slice(0, 3);
  for (const e of errs) cautions.push(e.message);
  return { concept, features, reasons, merits, cautions };
}

function recommendScore(key, cond) {
  const pr = cond.priorities || {};
  const map = { A: ['flow', 'storage'], B: ['open'], C: ['design', 'relax'] };
  return map[key].reduce((s, k) => s + (pr[k] ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// エントリーポイント
// ---------------------------------------------------------------------------
export function generateDemoProposals(project, furniture, cond) {
  const area = (project.areas || []).find(a => a.id === cond.areaId) || null;
  // エリアを選んだ場合は、そのエリアを「部屋」として配置を考える
  const plan = area
    ? { ...project, room: { x: area.x, y: area.y, width: area.width, depth: area.depth }, openings: [...(area.openings || []), ...project.openings.filter(o => o.wall === 'free')] }
    : project;
  const set = buildItemSet(furniture, cond, area);
  const proposals = ['A', 'B', 'C'].map(key => {
    const ctx = makeCtx(plan, set.fixed, key);
    const items = set.items.map(deepClone);
    const skipped = [];
    const facts = {};
    const pj = { ...plan, __purpose: cond.purpose };
    const isBedroomPlan = ['bedroom', 'study'].includes(cond.purpose) ||
      (items.some(i => ['bed', 'bed-set'].includes(groupOf(i))) && !items.some(i => ['sofa', 'living-set', 'table', 'dining-set', 'tvboard'].includes(groupOf(i))));
    if (isBedroomPlan) planBedroom(ctx, pj, items, key, facts, skipped);
    else planLDK(ctx, pj, items, key, facts, skipped);

    const placed = ctx.placed.map(f => ({ ...f, x: Math.round(f.x), y: Math.round(f.y), rotation: normAngle(Math.round(f.rotation)) }));
    const result = validateLayout(project, placed);
    const text = describe(key, plan, cond, facts, result, skipped, key === 'A' ? set.notes : []);
    return {
      id: key,
      title: STRATEGIES[key].title,
      ...text,
      furniture: placed,
      source: 'demo',
    };
  });
  let best = null, bestScore = 0;
  for (const p of proposals) {
    const s = recommendScore(p.id, cond);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  if (best) best.recommended = true;
  return { proposals, mode: 'demo' };
}
