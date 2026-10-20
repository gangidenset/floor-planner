// 家具配置の検証（手動配置・AI提案どちらにも使う）
import { corners, outsideAmount, polygonOverlapDepth, localToWorld, pointInPolygon, aabb, rectPolygon, subtractRect } from './geometry.js';
import { canOverlap, accessExempt, layerOf, groupOf, ACCESS_RULES } from './data/furniture-library.js';
import { openingClearZone, openingEnds, openingGapRect, OPENING_LABELS, doorStyle } from './floorplan.js';
import { carryProblems, carryMessage } from './carry-check.js';

const PERSON_HALF_WIDTH = 25; // 通路幅 50cm を確保できるか
const CELL = 5;

/** 内壁の多角形（project.walls は軸に沿った長方形 {x, y, w, h}） */
export function wallPolygons(project) {
  const cuts = (project.openings || []).filter(o => o.wall === 'free').map(o => openingGapRect(o));
  let rects = (project.walls || []).map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
  for (const c of cuts) rects = rects.flatMap(r => subtractRect(r, c));
  return rects.filter(r => r.w > 0.5 && r.h > 0.5).map(r => rectPolygon(r));
}

/** 家具のある側に伸びるゾーン */
export function sideZone(item, side, distance) {
  const hw = item.width / 2, hd = item.depth / 2;
  const P = (x, y) => localToWorld(item, x, y);
  switch (side) {
    case 'front': return [P(-hw, hd), P(hw, hd), P(hw, hd + distance), P(-hw, hd + distance)];
    case 'back': return [P(-hw, -hd - distance), P(hw, -hd - distance), P(hw, -hd), P(-hw, -hd)];
    case 'left': return [P(-hw - distance, -hd), P(-hw, -hd), P(-hw, hd), P(-hw - distance, hd)];
    case 'right': default: return [P(hw, -hd), P(hw + distance, -hd), P(hw + distance, hd), P(hw, hd)];
  }
}

function polyOutside(poly, room) {
  let worst = 0;
  for (const p of poly) worst = Math.max(worst, room.x - p.x, p.x - (room.x + room.width), room.y - p.y, p.y - (room.y + room.depth));
  return worst;
}

const isNormal = it => layerOf(it) === 'normal';
const label = it => `「${it.name}」`;
// 図面から自動で置いた水まわり・WIC の設備（「前のスペース」と「入口からの通路」のチェックをしない）
const isAutoExempt = it => it.autoFixture && ['toilet', 'washbasin', 'washer', 'hanger-rack'].includes(it.type);

export function validateLayout(project, furniture) {
  const room = project.room;
  const issues = [];
  const add = (level, code, message, itemIds = []) => issues.push({ level, code, message, itemIds });
  const polys = new Map(furniture.map(f => [f.id, corners(f)]));

  // 1. 部屋からのはみ出し
  for (const f of furniture) {
    if (layerOf(f) === 'ceiling') continue;
    const o = outsideAmount(f, room);
    if (o > 1) add('error', 'outside', `${label(f)}が部屋の外に約${Math.round(o)}cmはみ出しています`, [f.id]);
  }

  // 1b. 壁との重なり
  const wallPolys = wallPolygons(project);
  for (const f of furniture) {
    if (layerOf(f) === 'ceiling') continue;
    if (wallPolys.some(w => polygonOverlapDepth(polys.get(f.id), w) > 1)) add('error', 'wall', `${label(f)}が壁と重なっています`, [f.id]);
  }

  // 2. 重なり（ラグ・天井照明・テーブルとチェアなど許容される組み合わせは除外）
  for (let i = 0; i < furniture.length; i++) {
    for (let j = i + 1; j < furniture.length; j++) {
      const a = furniture[i], b = furniture[j];
      if (canOverlap(a, b)) continue;
      const depth = polygonOverlapDepth(polys.get(a.id), polys.get(b.id));
      if (depth > 1) add('error', 'overlap', `${label(a)}と${label(b)}が重なっています`, [a.id, b.id]);
    }
  }

  // 3. ドア・窓・収納の前
  for (const op of project.openings) {
    const zone = openingClearZone(room, op);
    const name = op.label || OPENING_LABELS[op.type];
    for (const f of furniture) {
      if (!isNormal(f)) continue;
      const depth = polygonOverlapDepth(polys.get(f.id), zone);
      if (depth <= 1) continue;
      if (op.type === 'door' && doorStyle(op) === 'sliding') {
        add('error', 'door', `${label(f)}が${name}（引き戸）の前の出入り口をふさいでいます`, [f.id]);
      } else if (op.type === 'door') {
        add('error', 'door', `${label(f)}が${name}の開閉範囲に入っています`, [f.id]);
      } else if (op.type === 'closet') {
        add('warn', 'closet', `${label(f)}が${name}の前（約70cm）をふさいでいます`, [f.id]);
      } else if (op.sill === 'floor') {
        if (groupOf(f) === 'plant' || groupOf(f) === 'lamp') continue;
        add('warn', 'window', `${label(f)}が${name}（床まである窓）の前をふさいでいます`, [f.id]);
      } else if ((f.height || 0) >= 90) {
        add('warn', 'window', `背の高い${label(f)}が${name}をふさいでいる可能性があります`, [f.id]);
      }
    }
  }

  // 4. 使う側のスペース（ソファの前、ベッドの横、収納の前など）
  for (const f of furniture) {
    // ユニットバスは浴室そのもの（洗い場を含む）なので、前のスペースは求めない。
    // 図面から自動で置いたトイレ・洗面台・洗濯機置き場・ハンガーラックも、部屋の広さは図面どおりで変えられないので求めない
    const rule = f.type === 'unit-bath' || isAutoExempt(f) ? null : ACCESS_RULES[groupOf(f)];
    if (!rule) continue;
    const okSide = rule.sides.some(side => {
      const zone = sideZone(f, side, rule.distance);
      if (polyOutside(zone, room) > 3) return false;
      if (wallPolys.some(w => polygonOverlapDepth(zone, w) > 2)) return false;
      return furniture.every(o => o.id === f.id || accessExempt(f, o) || polygonOverlapDepth(zone, polys.get(o.id)) <= 2);
    });
    if (!okSide) {
      const where = rule.sides.length > 1 ? '横または前' : '前';
      add('warn', 'access', `${label(f)}の${where}に${rule.distance}cm程度の使うスペースがありません`, [f.id]);
    }
  }

  // 5. 動線（入口から幅50cm以上の通路でたどり着けるか）
  const flow = computeWalkability(project, furniture);
  if (!project.openings.some(o => o.type === 'door')) {
    add('info', 'flow', 'ドアが未設定のため、動線のチェックを省略しました（右パネルの「ドア・窓」から追加できます）');
  } else if (flow) {
    if (!flow.startOk) {
      add('error', 'flow', '入口ドアの付近がふさがれていて部屋に入れません');
    } else {
      for (const f of furniture) {
        const g = groupOf(f);
        if (!isNormal(f) || ['chair', 'plant', 'lamp', 'tv', 'side', 'coffee', 'nightstand', 'robot'].includes(g) || isAutoExempt(f)) continue;
        if (!flow.reaches(f)) add('warn', 'flow', `入口から${label(f)}まで幅50cm以上の通路がありません`, [f.id]);
      }
      for (const op of project.openings) {
        if (op.type === 'door' || (op.type === 'window' && op.sill !== 'floor')) continue;
        if (!flow.reachesZone(openingClearZone(room, op))) {
          add('warn', 'flow', `入口から${op.label || OPENING_LABELS[op.type]}まで通れる通路がありません`);
        }
      }
    }
  }

  // 6. 搬入：玄関と置く部屋のドアを通るか
  // 図面から推定したドア幅での判定は「情報」（家具の枠の色は付けない）、確かめたドア幅なら「注意」
  for (const r of carryProblems(project, furniture)) add(r.estimated ? 'info' : 'warn', 'carry', carryMessage(r), [r.item.id]);

  const byItem = new Map();
  const rank = { error: 3, warn: 2, info: 1 };
  for (const is of issues) {
    for (const id of is.itemIds) {
      if (!byItem.has(id) || rank[is.level] > rank[byItem.get(id)]) byItem.set(id, is.level);
    }
  }
  return {
    issues,
    byItem,
    counts: { error: issues.filter(i => i.level === 'error').length, warn: issues.filter(i => i.level === 'warn').length },
    freeRatio: flow ? flow.freeRatio : null,
    flow,
  };
}

/** 通路幅を考慮した歩行可能領域（距離変換 + 塗りつぶし） */
export function computeWalkability(project, furniture) {
  const room = project.room;
  const nx = Math.max(1, Math.ceil(room.width / CELL)), ny = Math.max(1, Math.ceil(room.depth / CELL));
  if (nx * ny > 400000) return null;
  const INF = 1e9;
  const dist = new Float32Array(nx * ny).fill(INF);
  const cx = i => room.x + (i + 0.5) * CELL, cy = j => room.y + (j + 0.5) * CELL;

  // 障害物（床置きラグ・天井照明以外の家具と、壁）
  const obstacles = [
    ...furniture.filter(isNormal).map(f => ({ poly: corners(f), b: aabb(f) })),
    ...wallPolygons(project).map(poly => ({ poly, b: { minX: poly[0].x, minY: poly[0].y, maxX: poly[2].x, maxY: poly[2].y } })),
  ];
  for (const { poly, b } of obstacles) {
    const i0 = Math.max(0, Math.floor((b.minX - room.x) / CELL)), i1 = Math.min(nx - 1, Math.floor((b.maxX - room.x) / CELL));
    const j0 = Math.max(0, Math.floor((b.minY - room.y) / CELL)), j1 = Math.min(ny - 1, Math.floor((b.maxY - room.y) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (pointInPolygon({ x: cx(i), y: cy(j) }, poly)) dist[j * nx + i] = 0;
    }
  }
  // 壁からの距離を初期値に
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const w = Math.min(cx(i) - room.x, room.x + room.width - cx(i), cy(j) - room.y, room.y + room.depth - cy(j));
    dist[k] = Math.min(dist[k], w);
  }
  // 2パスの距離変換（chamfer）
  const A = CELL, B = CELL * Math.SQRT2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let d = dist[k];
    if (i > 0) d = Math.min(d, dist[k - 1] + A);
    if (j > 0) {
      d = Math.min(d, dist[k - nx] + A);
      if (i > 0) d = Math.min(d, dist[k - nx - 1] + B);
      if (i < nx - 1) d = Math.min(d, dist[k - nx + 1] + B);
    }
    dist[k] = d;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    let d = dist[k];
    if (i < nx - 1) d = Math.min(d, dist[k + 1] + A);
    if (j < ny - 1) {
      d = Math.min(d, dist[k + nx] + A);
      if (i < nx - 1) d = Math.min(d, dist[k + nx + 1] + B);
      if (i > 0) d = Math.min(d, dist[k + nx - 1] + B);
    }
    dist[k] = d;
  }

  const walkable = k => dist[k] >= PERSON_HALF_WIDTH;
  const reach = new Uint8Array(nx * ny);
  const queue = [];
  let startOk = false;
  for (const op of project.openings) {
    if (op.type !== 'door') continue;
    const { a, b, nx: wx, ny: wy } = openingEnds(room, op);
    // ドアを入って少し進んだあたりから探索を始める
    for (let t = 0.2; t <= 0.8; t += 0.1) {
      for (const depth of [30, 40, 55]) {
        const px = a.x + (b.x - a.x) * t + wx * depth, py = a.y + (b.y - a.y) * t + wy * depth;
        const i = Math.floor((px - room.x) / CELL), j = Math.floor((py - room.y) / CELL);
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (walkable(k) && !reach[k]) { reach[k] = 1; queue.push(k); startOk = true; }
      }
    }
  }
  while (queue.length) {
    const k = queue.pop();
    const i = k % nx, j = (k - i) / nx;
    const nb = [];
    if (i > 0) nb.push(k - 1);
    if (i < nx - 1) nb.push(k + 1);
    if (j > 0) nb.push(k - nx);
    if (j < ny - 1) nb.push(k + nx);
    for (const n of nb) if (!reach[n] && walkable(n)) { reach[n] = 1; queue.push(n); }
  }

  let reachable = 0;
  for (let k = 0; k < reach.length; k++) reachable += reach[k];

  // 人の中心が届くセル + 体の半径 で、そのゾーンに手が届くか
  const reachesZone = zone => {
    const pts = zone;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const pad = PERSON_HALF_WIDTH + CELL;
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - pad - room.x) / CELL)), i1 = Math.min(nx - 1, Math.floor((Math.max(...xs) + pad - room.x) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - pad - room.y) / CELL)), j1 = Math.min(ny - 1, Math.floor((Math.max(...ys) + pad - room.y) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!reach[j * nx + i]) continue;
      const p = { x: cx(i), y: cy(j) };
      if (pointInPolygon(p, pts) || nearPolygon(p, pts, PERSON_HALF_WIDTH + 10)) return true;
    }
    return false;
  };

  const reaches = f => {
    const rule = ACCESS_RULES[groupOf(f)];
    if (rule) return rule.sides.some(side => reachesZone(sideZone(f, side, Math.min(rule.distance, 40))));
    return reachesZone(corners(f, 15));
  };

  return { nx, ny, cell: CELL, reach, startOk, reaches, reachesZone, freeRatio: reachable / (nx * ny) };
}

function nearPolygon(p, poly, r) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= r) return true;
  }
  return false;
}

export function issueSummary(result) {
  const { error, warn } = result.counts;
  if (!error && !warn) return '問題は見つかりませんでした';
  return [error ? `重要 ${error}件` : '', warn ? `注意 ${warn}件` : ''].filter(Boolean).join(' / ');
}

