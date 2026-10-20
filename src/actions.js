// 画面のどこからでも呼べる操作（ボタン・キーボード・パネル共通）
import { state, commit, select, setMode, furnitureList, getItem, activeLayout, emit, selectedIds } from './state.js';
import { getSpec, layerOf } from './data/furniture-library.js';
import { createItem } from './furniture.js';
import { viewCenter, resetCalibration, fitToView } from './canvas.js';
import { uid, normAngle, deepClone, itemsOverlap, outsideAmount, corners, rectPolygon, polygonOverlapDepth, localToWorld, rotatePoint } from './geometry.js';
import { clampOpening, wallSegment, OPENING_LABELS, DOOR_STYLE_LABELS, openingClearZone } from './floorplan.js';
import { subtractRect } from './geometry.js';
import { toast } from './ui.js';
import { attachedChairs, followTable, poseOf, withAttachedChairs } from './table-chairs.js';

/** ダイニングテーブルのまわりに置く椅子の位置（テーブルのローカル座標と向き）。テーブルの人数分 */
const CHAIR_TUCK = 8; // 椅子をテーブルの下に入れる深さ（cm）
function chairSlots(table, chairDepth) {
  const spec = getSpec(table.type);
  const seats = spec.seats || Math.max(2, Math.floor(table.width / 60) * 2);
  if (spec.shape === 'table-round') {
    const r = table.width / 2 + chairDepth / 2 - CHAIR_TUCK;
    return Array.from({ length: seats }, (_, k) => {
      const a = (k * 360) / seats;
      const p = rotatePoint(0, r, a);
      return { lx: p.x, ly: p.y, rot: a + 180 };
    });
  }
  // 長い辺の両側に半分ずつ（向かい合わせ）
  const perSide = Math.max(1, Math.round(seats / 2));
  const ly = table.depth / 2 + chairDepth / 2 - CHAIR_TUCK;
  const slots = [];
  for (let i = 0; i < perSide; i++) {
    const lx = -table.width / 2 + (table.width * (i + 0.5)) / perSide;
    slots.push({ lx, ly, rot: 180 }, { lx, ly: -ly, rot: 0 });
  }
  return slots;
}

/** 家具が部屋からはみ出さず、壁・他の家具と重ならないか */
function fitsAt(item, others, room, walls) {
  if (outsideAmount(item, room) > 0.5) return false;
  const poly = corners(item);
  if (walls.some(w => polygonOverlapDepth(poly, w) > 0.5)) return false;
  return others.every(o => !itemsOverlap(item, o));
}

/** 家具を追加（at を省略すると表示中の中心付近の空いている場所）。ダイニングテーブルは人数分の椅子も一緒に置く */
export function addFurniture(type, at) {
  const spec = getSpec(type);
  const room = state.project.room;
  const isDining = spec.group === 'table';
  const chairSpec = getSpec('chair');
  let base = at || viewCenter();
  if (!at) {
    // 表示中心が部屋の外なら部屋の中心に
    if (base.x < room.x || base.x > room.x + room.width || base.y < room.y || base.y > room.y + room.depth) {
      base = { x: room.x + room.width / 2, y: room.y + room.depth / 2 };
    }
  }
  const item = createItem(spec, { id: uid(type), x: Math.round(base.x), y: Math.round(base.y) });
  const others = furnitureList().filter(f => layerOf(f) === 'normal');
  const walls = (state.project.walls || []).map(rectPolygon);
  if (!at && layerOf(item) === 'normal') {
    // 他の家具と重ならない近くの位置を探す（ダイニングテーブルは、まわりに椅子を引ける広さごと空いている所を優先）
    const extra = isDining ? (chairSpec.depth - CHAIR_TUCK) * 2 : 0;
    // ダイニングは椅子ごと、ドアの開く範囲・収納扉や窓の前も避ける
    const zones = isDining ? state.project.openings
      .filter(o => o.type !== 'window' || o.sill === 'floor')
      .map(o => openingClearZone(room, o)) : [];
    const search = (grow, avoidZones) => {
      for (let r = 0; r <= 400; r += 20) {
        for (let a = 0; a < 360; a += r === 0 ? 360 : 30) {
          const cand = { ...item, x: Math.round(base.x + r * Math.cos(a * Math.PI / 180)), y: Math.round(base.y + r * Math.sin(a * Math.PI / 180)) };
          for (const rotation of isDining ? [0, 90] : [item.rotation]) {
            const c = { ...cand, rotation };
            const zone = getSpec(type).shape === 'table-round'
              ? { ...c, width: c.width + grow, depth: c.depth + grow }
              : { ...c, depth: c.depth + grow };
            if (!fitsAt(zone, others, room, walls)) continue;
            if (avoidZones && zones.some(z => polygonOverlapDepth(corners(zone), z) > 1)) continue;
            item.x = c.x; item.y = c.y; item.rotation = rotation;
            return true;
          }
        }
      }
      return false;
    };
    if (!(extra && (search(extra, true) || search(extra, false)))) search(0, false);
  }
  // 椅子：テーブルの人数分、置ける所にだけ置く（壁ぎわに置いた場合は、90°回すと多く座れるならそちらにする）
  const fitChairs = table => {
    const list = [];
    let miss = 0;
    for (const s of chairSlots(table, chairSpec.depth)) {
      const p = localToWorld(table, s.lx, s.ly);
      const chair = createItem(chairSpec, { id: uid('chair'), x: Math.round(p.x), y: Math.round(p.y), rotation: normAngle(table.rotation + s.rot) });
      if (fitsAt(chair, [...others, ...list], room, walls)) list.push(chair); else miss++;
    }
    return { list, miss };
  };
  let chairs = [], missing = 0;
  if (isDining) {
    let res = fitChairs(item);
    if (res.miss && spec.shape !== 'table-round') {
      const turned = { ...item, rotation: normAngle(item.rotation + 90) };
      const res2 = fitChairs(turned);
      if (res2.list.length > res.list.length && fitsAt(turned, others, room, walls)) { item.rotation = turned.rotation; res = res2; }
    }
    chairs = res.list;
    missing = res.miss;
    // 椅子はテーブルにつなげる（テーブルを動かすと一緒に動く。右パネルでオフにできる）
    item.chairsAttached = true;
    for (const c of chairs) c.tableId = item.id;
  }
  if (state.preview) cancelPreview();
  commit(() => activeLayout().furniture.push(item, ...chairs));
  select({ kind: 'furniture', id: item.id });
  if (isDining) {
    toast(`${spec.name}とダイニングチェア${chairs.length}脚を置きました${missing ? `（${missing}脚はスペースが足りず置けませんでした）` : ''}。椅子は1脚ずつ動かしたり消したりできます`, missing ? '' : 'ok');
  }
  return item;
}

/** 選択中の家具（複数選択に対応） */
const selectedItems = () => selectedIds().map(getItem).filter(Boolean);

export function duplicateSelected() {
  const items = selectedItems();
  if (!items.length) return;
  // テーブルにつながった椅子も一緒に複製する（新しいテーブルにつなぎ直す）
  const all = withAttachedChairs(items);
  const newId = new Map(all.map(f => [f.id, uid(f.type)]));
  const copies = all.map(f => ({
    ...deepClone(f), id: newId.get(f.id), x: f.x + 20, y: f.y + 20, locked: false,
    ...(f.tableId && newId.has(f.tableId) ? { tableId: newId.get(f.tableId) } : {}),
  }));
  commit(() => activeLayout().furniture.push(...copies));
  const ids = items.map(f => newId.get(f.id));
  select({ kind: 'furniture', id: ids[0], ids: ids.length > 1 ? ids : undefined });
  toast(items.length > 1 ? `${items.length}個の家具を複製しました` : `「${items[0].name}」を複製しました`);
}

export function deleteSelected() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.kind === 'furniture') {
    // テーブルにつながった椅子も一緒に削除する
    const ids = new Set(withAttachedChairs(selectedItems()).map(f => f.id));
    commit(() => {
      const l = activeLayout();
      l.furniture = l.furniture.filter(f => !ids.has(f.id));
    });
  } else if (sel.kind === 'opening') {
    commit(p => { p.openings = p.openings.filter(o => o.id !== sel.id); });
  } else if (sel.kind === 'wall') {
    commit(p => { p.walls = p.walls.filter(w => w.id !== sel.id); });
  }
  select(null);
}

/** 選択中の家具を左右反転する（形の左右を入れ替える。位置・向きはそのまま）。固定した家具は変えない */
export function flipSelected() {
  const items = selectedItems().filter(f => !f.locked);
  if (!items.length) return;
  commit(() => { for (const f of items) f.mirror = !f.mirror; });
}

/** 回転。1つならその場で、複数なら並びを保ったまま全体の中心のまわりに回す。固定した家具は動かさない */
export function rotateSelected(delta) {
  const items = selectedItems().filter(f => !f.locked);
  if (!items.length) return;
  if (items.length === 1) {
    const f = items[0];
    commit(() => { const before = poseOf(f); f.rotation = normAngle((f.rotation || 0) + delta); followTable(f, before); });
    return;
  }
  const all = withAttachedChairs(items).filter(f => !f.locked);
  const cx = all.reduce((s, f) => s + f.x, 0) / all.length, cy = all.reduce((s, f) => s + f.y, 0) / all.length;
  const r = (delta * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  commit(() => {
    for (const f of all) {
      const dx = f.x - cx, dy = f.y - cy;
      f.x = Math.round((cx + dx * cos - dy * sin) * 2) / 2;
      f.y = Math.round((cy + dx * sin + dy * cos) * 2) / 2;
      f.rotation = normAngle((f.rotation || 0) + delta);
    }
  });
}

export function nudgeSelected(dx, dy) {
  // テーブルにつながった椅子も一緒に動かす（選択に入っていても二重には動かさない）
  const all = withAttachedChairs(selectedItems().filter(f => !f.locked)).filter(f => !f.locked);
  if (!all.length) return;
  commit(() => { for (const f of all) { f.x += dx; f.y += dy; } });
}

/** 選択中の家具をまとめて固定・固定解除する */
export function setLockedSelected(locked) {
  const items = selectedItems();
  if (!items.length) return;
  commit(() => { for (const f of items) f.locked = locked; });
}

export function reorderSelected(toFront) {
  const f = state.selection?.kind === 'furniture' && getItem(state.selection.id);
  if (!f) return;
  commit(() => {
    const l = activeLayout();
    l.furniture = l.furniture.filter(x => x.id !== f.id);
    if (toFront) l.furniture.push(f); else l.furniture.unshift(f);
  });
}

export function addOpening(type) {
  const room = state.project.room;
  const width = type === 'door' ? 80 : type === 'window' ? 160 : 120;
  const used = state.project.openings.map(o => o.wall);
  const wall = ['top', 'right', 'bottom', 'left'].find(w => !used.includes(w)) || 'top';
  const len = wallSegment(room, wall).len;
  const op = clampOpening(room, {
    id: uid('op'), type, wall, offset: Math.max(0, (len - width) / 2), width,
    hinge: 'start', sill: type === 'window' ? 'high' : undefined, label: OPENING_LABELS[type],
  });
  commit(p => p.openings.push(op));
  select({ kind: 'opening', id: op.id });
  toast(`${OPENING_LABELS[type]}を追加しました。ドラッグまたは右パネルで位置を調整できます`);
}

export function addWall() {
  const r = state.project.room;
  const c = viewCenter();
  const inRoom = c.x > r.x && c.x < r.x + r.width && c.y > r.y && c.y < r.y + r.depth;
  const w = { id: uid('wall'), x: Math.round((inRoom ? c.x : r.x + r.width / 2) - 50), y: Math.round((inRoom ? c.y : r.y + r.depth / 2) - 6), w: 100, h: 12 };
  commit(p => { p.walls = [...(p.walls || []), w]; });
  select({ kind: 'wall', id: w.id });
  toast('壁を追加しました。ドラッグで移動、右パネルで長さ・向きを変えられます');
}

/**
 * 2点 a → b の間に壁を引く（縦か横。厚みは設定の wallThickness、端は厚みの半分だけ伸ばして角をふさぐ）
 */
export function addWallSegment(a, b) {
  const t = state.settings.wallThickness || 12;
  const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const w = horiz
    ? { x: Math.min(a.x, b.x) - t / 2, y: a.y - t / 2, w: Math.abs(b.x - a.x) + t, h: t }
    : { x: a.x - t / 2, y: Math.min(a.y, b.y) - t / 2, w: t, h: Math.abs(b.y - a.y) + t };
  const wall = { id: uid('wall'), x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h) };
  commit(p => { p.walls = [...(p.walls || []), wall]; });
  return wall;
}

/**
 * 壁の長さを変える。左端（縦の壁は上端）はそのままで、右端（下端）を動かす。
 * withConnected なら、動かす端につながっている壁（と、その壁に付いたドア・窓）も同じだけ動かす
 */
export function resizeWall(p, wall, length, withConnected = true) {
  const horiz = wall.w >= wall.h;
  const t = horiz ? wall.h : wall.w;
  length = Math.max(t + 1, Math.round(length));
  const delta = length - (horiz ? wall.w : wall.h);
  if (!delta) return;
  if (withConnected) {
    // 動かす端（右端・下端）のまわり：壁の厚み＋少しの範囲に触れている壁
    const end = horiz ? { x: wall.x + wall.w, y: wall.y + wall.h / 2 } : { x: wall.x + wall.w / 2, y: wall.y + wall.h };
    const tol = t / 2 + 3;
    const touching = (p.walls || []).filter(o => o !== wall
      && end.x >= o.x - tol && end.x <= o.x + o.w + tol && end.y >= o.y - tol && end.y <= o.y + o.h + tol);
    for (const o of touching) {
      // その壁に付いているドア・窓も一緒に
      for (const op of p.openings) {
        if (op.wall !== 'free') continue;
        if (op.x >= o.x - 2 && op.x <= o.x + o.w + 2 && op.y >= o.y - 2 && op.y <= o.y + o.h + 2) {
          if (horiz) op.x += delta; else op.y += delta;
        }
      }
      if (horiz) o.x += delta; else o.y += delta;
    }
  }
  if (horiz) wall.w = length; else wall.h = length;
}

/** 壁の厚みを変える（中心線はそのまま） */
export function setWallThickness(wall, thickness) {
  thickness = Math.max(2, Math.round(thickness));
  if (wall.w >= wall.h) { const cy = wall.y + wall.h / 2; wall.y = Math.round((cy - thickness / 2) * 10) / 10; wall.h = thickness; }
  else { const cx = wall.x + wall.w / 2; wall.x = Math.round((cx - thickness / 2) * 10) / 10; wall.w = thickness; }
}

/** 長方形の範囲の壁を消す（通路をつくる） */
export function eraseWalls(rect) {
  const before = (state.project.walls || []).length;
  let changed = false;
  commit(p => {
    const next = [];
    for (const w of p.walls || []) {
      const pieces = subtractRect(w, rect);
      if (pieces.length !== 1 || pieces[0] !== w) changed = true;
      for (const r of pieces) if (r.w >= 2 && r.h >= 2) next.push({ ...r, id: pieces.length === 1 && pieces[0] === w ? w.id : uid('wall') });
    }
    p.walls = next;
  });
  if (!changed) toast('この範囲に壁はありませんでした。黒い壁の上をドラッグしてください');
  return before;
}

/**
 * クリックした位置にドア・窓を置く。style はドアの開き方（'sliding' 引き戸 / 'folding' 折れ戸、省略すると開き戸）。
 * 部屋の外周の近くなら外周に、内壁の近くならその内壁の向きに合わせて置く。
 */
export function placeOpening(type, pt, style) {
  const p = state.project;
  const r = p.room;
  const width = type === 'door' ? (style === 'folding' ? 70 : 80) : type === 'window' ? 120 : 120;
  const name = type === 'door' && style ? DOOR_STYLE_LABELS[style] : OPENING_LABELS[type];
  const base = { id: uid('op'), type, width, hinge: 'start', label: name, ...(type === 'window' ? { sill: 'high' } : {}), ...(type === 'door' && style ? { style } : {}) };
  const near = 25;
  const sides = [
    { wall: 'top', d: Math.abs(pt.y - r.y), along: pt.x - r.x },
    { wall: 'bottom', d: Math.abs(pt.y - (r.y + r.depth)), along: pt.x - r.x },
    { wall: 'left', d: Math.abs(pt.x - r.x), along: pt.y - r.y },
    { wall: 'right', d: Math.abs(pt.x - (r.x + r.width)), along: pt.y - r.y },
  ].sort((a, b) => a.d - b.d);
  let op;
  if (sides[0].d <= near) {
    op = clampOpening(r, { ...base, wall: sides[0].wall, offset: Math.round(sides[0].along - width / 2) });
  } else {
    op = { ...base, wall: 'free', orient: 'h', side: 1, x: Math.round(pt.x), y: Math.round(pt.y) };
    snapToWall(p, op, pt);
  }
  commit(pr => pr.openings.push(op));
  select({ kind: 'opening', id: op.id });
  setMode('select');
  toast(`${name}を置きました。ドラッグで位置を調整、右パネルで幅・開く向きを変えられます`);
}

/** 内壁の近くなら、その壁の中心線と向きに合わせる */
export function snapToWall(p, op, pt) {
  let best = null, bestD = 30;
  for (const w of p.walls || []) {
    const dx = Math.max(w.x - pt.x, 0, pt.x - (w.x + w.w)), dy = Math.max(w.y - pt.y, 0, pt.y - (w.y + w.h));
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = w; }
  }
  if (!best) return false;
  if (best.w >= best.h) { op.orient = 'h'; op.y = Math.round(best.y + best.h / 2); op.x = Math.round(pt.x); }
  else { op.orient = 'v'; op.x = Math.round(best.x + best.w / 2); op.y = Math.round(pt.y); }
  return true;
}

export function clearWalls() {
  commit(p => { p.walls = []; p.areas = []; });
  select(null);
  toast('壁と部屋の区切りをすべて削除しました（元に戻すで復元できます）');
}

export function startMode(mode) {
  if (state.preview) cancelPreview();
  if (mode === 'calibrate') {
    if (!state.project.background) { toast('先に「間取りを読み込む」で画像を読み込んでください', 'error'); return; }
    resetCalibration();
  }
  select(null);
  setMode(state.mode === mode ? 'select' : mode);
  if ((mode === 'bg' || mode === 'calibrate') && state.mode === mode) fitToView();
}

export function endMode() {
  resetCalibration();
  setMode('select');
}

// ---------- レイアウト（配置パターン）の管理 ----------
export function switchLayout(id) {
  if (state.preview) cancelPreview();
  commit(p => { p.activeLayoutId = id; });
  select(null);
}

export function duplicateLayout() {
  const cur = activeLayout();
  const copy = { id: uid('layout'), name: `${cur.name}のコピー`, furniture: deepClone(cur.furniture).map(f => ({ ...f, id: uid(f.type) })) };
  commit(p => { p.layouts.push(copy); p.activeLayoutId = copy.id; });
  select(null);
  toast(`レイアウト「${copy.name}」を作成しました`);
}

export function newEmptyLayout() {
  const cur = activeLayout();
  const l = { id: uid('layout'), name: `レイアウト${state.project.layouts.length + 1}`, furniture: deepClone(cur.furniture.filter(f => f.locked)) };
  commit(p => { p.layouts.push(l); p.activeLayoutId = l.id; });
  select(null);
}

export function deleteLayout() {
  const p = state.project;
  if (p.layouts.length <= 1) { toast('最後のレイアウトは削除できません', 'error'); return; }
  const cur = activeLayout();
  commit(pr => {
    pr.layouts = pr.layouts.filter(l => l.id !== cur.id);
    pr.activeLayoutId = pr.layouts[0].id;
  });
  select(null);
  toast(`レイアウト「${cur.name}」を削除しました（元に戻すで復元できます）`);
}

// ---------- AI 提案のプレビューと適用 ----------
export function previewProposal(proposal) {
  state.preview = { proposal };
  state.selection = null;
  emit('preview');
}

export function cancelPreview() {
  state.preview = null;
  emit('preview');
}

/** 提案を新しいレイアウトとして適用（元のレイアウトはそのまま残す） */
export function applyProposal(proposal) {
  const before = activeLayout().name;
  const l = {
    id: uid('layout'),
    name: proposal.title.replace(/：/, ' '),
    furniture: deepClone(proposal.furniture).map(f => ({ ...f })),
  };
  state.preview = null;
  commit(p => { p.layouts.push(l); p.activeLayoutId = l.id; });
  select(null);
  toast(`「${l.name}」を新しいレイアウトとして適用しました。元の配置は「${before}」に残っています`, 'ok', 5000);
}

export function setRoomRect(r) {
  // 家具の位置はそのまま（はみ出した家具はチェックで警告される）
  commit(p => {
    delete p.room.followImage;
    p.room.x = Math.round(r.x); p.room.y = Math.round(r.y);
    p.room.width = Math.round(r.w); p.room.depth = Math.round(r.h);
    for (const op of p.openings) clampOpening(p.room, op);
  });
}
