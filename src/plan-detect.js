// 間取り図画像の自動認識
// 1. 濃い線を抽出し、太い線だけを「壁」とする（文字・窓の細線・ドアの軌跡・太字の部屋名・鮮やかな色の塗りは除く）
// 2. 外壁に囲まれた範囲を「建物」とする（窓の切れ目から外へ漏れないよう、上下左右の3方向以上に壁がある画素を内側とみなす）
// 3. 建物の内側を、壁・細線・ドア幅程度のすき間でさらに区切って「部屋」の候補を取り出し、
//    太い壁ではなく文字や細線だけで切られた断片は同じ部屋としてつなげる
// 4. 建物の内壁を長方形の集まりとして取り出す（キャンバス上の壁になる）
// 座標・長さはすべて元画像のピクセル単位で返す（縮尺は利用者が入力する広さ・幅から決める）。

const MAX_SIDE = 1000;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を解析できませんでした'));
    img.src = src;
  });
}

/** 大津の方法による2値化のしきい値 */
function otsu(lum) {
  const hist = new Array(256).fill(0);
  for (const v of lum) hist[v]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  return th;
}

/** mask が true の画素からの距離（2パスの近似距離変換） */
function distance(mask, W, H) {
  const INF = 1e9, D = Math.SQRT2;
  const d = new Float32Array(W * H);
  for (let k = 0; k < d.length; k++) d[k] = mask[k] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    let v = d[k];
    if (x > 0) v = Math.min(v, d[k - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[k - W] + 1);
      if (x > 0) v = Math.min(v, d[k - W - 1] + D);
      if (x < W - 1) v = Math.min(v, d[k - W + 1] + D);
    }
    d[k] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x;
    let v = d[k];
    if (x < W - 1) v = Math.min(v, d[k + 1] + 1);
    if (y < H - 1) {
      v = Math.min(v, d[k + W] + 1);
      if (x < W - 1) v = Math.min(v, d[k + W + 1] + D);
      if (x > 0) v = Math.min(v, d[k + W - 1] + D);
    }
    d[k] = v;
  }
  return d;
}

function dilate(mask, W, H, r) {
  const d = distance(mask, W, H);
  const out = new Uint8Array(W * H);
  for (let k = 0; k < out.length; k++) out[k] = d[k] <= r ? 1 : 0;
  return out;
}

function erode(mask, W, H, r) {
  const inv = new Uint8Array(W * H);
  for (let k = 0; k < inv.length; k++) inv[k] = mask[k] ? 0 : 1;
  const d = distance(inv, W, H);
  const out = new Uint8Array(W * H);
  for (let k = 0; k < out.length; k++) out[k] = d[k] > r ? 1 : 0;
  return out;
}

/**
 * 同じ行・列で壁にはさまれた長さ maxLen 以下のすき間を埋める。
 * minRun > 0 のときは、すき間の少なくとも片側で壁がその向きに minRun 以上続く所（＝壁の線の途中にあるドアの切れ目）だけを埋める。
 * 向かい合う2枚の壁の間（収納やWICのような幅の狭い部屋）は埋めない
 */
function fillGaps(mask, W, H, maxLen, minRun = 0) {
  const out = mask.slice();
  const run = (get, set, n) => {
    let last = -1, runStart = -1;
    for (let i = 0; i < n; i++) {
      if (!get(i)) continue;
      const gap = i - last - 1;
      if (last >= 0 && gap > 0 && gap <= maxLen) {
        let ok = !minRun || last - runStart + 1 >= minRun;
        for (let j = i; !ok && j < n && get(j); j++) if (j - i + 1 >= minRun) ok = true;
        if (ok) for (let j = last + 1; j < i; j++) set(j);
      }
      if (last !== i - 1) runStart = i;
      last = i;
    }
  };
  for (let y = 0; y < H; y++) run(x => mask[y * W + x], x => { out[y * W + x] = 1; }, W);
  for (let x = 0; x < W; x++) run(y => mask[y * W + x], y => { out[y * W + x] = 1; }, H);
  return out;
}

/** 半径 r の正方形範囲の最大値（縦横に分けて計算） */
function localMax(src, W, H, r) {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let i = Math.max(0, x - r); i <= Math.min(W - 1, x + r); i++) m = Math.max(m, src[y * W + i]);
    tmp[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 0;
    for (let j = Math.max(0, y - r); j <= Math.min(H - 1, y + r); j++) m = Math.max(m, tmp[j * W + x]);
    out[y * W + x] = m;
  }
  return out;
}

function count(mask) {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

/** 連結成分（4近傍） */
function label(free, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < free.length; s++) {
    if (!free[s] || lab[s] >= 0) continue;
    const id = comps.length;
    const c = { id, n: 0, minX: W, minY: H, maxX: 0, maxY: 0, border: false };
    lab[s] = id;
    stack.push(s);
    while (stack.length) {
      const k = stack.pop();
      const x = k % W, y = (k - x) / W;
      c.n++;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.border = true;
      if (x > 0 && free[k - 1] && lab[k - 1] < 0) { lab[k - 1] = id; stack.push(k - 1); }
      if (x < W - 1 && free[k + 1] && lab[k + 1] < 0) { lab[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && free[k - W] && lab[k - W] < 0) { lab[k - W] = id; stack.push(k - W); }
      if (y < H - 1 && free[k + W] && lab[k + W] < 0) { lab[k + W] = id; stack.push(k + W); }
    }
    comps.push(c);
  }
  return { lab, comps };
}

/**
 * 小さな塊（太字の文字・設備の記号など）を取り除く。
 * 壁の切れ端や柱は中まで詰まっているので残し、文字のようにすき間の多い塊だけを消す
 */
function dropSmallBlobs(mask, W, H, minSpan) {
  const { lab, comps } = label(mask, W, H);
  const drop = comps.map(c => {
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    const span = Math.max(bw, bh);
    if (span >= minSpan) return false;
    return c.n / (bw * bh) < 0.8;
  });
  const out = mask.slice();
  for (let k = 0; k < out.length; k++) if (lab[k] >= 0 && drop[lab[k]]) out[k] = 0;
  return out;
}

/**
 * 同じ部屋が文字・ドアの軌跡・細線で切られてできた断片をつなげる。
 * 2つの候補の間の区切りを調べ、壁（ドアの切れ目を埋めた所も含む）より「壁でない区切り」の方が長ければ同じ部屋とみなす。
 * symMask は設備の記号（浴槽・便器・ドアの軌跡など中のすいた図形）の線。記号だけで切られた断片は広さに関係なくつなげる。
 * colors は連結成分ごとの床の色の合計 [r, g, b, 画素数]。色が大きく違う所（赤く塗った収納と洋室など）はつなげない。
 * つなげた結果が smallMax 画素以下（浴室・トイレくらいの小さな部屋）なら、広さの比べ方に関係なくつなげる
 * （浴槽の手前の線や便器の線で、小さな部屋が半分ずつに切られるのを防ぐ）
 */
function mergeFragments(lab, comps, hardMask, symMask, building, W, H, sepMax, minShared, colors, smallMax) {
  const parent = comps.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairs = new Map();
  const scan = (n, at) => {
    let lastLab = -1, lastPos = -1;
    for (let i = 0; i < n; i++) {
      const k = at(i);
      const l = lab[k];
      if (l < 0) continue;
      if (lastLab >= 0 && l !== lastLab && i - lastPos - 1 <= sepMax) {
        let hard = false, sym = false, inside = true;
        for (let j = lastPos + 1; j < i; j++) {
          const kk = at(j);
          if (hardMask[kk]) hard = true;
          if (symMask[kk]) sym = true;
          if (!building[kk]) inside = false;
        }
        if (inside) {
          const key = lastLab < l ? `${lastLab},${l}` : `${l},${lastLab}`;
          const e = pairs.get(key) || { a: lastLab, b: l, soft: 0, sym: 0, hard: 0 };
          if (hard) e.hard++; else if (sym) e.sym++; else e.soft++;
          pairs.set(key, e);
        }
      }
      lastLab = l; lastPos = i;
    }
  };
  for (let y = 0; y < H; y++) scan(W, x => y * W + x);
  for (let x = 0; x < W; x++) scan(H, y => y * W + x);
  // 引き戸や間仕切りの細線で区切られた同じくらいの広さの部屋どうし（LDKと洋室など）はつなげない。
  // 断片は元の部屋よりずっと小さいので、小さい側が大きい側の 25% 未満のときだけつなげる（記号だけで切られた場合を除く）
  const size = comps.map(c => c.n);
  const mean = id => [0, 1, 2].map(i => colors[id * 4 + i] / Math.max(1, colors[id * 4 + 3]));
  for (const e of [...pairs.values()].sort((p, q) => (q.soft + q.sym) - (p.soft + p.sym))) {
    const open = e.soft + e.sym;
    if (open < minShared || open <= e.hard * 2) continue;
    const ra = find(e.a), rb = find(e.b);
    if (ra === rb) continue;
    const bySymbol = e.sym >= e.soft;
    const small = size[ra] + size[rb] <= smallMax;
    if (!bySymbol && !small && Math.min(size[ra], size[rb]) >= Math.max(size[ra], size[rb]) * 0.25) continue;
    const ca = mean(ra), cb = mean(rb);
    if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) > 60) continue;
    parent[ra] = rb;
    size[rb] += size[ra];
    for (let i = 0; i < 4; i++) colors[rb * 4 + i] += colors[ra * 4 + i];
  }
  // 代表の番号にまとめ、外接矩形と画素数を合算する
  const merged = new Map();
  for (const c of comps) {
    const r = find(c.id);
    const m = merged.get(r);
    if (!m) merged.set(r, { ...c, id: r });
    else {
      m.n += c.n;
      m.minX = Math.min(m.minX, c.minX); m.minY = Math.min(m.minY, c.minY);
      m.maxX = Math.max(m.maxX, c.maxX); m.maxY = Math.max(m.maxY, c.maxY);
      m.border = m.border || c.border;
    }
  }
  for (let k = 0; k < lab.length; k++) if (lab[k] >= 0) lab[k] = find(lab[k]);
  return [...merged.values()];
}

/** 壁の太さ（よく出てくる短い連続長） */
function wallThickness(wall, W, H) {
  const hist = new Array(80).fill(0);
  const add = n => { if (n >= 2 && n < hist.length) hist[n]++; };
  for (let y = 0; y < H; y += 2) {
    let n = 0;
    for (let x = 0; x < W; x++) { if (wall[y * W + x]) n++; else { add(n); n = 0; } }
  }
  for (let x = 0; x < W; x += 2) {
    let n = 0;
    for (let y = 0; y < H; y++) { if (wall[y * W + x]) n++; else { add(n); n = 0; } }
  }
  let best = 6;
  for (let i = 2; i < hist.length; i++) if (hist[i] > hist[best]) best = i;
  return best;
}

/** 上下左右のうち3方向以上に壁がある画素を「建物の内側」とする */
function buildingMask(wall, W, H, gapLen) {
  const hits = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let seen = false;
    for (let x = 0; x < W; x++) { const k = y * W + x; if (seen) hits[k]++; if (wall[k]) seen = true; }
    seen = false;
    for (let x = W - 1; x >= 0; x--) { const k = y * W + x; if (seen) hits[k]++; if (wall[k]) seen = true; }
  }
  for (let x = 0; x < W; x++) {
    let seen = false;
    for (let y = 0; y < H; y++) { const k = y * W + x; if (seen) hits[k]++; if (wall[k]) seen = true; }
    seen = false;
    for (let y = H - 1; y >= 0; y--) { const k = y * W + x; if (seen) hits[k]++; if (wall[k]) seen = true; }
  }
  const b = new Uint8Array(W * H);
  for (let k = 0; k < b.length; k++) b[k] = hits[k] >= 3 || wall[k] ? 1 : 0;
  // 大きなまとまりだけを建物とする（紙の端や欄外の小さな線を除く）。
  // 窓・ドアが一直線に並ぶ行では建物が上下に切れることがあるので、大きなまとまりはすべて残す
  const { lab, comps } = label(b, W, H);
  if (!comps.length) return b;
  const maxN = Math.max(...comps.map(c => c.n));
  const keep = new Set(comps.filter(c => c.n >= maxN * 0.05).map(c => c.id));
  for (let k = 0; k < b.length; k++) b[k] = keep.has(lab[k]) ? 1 : 0;
  // 建物の中の細い切れ目（窓・ドアが並んだ帯）を埋める
  const filled = fillGaps(b, W, H, gapLen);
  // 上下（左右）の窓が同じ列に並ぶ所は2方向にしか壁がなく、部屋の中に穴が開く。画像の端につながらない穴は建物の内側とする
  const outside = new Uint8Array(W * H);
  for (let k = 0; k < outside.length; k++) outside[k] = filled[k] ? 0 : 1;
  const holes = label(outside, W, H);
  for (let k = 0; k < filled.length; k++) if (holes.lab[k] >= 0 && !holes.comps[holes.lab[k]].border) filled[k] = 1;
  return filled;
}

/** マスクを長方形の集まりに分解する（セルで粗くしてから、同じ横幅の行をまとめる） */
function maskToRects(mask, W, H, box, cell) {
  const gw = Math.ceil((box.x1 - box.x0 + 1) / cell), gh = Math.ceil((box.y1 - box.y0 + 1) / cell);
  const grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let n = 0, t = 0;
    for (let y = box.y0 + gy * cell; y < Math.min(box.y1 + 1, box.y0 + (gy + 1) * cell); y++) {
      for (let x = box.x0 + gx * cell; x < Math.min(box.x1 + 1, box.x0 + (gx + 1) * cell); x++) { t++; n += mask[y * W + x]; }
    }
    grid[gy * gw + gx] = t && n / t >= 0.5 ? 1 : 0;
  }
  const rects = [];
  let open = new Map();
  for (let gy = 0; gy < gh; gy++) {
    const next = new Map();
    let gx = 0;
    while (gx < gw) {
      if (!grid[gy * gw + gx]) { gx++; continue; }
      let e = gx;
      while (e < gw && grid[gy * gw + e]) e++;
      const key = `${gx}-${e}`;
      const r = open.get(key);
      if (r) { r.gh++; next.set(key, r); } else {
        const nr = { gx, gy, gw: e - gx, gh: 1 };
        rects.push(nr);
        next.set(key, nr);
      }
      gx = e;
    }
    open = next;
  }
  return rects
    .filter(r => r.gw * r.gh >= 3)
    .map(r => ({
      x: box.x0 + r.gx * cell, y: box.y0 + r.gy * cell,
      w: Math.min(r.gw * cell, box.x1 + 1 - (box.x0 + r.gx * cell)), h: Math.min(r.gh * cell, box.y1 + 1 - (box.y0 + r.gy * cell)),
    }));
}

/**
 * 矩形 (x0..x1, y0..y1) の外周のすぐ外側で、壁が途切れている所を探す。
 * lines = 切れ目の中に細い線（窓ガラス・サッシの線）がある割合。ドアの切れ目は何も描かれていないことが多い
 */
function findOpenings(rect, wall, W, H, band, minGap, classify, faint) {
  const { x0, y0, x1, y1 } = rect;
  const openings = [];
  const sides = [
    { wall: 'top', len: x1 - x0 + 1, at: t => [x0 + t, y0 - 1], out: [0, -1] },
    { wall: 'bottom', len: x1 - x0 + 1, at: t => [x0 + t, y1 + 1], out: [0, 1] },
    { wall: 'left', len: y1 - y0 + 1, at: t => [x0 - 1, y0 + t], out: [-1, 0] },
    { wall: 'right', len: y1 - y0 + 1, at: t => [x1 + 1, y0 + t], out: [1, 0] },
  ];
  for (const s of sides) {
    const open = new Uint8Array(s.len);
    for (let t = 0; t < s.len; t++) {
      const [bx, by] = s.at(t);
      let hasWall = false;
      for (let d = 0; d < band && !hasWall; d++) {
        const x = bx + s.out[0] * d, y = by + s.out[1] * d;
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        if (wall[y * W + x]) hasWall = true;
      }
      open[t] = hasWall ? 0 : 1;
    }
    const margin = Math.max(2, Math.round(band / 2));
    let t = margin;
    while (t < s.len - margin) {
      if (!open[t]) { t++; continue; }
      let e = t;
      while (e < s.len - margin && open[e]) e++;
      if (e - t >= minGap) {
        const [bx, by] = s.at(Math.round((t + e) / 2));
        const c = classify(bx, by, s.out);
        let lined = 0;
        for (let u = t; u < e; u++) {
          const [px0, py0] = s.at(u);
          for (let d = 0; d < band; d++) {
            const x = px0 + s.out[0] * d, y = py0 + s.out[1] * d;
            if (x < 0 || y < 0 || x >= W || y >= H) break;
            if (faint[y * W + x]) { lined++; break; }
          }
        }
        openings.push({ wall: s.wall, offset: t, width: e - t, side: c.side ?? c, neighbor: c.neighbor ?? -1, lines: lined / (e - t) });
      }
      t = e;
    }
  }
  return openings;
}

/**
 * 室内の記号（浴槽・便器・洗面台・洗濯機パン・キッチンなどの細線の図形）を取り出す。
 * edges は外接矩形の上下左右の辺に沿って線がある割合（四角い記号は3辺以上が高く、ドアの軌跡は1辺だけ高い）。
 * mask は「中のすいた、ある程度の大きさの図形」（浴槽・便器・ドアの軌跡など）の線。引き戸の二重線や文字のように
 * 細い・線の詰まった図形は含めない（部屋の断片をつなげるときに使う）
 */
function extractSymbols(dark, nearWall, building, W, H, minSide) {
  const sym = new Uint8Array(W * H);
  for (let k = 0; k < sym.length; k++) sym[k] = dark[k] && !nearWall[k] && building[k] ? 1 : 0;
  // 途切れた線をつなぐ
  const { lab, comps } = label(dilate(sym, W, H, 1), W, H);
  const minSpan = Math.max(6, Math.round(Math.max(W, H) * 0.015));
  const band = 3;
  const out = [];
  const outline = new Uint8Array(comps.length);
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    if (c.border || Math.max(bw, bh) < minSpan) continue;
    const cover = (len, at) => {
      let hit = 0;
      for (let t = 0; t < len; t++) {
        for (let d = 0; d < band; d++) if (lab[at(t, d)] === c.id) { hit++; break; }
      }
      return hit / len;
    };
    if (c.n / (bw * bh) <= 0.5 && Math.min(bw, bh) >= minSide) outline[c.id] = 1;
    out.push({
      x: c.minX, y: c.minY, w: bw, h: bh,
      fill: c.n / (bw * bh),
      edges: {
        top: cover(bw, (t, d) => (c.minY + d) * W + c.minX + t),
        bottom: cover(bw, (t, d) => (c.maxY - d) * W + c.minX + t),
        left: cover(bh, (t, d) => (c.minY + t) * W + c.minX + d),
        right: cover(bh, (t, d) => (c.minY + t) * W + c.maxX - d),
      },
    });
  }
  const mask = new Uint8Array(W * H);
  for (let k = 0; k < mask.length; k++) if (lab[k] >= 0 && outline[lab[k]]) mask[k] = 1;
  return { list: out, mask };
}

/**
 * ドアの記号（扇形：4分の1円の軌跡＋扉の線）を探す。
 * 蝶番の位置・開く向き（4方向）・半径 r を総当たりし、半径 r の4分の1円の上に線が十分あるものをドアとみなす。
 * 見つけたら、その円弧と扉の線を取り除いてもう一度探す（トイレと洗面所のように、扇形が重なった2枚のドアも分けて拾う）。
 * 蝶番に接する2辺のうち、両端の先に壁が続いている方が出入口（壁の切れ目）。
 * 戻り値（画像のピクセル）: [{ x, y, width, orient: 'h'|'v', side: 1|-1, hinge: 'start'|'end' }]
 *   x, y = 出入口の中心（壁の中心線上）、orient = 壁の向き、side = 開く向き（+x / +y が 1）、hinge = 蝶番が座標の小さい側なら 'start'
 */
function findDoorArcs(dark, nearWall, area, wall, W, H, tWall) {
  const m = new Uint8Array(W * H);
  for (let k = 0; k < m.length; k++) m[k] = dark[k] && !nearWall[k] && area[k] ? 1 : 0;
  const { lab, comps } = label(dilate(m, W, H, 1), W, H);
  // ドアの幅は壁の厚みの数倍（壁 12〜15cm に対してドア 60〜90cm）。それより小さい曲線（便器・洗面台など）は除く
  const minR = Math.max(12, tWall * 3.5), maxR = Math.max(W, H) * 0.2;
  // 候補：ドア1〜2枚分の大きさで、中のすいた図形
  const cand = comps.filter(c => {
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    return !c.border && Math.min(bw, bh) >= minR && Math.max(bw, bh) <= maxR * 2 && Math.max(bw, bh) / Math.min(bw, bh) <= 2.5
      && c.n / (bw * bh) <= 0.45;
  });
  if (!cand.length) return [];
  const pts = new Map(cand.map(c => [c.id, []]));
  for (let k = 0; k < lab.length; k++) {
    const l = lab[k];
    if (l >= 0 && pts.has(l)) pts.get(l).push(k % W, (k - (k % W)) / W);
  }
  const wallNear = (x, y) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = Math.round(x + dx), yy = Math.round(y + dy);
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && wall[yy * W + xx]) return true;
    }
    return false;
  };
  const QUADS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  // 蝶番 (hx, hy)・向き (qx, qy)・半径 r の扇形の円弧に乗る点か／扉の線（蝶番から軸に沿った線）に乗る点か
  const tolOf = r => Math.max(2, r * 0.08);
  const onArcOf = (x, y, hx, hy, qx, qy, r) => (x - hx) * qx >= -2 && (y - hy) * qy >= -2 && Math.abs(Math.hypot(x - hx, y - hy) - r) <= tolOf(r);
  const onLeafOf = (x, y, hx, hy, qx, qy, r) => ((Math.abs(x - hx) <= 2 && (y - hy) * qy >= -2 && (y - hy) * qy <= r + 2)
    || (Math.abs(y - hy) <= 2 && (x - hx) * qx >= -2 && (x - hx) * qx <= r + 2));

  const arcs = [];
  for (const c of cand) {
    const all = pts.get(c.id);
    let rest = all;
    for (let iter = 0; iter < 2 && rest.length / 2 >= minR * 2; iter++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < rest.length; i += 2) {
        x0 = Math.min(x0, rest[i]); x1 = Math.max(x1, rest[i]); y0 = Math.min(y0, rest[i + 1]); y1 = Math.max(y1, rest[i + 1]);
      }
      const rMax = Math.min(maxR, Math.max(x1 - x0, y1 - y0) + 3);
      const hist = new Float32Array(Math.ceil(rMax) + 8);
      // 円弧に乗る点が多い組み合わせを候補として集め、すべてについて「4分の1周そろっているか」「扉の線があるか」を確かめる
      const combos = [];
      // 蝶番は壁の面にあり、壁ぎわの線は消してあるので、図形の外側まで広く探す
      const pad = tWall * 2 + 6;
      for (let hy = y0 - pad; hy <= y1 + pad; hy += 2) for (let hx = x0 - pad; hx <= x1 + pad; hx += 2) {
        for (const [qx, qy] of QUADS) {
          hist.fill(0);
          for (let i = 0; i < rest.length; i += 2) {
            const dx = rest[i] - hx, dy = rest[i + 1] - hy;
            if (dx * qx < -2 || dy * qy < -2) continue;
            const d = Math.hypot(dx, dy);
            if (d < hist.length) hist[Math.round(d)]++;
          }
          for (let r = Math.ceil(minR); r <= rMax; r++) {
            const tol = Math.round(tolOf(r));
            let n = 0;
            for (let d = r - tol; d <= r + tol; d++) n += hist[d] || 0;
            // 4分の1円の長さ（約 1.57r）× 線の太さ（約 3px）に対して、線が十分乗っているか
            if (n >= r * 3) combos.push({ hx, hy, qx, qy, r, n });
          }
        }
      }

      let best = null;
      for (const cb of combos) {
        // 円弧が4分の1周のほとんど（角度の 9 区分のうち 8 以上）にわたっているか
        const bins = new Uint8Array(9);
        const leafX = new Uint8Array(cb.r + 3), leafY = new Uint8Array(cb.r + 3);
        let leafPts = 0, inner = 0;
        // 確かめるときは元の線をすべて使う（1枚目のドアと交差する所で、2枚目の円弧や扉の線が欠けないように）
        for (let i = 0; i < all.length; i += 2) {
          const x = all[i], y = all[i + 1];
          if (onArcOf(x, y, cb.hx, cb.hy, cb.qx, cb.qy, cb.r)) {
            const ang = Math.atan2(Math.abs(y - cb.hy), Math.abs(x - cb.hx));
            bins[Math.min(8, Math.floor((ang / (Math.PI / 2)) * 9))] = 1;
          }
          // 扉の線（蝶番から壁と直角に伸びる線）
          const dx = (x - cb.hx) * cb.qx, dy = (y - cb.hy) * cb.qy;
          if (Math.abs(x - cb.hx) <= 2 && dy >= 0 && dy <= cb.r + 2) { leafY[Math.round(dy)] = 1; leafPts++; }
          else if (Math.abs(y - cb.hy) <= 2 && dx >= 0 && dx <= cb.r + 2) { leafX[Math.round(dx)] = 1; leafPts++; }
          else if (dx > 2 && dy > 2 && Math.hypot(dx, dy) < cb.r - tolOf(cb.r) - 1) inner++; // 扇形の内側の線（本物のドアなら少ない）
        }
        if (bins.reduce((p, q) => p + q, 0) < 8) continue;
        const leaf = Math.max(leafX.reduce((p, q) => p + q, 0), leafY.reduce((p, q) => p + q, 0)) / cb.r;
        if (leaf < 0.6) continue;
        // 2枚のドアの円弧が重なると、両方にまたがる大きな偽の円が合うことがある。その場合は内側に別の線がたくさん入る
        const score = cb.n + leafPts - inner * 1.5;
        if (!best || score > best.score) best = { ...cb, score };
      }
      if (!best) break;
      arcs.push(best);
      const left = [];
      for (let i = 0; i < rest.length; i += 2) {
        const x = rest[i], y = rest[i + 1];
        if (!onArcOf(x, y, best.hx, best.hy, best.qx, best.qy, best.r) && !onLeafOf(x, y, best.hx, best.hy, best.qx, best.qy, best.r)) left.push(x, y);
      }
      rest = left;
    }
  }

  const doors = [];
  for (const { hx, hy, qx, qy, r } of arcs) {
    const ox = hx + qx * r, oy = hy + qy * r; // 蝶番の反対側の角
    // 蝶番に接する2辺：横の辺（y = hy、x は hx→ox）と縦の辺（x = hx、y は hy→oy）。両端の先に壁がある方が出入口
    // 出入口の線の上は壁が切れている（浴槽や洗面台の角の丸みを、壁ぎわのドアと間違えないように）
    const ext = Math.max(4, tWall);
    const half = tWall / 2;
    const gapOk = (horiz) => {
      let n = 0, onWall = 0;
      for (let t = 0.15; t <= 0.85; t += 0.05) {
        const x = Math.round(horiz ? hx + qx * t * r : hx - qx * half), y = Math.round(horiz ? hy - qy * half : hy + qy * t * r);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        n++;
        if (wall[y * W + x]) onWall++;
      }
      return n > 0 && onWall / n <= 0.3;
    };
    // 出入口の両端の先（壁の中心線上）に壁があり、少なくとも片側は同じ向きに壁が続いていること
    // （細い部屋の中の便器などが、両側の壁を出入口の枠と間違えられないように）
    const far = ext + tWall * 2 + 2;
    const hScore = gapOk(true)
      ? (wallNear(hx - qx * ext, hy - qy * half) && wallNear(ox + qx * ext, hy - qy * half) ? 2 : 0)
        + (wallNear(hx - qx * far, hy - qy * half) || wallNear(ox + qx * far, hy - qy * half) ? 1 : 0) : 0;
    const vScore = gapOk(false)
      ? (wallNear(hx - qx * half, hy - qy * ext) && wallNear(hx - qx * half, oy + qy * ext) ? 2 : 0)
        + (wallNear(hx - qx * half, hy - qy * far) || wallNear(hx - qx * half, oy + qy * far) ? 1 : 0) : 0;
    if (Math.max(hScore, vScore) < 3) continue;
    if (hScore >= vScore) {
      // 横向きの壁にある出入口。扇形は壁の内側（oy の方）に開く。壁は扇形の外側
      doors.push({ x: (hx + ox) / 2, y: hy - qy * half, width: r, orient: 'h', side: qy, hinge: hx < ox ? 'start' : 'end' });
    } else {
      doors.push({ x: hx - qx * half, y: (hy + oy) / 2, width: r, orient: 'v', side: qx, hinge: hy < oy ? 'start' : 'end' });
    }
  }
  return doors;
}

/**
 * 引き戸・折れ戸を探す（扇形のない戸）。
 * まず壁の線の中の切れ目（出入口）を探し、切れ目の中と脇に描かれた線で種類を決める。
 * - 引き戸：切れ目の中を壁と同じ向きに走る線が、壁の両面の枠線以外にもある（ずれて重なる戸）
 * - 折れ戸：切れ目の脇から部屋の内側へ、小さな山形（く の字・Λ）が出ている
 * 線も印もない切れ目（ただの通路）や、枠線だけの切れ目は戸にしない。切れ目の両側が別の部屋（lab の番号が違う）であること。
 * 戻り値は findDoorArcs と同じ形に style（'sliding' | 'folding'）を加えたもの
 */
function findGapDoors(dark, wall, building, lab, W, H, tWall) {
  const minGap = Math.max(8, tWall * 2), maxGap = Math.max(W, H) * 0.35;
  const minRun = Math.max(3, Math.round(tWall * 1.6));
  const thin = new Uint8Array(W * H);
  for (let k = 0; k < thin.length; k++) thin[k] = dark[k] && !wall[k] ? 1 : 0;
  const doors = [];
  for (const horiz of [true, false]) {
    // horiz: 横向きの壁（行ごとに x 方向の切れ目を探す）。縦向きは x と y を入れ替えて同じことをする
    const NA = horiz ? W : H, NC = horiz ? H : W; // a = 壁に沿った向き、c = 壁を横切る向き
    const idx = (a, c) => (horiz ? c * W + a : a * W + c);
    const get = (m, a, c) => a >= 0 && c >= 0 && a < NA && c < NC && m[idx(a, c)];
    // 壁の一続き（start..end-1、c の行）が、切れ目と同じ向きに走る壁か（横切る向きの厚みが壁の厚みくらい）
    // 角や柱（PS）に接する所でも見分けられるよう、何か所かで測って1か所でも壁の厚みなら認める
    const along = (start, end, c) => {
      if (end - start < minRun) return false;
      for (const t of [0.25, 0.5, 0.75]) {
        const m = Math.floor(start + (end - start) * t);
        let u = c, v = c;
        while (get(wall, m, u - 1)) u--;
        while (get(wall, m, v + 1)) v++;
        if (v - u + 1 <= tWall * 2 + 2) return true;
      }
      return false;
    };
    // 各行（列）で「壁の線の途中の切れ目」を集める（少なくとも片側が同じ向きの壁。部屋の中で向かい合う壁の間は除く）
    const recs = [];
    for (let c = 0; c < NC; c++) {
      let prevStart = -1, prevEnd = -1, a = 0;
      while (a < NA) {
        if (!get(wall, a, c)) { a++; continue; }
        let e = a;
        while (e < NA && get(wall, e, c)) e++;
        if (prevEnd >= 0) {
          const gap = a - prevEnd;
          if (gap >= minGap && gap <= maxGap && (along(prevStart, prevEnd, c) || along(a, e, c))) recs.push({ c, a0: prevEnd, a1: a - 1 });
        }
        prevStart = a; prevEnd = e; a = e;
      }
    }
    // 同じ切れ目が壁の厚みの分だけ続く所を1つの出入口にまとめる（戸の線で切れ目の端が少しずれる列もまとめる）
    recs.sort((p, q) => p.c - q.c || p.a0 - q.a0);
    const groups = [];
    const tol = Math.max(3, tWall);
    for (const r of recs) {
      const g = groups.find(g => Math.abs(g.a0 - r.a0) <= tol && Math.abs(g.a1 - r.a1) <= tol && r.c - g.c1 <= 3);
      if (g) { g.c1 = r.c; g.a0 = Math.min(g.a0, r.a0); g.a1 = Math.max(g.a1, r.a1); } else groups.push({ a0: r.a0, a1: r.a1, c0: r.c, c1: r.c });
    }
    // 切れ目 g の dir 側の脇に、折れ戸の山形の印があるか
    const markerAt = (g, dir, L) => {
      const face = dir < 0 ? g.c0 - 2 : g.c1 + 2; // 枠線のすぐ外側から
      const lo = g.a0 - 2, hi = g.a1 + 2, maxD = Math.round(L * 0.8);
      const seen = new Set();
      for (let d0 = 0; d0 <= 4; d0++) for (let a0 = g.a0; a0 <= g.a1; a0++) {
        const c0 = face + dir * d0;
        if (!get(thin, a0, c0) || seen.has(a0 * 100000 + c0)) continue;
        // 範囲の中だけで塗りつぶして、1つの図形を取り出す
        const stack = [[a0, c0]], pts = [];
        let escapes = false;
        seen.add(a0 * 100000 + c0);
        while (stack.length) {
          const [a, c] = stack.pop();
          pts.push([a, (c - face) * dir]);
          // 斜めの細線（Λ の脚）もつながるよう、斜めのとなりもたどる
          for (const [na, nc] of [[a + 1, c], [a - 1, c], [a, c + 1], [a, c - 1], [a + 1, c + 1], [a - 1, c - 1], [a + 1, c - 1], [a - 1, c + 1]]) {
            const dd = (nc - face) * dir;
            if (!get(thin, na, nc)) continue;
            if (na < lo || na > hi || dd > maxD) { escapes = true; continue; }
            if (dd < 0 || seen.has(na * 100000 + nc)) continue;
            seen.add(na * 100000 + nc);
            stack.push([na, nc]);
          }
        }
        if (escapes || pts.length < 6) continue;
        const as = pts.map(p => p[0]), ds = pts.map(p => p[1]);
        const span = Math.max(...as) - Math.min(...as) + 1, depth = Math.max(...ds) + 1;
        if (span < L * 0.12 || span > L * 0.7 || depth < L * 0.2 || depth > L * 0.7) continue;
        // 先が1つにとがっている：奥の 1/4 の幅が、全体の幅の 1/3 以下（W の字のように先が2つあるものは除く）
        const tip = pts.filter(p => p[1] >= depth * 0.75).map(p => p[0]);
        if (Math.max(...tip) - Math.min(...tip) + 1 > Math.max(3, span * 0.35)) continue;
        return true;
      }
      return false;
    };
    for (const g of groups) {
      const band = g.c1 - g.c0 + 1;
      if (band < Math.max(3, tWall * 0.5) || band > tWall * 2) continue; // 壁の厚みの帯でない（部屋の中の行など）
      // 帯が薄い切れ目（戸の太い線が壁と見なされて切れ目が細くなった所や、短い壁の端の下など）は引き戸だけ認める
      const thinBand = band < tWall * 0.7;
      const L = g.a1 - g.a0 + 1, cMid = (g.c0 + g.c1) / 2;
      // 両側が建物の中（外壁の窓ではない）
      const P = (a, c) => (horiz ? [Math.round(a), Math.round(c)] : [Math.round(c), Math.round(a)]);
      const inB = (a, c) => { const [x, y] = P(a, c); return x >= 0 && y >= 0 && x < W && y < H && building[y * W + x]; };
      const am = (g.a0 + g.a1) / 2;
      if (!inB(am, g.c0 - tWall - 4) || !inB(am, g.c1 + tWall + 4)) continue;
      // 両側の部屋（壁が T 字に終わる所の先など、同じ部屋の中の「切れ目」は除く）
      const roomAt = dir => {
        for (let d = tWall + 3; d <= tWall + 14; d += 2) for (let t = 0.3; t <= 0.7; t += 0.1) {
          const [x, y] = P(g.a0 + t * L, dir < 0 ? g.c0 - d : g.c1 + d);
          if (x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] >= 0) return lab[y * W + x];
        }
        return -1;
      };
      const ra = roomAt(-1), rb = roomAt(1);
      if (ra < 0 || rb < 0 || ra === rb) continue;
      // 切れ目の中の線：壁の帯（±2）の各行で、線がある割合
      const lines = [];
      for (let c = g.c0 - 2; c <= g.c1 + 2; c++) {
        let n = 0;
        for (let a = g.a0; a <= g.a1; a++) if (get(thin, a, c)) n++;
        const cov = n / L;
        if (cov < 0.25) continue;
        const last = lines[lines.length - 1];
        if (last && c - last.c1 <= 1) { last.c1 = c; last.cov = Math.max(last.cov, cov); } else lines.push({ c0: c, c1: c, cov });
      }
      const atFace = l => l.c1 <= g.c0 + 1 || l.c0 >= g.c1 - 1;
      const frameOnly = lines.length > 0 && lines.every(l => atFace(l) && l.cov >= 0.85);
      // 引き戸：枠線以外の線がある、または枠線が途中で切れている（2枚の戸がずれて重なる）
      if (lines.length >= 2 && !frameOnly) {
        const [x, y] = P(am, cMid);
        doors.push({ x, y, width: L, orient: horiz ? 'h' : 'v', side: 1, hinge: 'start', style: 'sliding' });
        continue;
      }
      // 折れ戸：切れ目の脇（両側のどちらか）に、壁の面に接して部屋側へ出た小さな山形（Λ・く）。
      // 脇の範囲の線を1つずつの図形に分け、範囲の外へはみ出さず（ドアの軌跡・便器などは除く）、先がとがった図形を探す
      const found = thinBand ? undefined : [-1, 1].find(dir => markerAt(g, dir, L));
      if (found) {
        const [x, y] = P(am, cMid);
        doors.push({ x, y, width: L, orient: horiz ? 'h' : 'v', side: found, hinge: 'start', style: 'folding' });
      }
    }
  }
  return doors;
}

/**
 * 画像を解析する。戻り値（すべて元画像のピクセル単位）:
 * {
 *   width, height,
 *   rooms: [{ key, x, y, w, h, areaPx, color: [r, g, b],                          部屋の候補（color は床の平均色）
 *             openings: [{ wall, offset, width, side, neighbor }] }],             neighbor = 切れ目の先の部屋の key（-1 = なし）
 *   plan: { x, y, w, h, walls: [{ x, y, w, h }], openings, doors, floorPx } | null  建物全体（外壁の内側）と内壁。floorPx = 専有面積にあたる床の画素数
 *                                                                                doors = ドアの記号（findDoorArcs）
 *   symbols: [{ x, y, w, h, fill, edges }]                                       室内の記号（設備の判定に使う）
 *   paper: [r, g, b]                                                             建物の外（紙・背景）の色
 * }
 */
export async function detectFloorplan(dataUrl) {
  const img = await loadImage(dataUrl);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const f = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const W = Math.max(8, Math.round(nw * f)), H = Math.max(8, Math.round(nh * f));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  const lum = new Uint8Array(W * H);
  for (let k = 0; k < lum.length; k++) lum[k] = Math.round(0.299 * px[k * 4] + 0.587 * px[k * 4 + 1] + 0.114 * px[k * 4 + 2]);
  const th = Math.min(otsu(lum), 128);
  // 周囲（7×7）の明るさより十分暗い画素も線とみなす（色付きの床の上の細線や、薄く描かれた窓の線を拾う）
  const bgLum = localMax(lum, W, H, 3);
  // 壁は黒〜灰色で描かれるので、鮮やかな色（赤く塗った収納など）は暗くても線とみなさない
  const dark = new Uint8Array(W * H);
  for (let k = 0; k < lum.length; k++) {
    const r = px[k * 4], gr = px[k * 4 + 1], b = px[k * 4 + 2];
    const vivid = Math.max(r, gr, b) - Math.min(r, gr, b) > 90 && lum[k] >= 50;
    dark[k] = !vivid && (lum[k] < th || bgLum[k] - lum[k] > 60) ? 1 : 0;
  }

  // 細い線（文字・寸法線・ドアの軌跡・窓の線）を除いて太い壁だけ残す
  const thin = Math.max(1, Math.round(Math.max(W, H) / 450));
  let wall = dilate(erode(dark, W, H, thin), W, H, thin);
  if (count(wall) < W * H * 0.003) wall = dark; // 壁が細線で描かれた図面
  // 太字の部屋名（「洋室5.5帖」など）や設備の記号を壁から除く（壁とみなすと、そこから部屋が切られてしまう）
  wall = dropSmallBlobs(wall, W, H, Math.round(Math.max(W, H) * 0.06));

  // 部屋を区切る：一直線に並ぶ壁の間の短いすき間（ドア幅程度）を埋め、窓の細線やドアの軌跡も区切りとして使う
  const g = Math.max(4, Math.round(Math.max(W, H) * 0.045));
  const gapLen = Math.round(Math.max(W, H) * 0.1);
  const building = buildingMask(wall, W, H, gapLen);
  // 壁の線の途中の切れ目だけを埋める（向かい合う壁の間＝幅の狭い収納などは埋めない）
  const tWall = wallThickness(wall, W, H);
  const bridged = fillGaps(wall, W, H, gapLen, Math.max(3, Math.round(tWall * 1.6)));
  const closed = erode(dilate(dark, W, H, 2), W, H, 2);
  // 埋めた切れ目は1px太らせる（壁の端が細くなった所に1px のすき間が残り、となりの部屋とつながるのを防ぐ）
  const bridgedWide = dilate(bridged, W, H, 1);
  for (let k = 0; k < closed.length; k++) if (dark[k] || bridgedWide[k]) closed[k] = 1;

  // 建物の外は部屋にしない（窓の切れ目から外へつながるのを防ぐ）
  const free = new Uint8Array(W * H);
  for (let k = 0; k < free.length; k++) free[k] = !closed[k] && building[k] ? 1 : 0;
  const { lab, comps: rawComps } = label(free, W, H);
  // 部屋の床の色（水まわりは水色で塗られていることが多い）。連結成分ごとの [r, g, b, 画素数] の合計
  const sums = new Float64Array(rawComps.length * 4);
  for (let k = 0; k < lab.length; k++) {
    const l = lab[k];
    if (l < 0) continue;
    sums[l * 4] += px[k * 4]; sums[l * 4 + 1] += px[k * 4 + 1]; sums[l * 4 + 2] += px[k * 4 + 2]; sums[l * 4 + 3]++;
  }
  const colorOf = id => [0, 1, 2].map(i => Math.round(sums[id * 4 + i] / Math.max(1, sums[id * 4 + 3])));
  // 室内の記号（設備の判定と、記号で切られた部屋の断片をつなげるのに使う）
  const nearWall = dilate(wall, W, H, 2);
  const sym = extractSymbols(dark, nearWall, building, W, H, Math.max(8, tWall * 2));
  // 文字・ドアの軌跡・細線で切られた同じ部屋の断片をつなげる（壁やドアの切れ目で区切られた部屋どうしはつなげない）
  const comps = mergeFragments(lab, rawComps, bridged, sym.mask, building, W, H, Math.max(8, tWall * 3), Math.max(6, Math.round(g * 0.5)), sums,
    count(building) * 0.035);

  const minArea = W * H * 0.003;
  // 周りに壁がほとんどない囲み（浴槽・キッチン・洗濯機パンなど記号の内側）は部屋にしない
  const wallAround = c => {
    const reach = 6;
    let n = 0, hit = 0;
    const probe = (x, y, dx, dy) => {
      n++;
      for (let d = 1; d <= reach; d++) {
        const xx = x + dx * d, yy = y + dy * d;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) return;
        if (wall[yy * W + xx]) { hit++; return; }
      }
    };
    for (let x = c.minX; x <= c.maxX; x += 2) { probe(x, c.minY, 0, -1); probe(x, c.maxY, 0, 1); }
    for (let y = c.minY; y <= c.maxY; y += 2) { probe(c.minX, y, -1, 0); probe(c.maxX, y, 1, 0); }
    return n ? hit / n : 0;
  };
  const rooms = comps.filter(c => {
    if (c.border || c.n < minArea) return false;
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    return c.n / (bw * bh) >= 0.45 && Math.min(bw, bh) >= 6 && wallAround(c) >= 0.25;
  });

  const band = Math.max(3, Math.round(g * 0.7));
  const minGap = Math.max(4, Math.round(g * 0.7));
  const outside = (x, y) => x < 0 || y < 0 || x >= W || y >= H || !building[y * W + x];
  // 切れ目の先が建物の外か、どの部屋か（neighbor は連結成分の番号。あとで部屋の番号に直す）
  const classifier = selfId => (bx, by, out) => {
    for (let d = band; d <= band + g * 3; d += 2) {
      const x = bx + out[0] * d, y = by + out[1] * d;
      if (outside(x, y)) return { side: 'exterior' };
      const l = lab[y * W + x];
      if (l >= 0 && l !== selfId) return { side: 'room', neighbor: l };
    }
    return { side: 'room' };
  };
  // 窓の線は薄い灰色で描かれることが多いので、白でなければ線とみなす
  const faint = new Uint8Array(W * H);
  for (let k = 0; k < faint.length; k++) faint[k] = lum[k] < 235 ? 1 : 0;
  const scaleOpenings = list => list.map(o => ({ ...o, offset: o.offset / f, width: o.width / f }));

  const resultRooms = rooms.map(c => {
    const rect = { x0: c.minX, y0: c.minY, x1: c.maxX, y1: c.maxY };
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    // ほぼ長方形の部屋は外接矩形の面積を使う（室内の文字や設備の線で面積が欠けるのを防ぐ）
    const area = c.n / (bw * bh) >= 0.75 ? bw * bh : c.n;
    return {
      x: c.minX / f, y: c.minY / f, w: bw / f, h: bh / f,
      areaPx: area / (f * f),
      color: colorOf(c.id),
      compId: c.id,
      openings: scaleOpenings(findOpenings(rect, wall, W, H, band, minGap, classifier(c.id), faint)),
    };
  }).sort((a, b) => b.areaPx - a.areaPx);
  // 切れ目の先の部屋を、部屋の key（部屋でなければ -1）に直す。key は枠を消したり足したりしても変わらない番号
  const indexOfComp = new Map(resultRooms.map((r, i) => [r.compId, i]));
  resultRooms.forEach((r, i) => { r.key = i; });
  for (const r of resultRooms) {
    for (const o of r.openings) o.neighbor = indexOfComp.has(o.neighbor) ? indexOfComp.get(o.neighbor) : -1;
    delete r.compId;
  }

  const symbols = sym.list.map(s => ({ ...s, x: s.x / f, y: s.y / f, w: s.w / f, h: s.h / f }));
  // 建物の外（紙・背景）の色。水まわりの色分けを見分ける基準にする（写真では紙が黄ばむので白とは限らない）
  const bg = [0, 0, 0, 0];
  for (let k = 0; k < building.length; k++) {
    if (building[k] || dark[k]) continue;
    bg[0] += px[k * 4]; bg[1] += px[k * 4 + 1]; bg[2] += px[k * 4 + 2]; bg[3]++;
  }
  const paper = bg[3] ? [0, 1, 2].map(i => Math.round(bg[i] / bg[3])) : [255, 255, 255];

  // 建物全体：外壁の内側の範囲と、その中の壁（内壁・建物の外にあたる部分）
  let plan = null;
  // 外壁の内側の範囲：各行・各列の端の位置の中央値を使う（窓の部分で外へはみ出すのを防ぐ）
  const inside = k => building[k] && !nearWall[k];
  const lefts = [], rights = [], tops = [], bottoms = [];
  for (let y = 0; y < H; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < W; x++) if (inside(y * W + x)) { if (a < 0) a = x; b = x; }
    if (a >= 0) { lefts.push(a); rights.push(b); }
  }
  for (let x = 0; x < W; x++) {
    let a = -1, b = -1;
    for (let y = 0; y < H; y++) if (inside(y * W + x)) { if (a < 0) a = y; b = y; }
    if (a >= 0) { tops.push(a); bottoms.push(b); }
  }
  const median = arr => { const v = arr.slice().sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : -1; };
  const x0 = median(lefts), x1 = median(rights), y0 = median(tops), y1 = median(bottoms);
  if (x1 > x0 + 10 && y1 > y0 + 10) {
    const box = { x0, y0, x1, y1 };
    const t = tWall;
    const solid = new Uint8Array(W * H);
    for (let k = 0; k < solid.length; k++) solid[k] = wall[k] || !building[k] ? 1 : 0;
    const cell = Math.max(2, Math.round(t / 2));
    const walls = maskToRects(solid, W, H, box, cell).map(r => ({ x: r.x / f, y: r.y / f, w: r.w / f, h: r.h / f }));
    // 建物の凹んだ所（外枠の内側でも建物の外）に面した辺は壁の切れ目ではないので除く
    const planOpenings = findOpenings(box, wall, W, H, band, minGap, (bx, by, out) => {
      if (outside(bx - out[0] * (band + 2), by - out[1] * (band + 2))) return 'none';
      for (let d = band; d <= band + g * 3; d += 2) if (outside(bx + out[0] * d, by + out[1] * d)) return 'exterior';
      return 'room';
    }, faint).filter(o => o.side !== 'none');
    // 専有面積にあたる床の広さ：建物の範囲（外壁を含む）を外壁の厚みの半分だけ内側に縮める（＝壁の中心線で囲んだ面積）。
    // 建物の凹んだ部分（外）は含まない
    const floorPx = count(erode(building, W, H, Math.max(1, Math.round(t / 2)))) / (f * f);
    // ドアの記号：外枠の内側全体から探す（建物の凹みに面した玄関ドアの扇形は建物の外に描かれるため）
    const inBox = new Uint8Array(W * H);
    for (let y = Math.max(0, y0 - t); y <= Math.min(H - 1, y1 + t); y++) for (let x = Math.max(0, x0 - t); x <= Math.min(W - 1, x1 + t); x++) inBox[y * W + x] = 1;
    const arcDoors = findDoorArcs(dark, nearWall, inBox, wall, W, H, t);
    // 引き戸・折れ戸（扇形のドアと同じ所にあるものは除く）
    const gapDoors = findGapDoors(dark, wall, building, lab, W, H, t)
      .filter(d => !arcDoors.some(a => Math.hypot(a.x - d.x, a.y - d.y) < Math.max(a.width, d.width) / 2));
    const doors = [...arcDoors, ...gapDoors].map(d => ({ ...d, x: d.x / f, y: d.y / f, width: d.width / f }));
    plan = {
      x: x0 / f, y: y0 / f, w: (x1 - x0 + 1) / f, h: (y1 - y0 + 1) / f,
      walls,
      openings: scaleOpenings(planOpenings),
      doors,
      floorPx,
      wallThickness: t / f,
    };
  }

  return { width: nw, height: nh, rooms: resultRooms, plan, symbols, paper };
}

export const M2_PER_JO = 1.62;
