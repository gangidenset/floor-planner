// ダイニングテーブルと椅子のつながり
// 椅子は tableId でテーブルにつながり、テーブルの chairsAttached が true のあいだは、
// テーブルを動かす・回す・複製する・削除すると、つながった椅子も一緒に動く（固定した椅子は動かさない）。
import { furnitureList } from './state.js';
import { getSpec } from './data/furniture-library.js';
import { worldToLocal, localToWorld, normAngle, aabb } from './geometry.js';

export const isDiningTable = f => !!f && getSpec(f.type).group === 'table';
const isChair = f => getSpec(f.type).group === 'chair';

/** テーブルにつながっている椅子（つながりがオフなら空） */
export function attachedChairs(table, list = furnitureList()) {
  if (!isDiningTable(table) || !table.chairsAttached) return [];
  return list.filter(f => f.tableId === table.id && isChair(f));
}

/**
 * テーブルが before（{ x, y, rotation }）から今の位置・向きに動いたので、つながった椅子を同じだけ動かす。
 * 椅子のテーブルに対する位置関係はそのまま
 */
export function followTable(table, before, list = furnitureList()) {
  const dRot = (table.rotation || 0) - (before.rotation || 0);
  if (table.x === before.x && table.y === before.y && !dRot) return;
  for (const c of attachedChairs(table, list)) {
    if (c.locked) continue;
    const local = worldToLocal(before, c.x, c.y);
    const p = localToWorld(table, local.x, local.y);
    c.x = Math.round(p.x * 2) / 2;
    c.y = Math.round(p.y * 2) / 2;
    c.rotation = normAngle((c.rotation || 0) + dRot);
  }
}

/** 家具の一覧に、その中のテーブルにつながった椅子を加える（重複なし。まとめて動かすとき用） */
export function withAttachedChairs(items, list = furnitureList()) {
  const out = new Map(items.map(f => [f.id, f]));
  for (const f of items) for (const c of attachedChairs(f, list)) out.set(c.id, c);
  return [...out.values()];
}

/** テーブルの位置・向き（followTable に渡す before 用） */
export const poseOf = f => ({ x: f.x, y: f.y, rotation: f.rotation || 0 });

/**
 * つながりをオンにしたとき：テーブルのまわり（60cm 以内）にある、まだどのテーブルにもつながっていない椅子をつなげる。
 * 戻り値はつながっている椅子の数
 */
export function attachNearbyChairs(table, list = furnitureList()) {
  const box = aabb(table, 60);
  for (const c of list) {
    if (!isChair(c) || (c.tableId && c.tableId !== table.id && list.some(t => t.id === c.tableId))) continue;
    if (c.x >= box.minX && c.x <= box.maxX && c.y >= box.minY && c.y <= box.maxY) c.tableId = table.id;
  }
  return list.filter(f => f.tableId === table.id && isChair(f)).length;
}
