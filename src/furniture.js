// 家具コンポーネント（上から見た形状を SVG 文字列で生成）
// 形状はローカル座標（中心が原点、幅 w × 奥行き d、正面 = +y）で描く。
import { getSpec } from './data/furniture-library.js';
import { escapeHtml, clamp } from './geometry.js';

const NS = 'vector-effect="non-scaling-stroke"';
const LINE = '#5b5550';

export function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || '#999';
  const n = parseInt(m[1], 16);
  const f = v => clamp(Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)), 0, 255);
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// extra で stroke を指定した場合は既定の stroke を付けない（XMLとして正しい属性にする）
function strokeAttr(extra) {
  return /(^|\s)stroke="/.test(extra) ? '' : `stroke="${LINE}"`;
}
function rect(x, y, w, h, fill, rx = 0, extra = '') {
  return `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" rx="${rx}" fill="${fill}" ${strokeAttr(extra)} stroke-width="1" ${NS} ${extra}/>`;
}
function line(x1, y1, x2, y2, stroke = LINE, width = 0.8, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${NS} ${extra}/>`;
}
function ellipse(cx, cy, rx, ry, fill, extra = '') {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(0, rx)}" ry="${Math.max(0, ry)}" fill="${fill}" ${strokeAttr(extra)} stroke-width="1" ${NS} ${extra}/>`;
}

const SHAPES = {
  sofa(w, d, c, spec) {
    const arm = Math.min(w * 0.11, 20), back = Math.min(d * 0.24, 22);
    let s = rect(-w / 2, -d / 2, w, d, shade(c, -0.08), 6);
    s += rect(-w / 2, -d / 2, w, back, shade(c, -0.18), 5);
    s += rect(-w / 2, -d / 2, arm, d, shade(c, -0.14), 5);
    s += rect(w / 2 - arm, -d / 2, arm, d, shade(c, -0.14), 5);
    const seats = clamp(Math.round((w - arm * 2) / 65), 1, 4);
    const sw = (w - arm * 2) / seats;
    for (let i = 0; i < seats; i++) {
      s += rect(-w / 2 + arm + i * sw + 1, -d / 2 + back + 1, sw - 2, d - back - 3, shade(c, 0.12), 4);
    }
    return s;
  },
  armchair(w, d, c) {
    return SHAPES.sofa(w, d, c);
  },
  'sofa-l'(w, d, c) {
    const back = 20, arm = 18, seatD = Math.min(90, d * 0.62), chaise = Math.min(85, w * 0.38);
    const top = -d / 2;
    const path = `M${-w / 2},${top} H${w / 2} V${d / 2} H${w / 2 - chaise} V${top + seatD} H${-w / 2} Z`;
    let s = `<path d="${path}" fill="${shade(c, -0.08)}" stroke="${LINE}" stroke-width="1" ${NS}/>`;
    s += rect(-w / 2, top, w, back, shade(c, -0.18), 4);
    s += rect(-w / 2, top, arm, seatD, shade(c, -0.14), 4);
    s += rect(w / 2 - arm, top, arm, d, shade(c, -0.14), 4);
    const seatW = (w - arm * 2 - chaise) + 0;
    const n = clamp(Math.round(seatW / 65), 1, 3);
    const sw = seatW / n;
    for (let i = 0; i < n; i++) s += rect(-w / 2 + arm + i * sw + 1, top + back + 1, sw - 2, seatD - back - 3, shade(c, 0.12), 4);
    s += rect(w / 2 - chaise + 1, top + back + 1, chaise - arm - 2, d - back - 3, shade(c, 0.12), 4);
    return s;
  },
  tvboard(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 2);
    s += rect(-w / 2 + 3, -d / 2 + 3, w - 6, d - 6, shade(c, 0.1), 1);
    const n = clamp(Math.round(w / 50), 2, 5);
    for (let i = 1; i < n; i++) s += line(-w / 2 + (w * i) / n, -d / 2 + 3, -w / 2 + (w * i) / n, d / 2 - 3, shade(c, -0.3), 0.6);
    s += line(-w / 2, d / 2 - 1, w / 2, d / 2 - 1, shade(c, -0.4), 1.5);
    return s;
  },
  tv(w, d, c) {
    const screen = Math.min(8, d * 0.4);
    let s = `<path d="M${-w * 0.18},${-d / 2 + screen} L${w * 0.18},${-d / 2 + screen} L${w * 0.25},${d / 2} L${-w * 0.25},${d / 2} Z" fill="${shade(c, 0.35)}" stroke="${LINE}" stroke-width="1" ${NS}/>`;
    s += rect(-w / 2, -d / 2, w, screen, c, 1.5);
    s += line(-w / 2 + 3, -d / 2 + screen - 1, w / 2 - 3, -d / 2 + screen - 1, '#8fb3d9', 1.2);
    return s;
  },
  table(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 3);
    s += rect(-w / 2 + 4, -d / 2 + 4, w - 8, d - 8, shade(c, 0.08), 2, 'stroke-opacity="0.35"');
    s += line(-w / 2 + 10, -d * 0.12, w / 2 - 14, -d * 0.12, shade(c, -0.25), 0.5, 'stroke-opacity="0.5"');
    s += line(-w / 2 + 16, d * 0.14, w / 2 - 10, d * 0.14, shade(c, -0.25), 0.5, 'stroke-opacity="0.5"');
    return s;
  },
  'table-round'(w, d, c) {
    return ellipse(0, 0, w / 2, d / 2, c) + ellipse(0, 0, w / 2 - 5, d / 2 - 5, shade(c, 0.08), 'stroke-opacity="0.35"');
  },
  'coffee-table'(w, d, c) {
    return rect(-w / 2, -d / 2, w, d, c, Math.min(w, d) * 0.15) + rect(-w / 2 + 5, -d / 2 + 5, w - 10, d - 10, shade(c, 0.12), Math.min(w, d) * 0.1, 'stroke-opacity="0.35"');
  },
  'side-table'(w, d, c) {
    return ellipse(0, 0, w / 2, d / 2, c) + ellipse(0, 0, w / 2 - 4, d / 2 - 4, shade(c, 0.12), 'stroke-opacity="0.35"');
  },
  // ビーズクッション：角の丸いやわらかい形に、生地の縫い目
  beanbag(w, d, c) {
    const r = Math.min(w, d) * 0.42;
    let s = rect(-w / 2, -d / 2, w, d, c, r);
    s += rect(-w / 2 + 5, -d / 2 + 5, w - 10, d - 10, shade(c, 0.12), r * 0.8, 'stroke-opacity="0.25"');
    if (w > d * 1.4) {
      for (const t of [-0.25, 0.25]) s += line(w * t, -d / 2 + 6, w * t, d / 2 - 6, shade(c, -0.2), 0.6, 'stroke-opacity="0.5"');
    } else {
      s += ellipse(0, 0, w * 0.18, d * 0.18, shade(c, -0.06), 'stroke-opacity="0.3"');
    }
    return s;
  },
  // ロボット掃除機：丸い本体、前側（+y）にバンパー、上に操作ボタン
  'robot-vacuum'(w, d, c) {
    const r = Math.min(w, d) / 2;
    let s = ellipse(0, 0, w / 2, d / 2, c);
    s += `<path d="M${-r * 0.92},${r * 0.25} A${r * 0.95},${r * 0.95} 0 0 0 ${r * 0.92},${r * 0.25}" fill="none" stroke="${shade(c, 0.45)}" stroke-width="1.4" ${NS}/>`;
    s += ellipse(0, -r * 0.15, r * 0.28, r * 0.28, shade(c, 0.3));
    return s;
  },
  // 充電台：背面（-y）を壁に付ける。前に端子
  'robot-dock'(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 4);
    s += rect(-w * 0.3, d / 2 - 5, w * 0.6, 4, shade(c, 0.5), 1);
    return s;
  },
  // ベッドセット：枕元（奥 = -y）の横にナイトテーブル。1台なら右側、2台なら両側
  'bed-set'(w, d, c, spec) {
    const n = spec?.nightstands || 1, nsW = 40, nsD = 35, gap = 3;
    const bw = Math.max(60, w - n * (nsW + gap));
    const bedX = n === 1 ? -w / 2 + bw / 2 : 0;
    const nsY = -d / 2 + nsD / 2 + 2;
    const nsColor = spec?.nightstandColor || '#B99B7C';
    let s = `<g transform="translate(${bedX} 0)">${SHAPES.bed(bw, d, c)}</g>`;
    const xs = n === 1 ? [bedX + bw / 2 + gap + nsW / 2] : [-bw / 2 - gap - nsW / 2, bw / 2 + gap + nsW / 2];
    for (const x of xs) s += `<g transform="translate(${x} ${nsY})">${SHAPES.chest(nsW, nsD, nsColor)}</g>`;
    return s;
  },
  // リビングセット：外形（w × d）の奥にソファ、手前にセンターテーブル（大きさを変えてもソファとテーブルの奥行きは保つ）
  'living-set'(w, d, c, spec) {
    const sd = Math.min(spec?.sofaDepth || 85, d * 0.55);
    const td = Math.min(spec?.tableDepth || 50, Math.max(20, d - sd - 20));
    const tw = Math.min(spec?.tableWidth || 100, w * 0.75);
    let s = `<g transform="translate(0 ${-d / 2 + sd / 2})">${SHAPES.sofa(w, sd, c, spec)}</g>`;
    s += `<g transform="translate(0 ${d / 2 - td / 2})">${SHAPES['coffee-table'](tw, td, spec?.tableColor || '#C9A77C')}</g>`;
    return s;
  },
  // ダイニングセット：外形（w × d）の中に、テーブルと人数分の椅子を描く。椅子は奥行き 50cm、テーブルの下に 8cm 入る
  'dining-set'(w, d, c, spec) {
    const cw = 45, cd = 50, out = cd - 8;
    const td = Math.max(30, d - out * 2);
    const perSide = Math.max(1, Math.round((spec?.seats || 4) / 2));
    let s = '';
    for (let i = 0; i < perSide; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / perSide;
      for (const [y, rot] of [[d / 2 - cd / 2, 180], [-d / 2 + cd / 2, 0]]) {
        s += `<g transform="translate(${x} ${y}) rotate(${rot})">${SHAPES.chair(cw, cd, shade(c, -0.12))}</g>`;
      }
    }
    return s + SHAPES.table(w, td, c);
  },
  'dining-set-round'(w, d, c, spec) {
    const cw = 45, cd = 50, out = cd - 8;
    const tw = Math.max(30, w - out * 2), tdd = Math.max(30, d - out * 2);
    const n = spec?.seats || 4;
    let s = '';
    for (let k = 0; k < n; k++) {
      const a = (k * 360) / n;
      const r = (Math.min(w, d) - cd) / 2;
      const p = { x: -Math.sin((a * Math.PI) / 180) * r, y: Math.cos((a * Math.PI) / 180) * r };
      s += `<g transform="translate(${p.x} ${p.y}) rotate(${a + 180})">${SHAPES.chair(cw, cd, shade(c, -0.12))}</g>`;
    }
    return s + SHAPES['table-round'](tw, tdd, c);
  },
  chair(w, d, c) {
    const back = Math.min(8, d * 0.18);
    let s = rect(-w / 2, -d / 2 + back - 1, w, d - back + 1, shade(c, 0.15), 5);
    s += rect(-w / 2, -d / 2, w, back, shade(c, -0.2), 3);
    return s;
  },
  bench(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 3);
    s += line(-w / 2 + 3, 0, w / 2 - 3, 0, shade(c, -0.3), 0.6);
    return s;
  },
  bed(w, d, c) {
    const frame = 4;
    let s = rect(-w / 2, -d / 2, w, d, '#B59A7E', 3);
    s += rect(-w / 2 + frame, -d / 2 + 8, w - frame * 2, d - 8 - frame, '#FBFAF7', 3);
    s += rect(-w / 2, -d / 2, w, 8, '#8E745C', 2);
    const pillows = w >= 115 ? 2 : 1;
    const pw = (w - frame * 2 - 10) / pillows;
    for (let i = 0; i < pillows; i++) s += rect(-w / 2 + frame + 5 + i * pw + 2, -d / 2 + 13, pw - 4, 28, '#FFFFFF', 8);
    s += rect(-w / 2 + frame, -d / 2 + 50, w - frame * 2, d - 50 - frame, c, 4);
    s += rect(-w / 2 + frame, -d / 2 + 50, w - frame * 2, 18, shade(c, 0.35), 4);
    return s;
  },
  desk(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 2);
    s += rect(-w * 0.22, -d / 2 + 5, w * 0.44, 5, '#33373d', 1);
    s += rect(-w * 0.17, d * 0.05, w * 0.34, d * 0.18, shade(c, 0.35), 1, 'stroke-opacity="0.5"');
    return s;
  },
  'desk-chair'(w, d, c) {
    const r = Math.min(w, d) / 2;
    let s = '';
    for (let i = 0; i < 5; i++) {
      const a = (i * 72 + 90) * Math.PI / 180;
      s += line(0, 0, Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, '#888', 0.8);
    }
    s += ellipse(0, d * 0.06, r * 0.72, r * 0.68, shade(c, 0.2));
    s += `<path d="M${-r * 0.75},${-d * 0.18} Q0,${-d / 2 - 4} ${r * 0.75},${-d * 0.18}" fill="none" stroke="${shade(c, -0.2)}" stroke-width="3" ${NS} stroke-linecap="round"/>`;
    return s;
  },
  shelf(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 1);
    const n = Math.max(1, Math.round(w / 40));
    for (let i = 1; i < n; i++) s += line(-w / 2 + (w * i) / n, -d / 2, -w / 2 + (w * i) / n, d / 2, shade(c, -0.3), 0.6);
    s += line(-w / 2, d / 2 - 1.5, w / 2, d / 2 - 1.5, shade(c, -0.45), 1.5);
    s += `<path d="M${-w / 2},${-d / 2} L${w / 2},${d / 2} M${w / 2},${-d / 2} L${-w / 2},${d / 2}" stroke="${shade(c, -0.3)}" stroke-width="0.4" ${NS} stroke-opacity="0.45"/>`;
    return s;
  },
  wardrobe(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 1);
    s += line(0, -d / 2, 0, d / 2, shade(c, -0.35), 0.7);
    s += line(-4, d / 2 - 3, -4, d / 2 - 10, '#555', 1.2) + line(4, d / 2 - 3, 4, d / 2 - 10, '#555', 1.2);
    s += line(-w / 2, d / 2 - 1.5, w / 2, d / 2 - 1.5, shade(c, -0.45), 1.5);
    return s;
  },
  chest(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 2);
    s += rect(-w / 2 + 3, -d / 2 + 3, w - 6, d - 6, shade(c, 0.12), 1, 'stroke-opacity="0.4"');
    s += line(-w * 0.15, d / 2 - 2.5, w * 0.15, d / 2 - 2.5, '#555', 1.5);
    return s;
  },
  rug(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 2, 'fill-opacity="0.9"');
    s += rect(-w / 2 + 10, -d / 2 + 10, w - 20, d - 20, 'none', 1, `stroke-dasharray="4 3" stroke="${shade(c, -0.3)}"`);
    for (let y = -d / 2 + 6; y < d / 2 - 4; y += 8) {
      s += line(-w / 2 - 4, y, -w / 2, y, shade(c, -0.25), 0.5) + line(w / 2, y, w / 2 + 4, y, shade(c, -0.25), 0.5);
    }
    return s;
  },
  'rug-round'(w, d, c) {
    return ellipse(0, 0, w / 2, d / 2, c, 'fill-opacity="0.9"') + ellipse(0, 0, w / 2 - 12, d / 2 - 12, 'none', `stroke-dasharray="4 3" stroke="${shade(c, -0.3)}"`);
  },
  'floor-lamp'(w, d, c) {
    return ellipse(0, 0, w / 2, d / 2, c, 'fill-opacity="0.85"') + ellipse(0, 0, w / 2 - 6, d / 2 - 6, shade(c, 0.4)) + ellipse(0, 0, 3, 3, '#555');
  },
  pendant(w, d, c) {
    let s = ellipse(0, 0, w / 2, d / 2, c, 'fill-opacity="0.55" stroke-dasharray="3 2"');
    for (let i = 0; i < 8; i++) {
      const a = (i * 45) * Math.PI / 180;
      s += line(Math.cos(a) * w * 0.3, Math.sin(a) * d * 0.3, Math.cos(a) * w * 0.45, Math.sin(a) * d * 0.45, shade(c, -0.4), 0.6);
    }
    return s + ellipse(0, 0, 2.5, 2.5, '#555');
  },
  plant(w, d, c) {
    let s = ellipse(0, 0, w * 0.3, d * 0.3, '#C9B49A');
    const leaves = 7;
    for (let i = 0; i < leaves; i++) {
      const a = (i * 360) / leaves + 15;
      s += `<ellipse cx="0" cy="${-d * 0.27}" rx="${w * 0.13}" ry="${d * 0.23}" transform="rotate(${a})" fill="${i % 2 ? c : shade(c, 0.18)}" stroke="${shade(c, -0.35)}" stroke-width="0.7" ${NS}/>`;
    }
    return s + ellipse(0, 0, w * 0.08, d * 0.08, shade(c, -0.3));
  },
  kitchen(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 1);
    s += rect(-w / 2 + w * 0.12, -d / 2 + d * 0.18, w * 0.26, d * 0.58, '#d5dade', 6);
    const sx = w / 2 - w * 0.22;
    s += ellipse(sx - 14, -d * 0.08, 8, 8, 'none') + ellipse(sx + 14, -d * 0.08, 8, 8, 'none') + ellipse(sx, d * 0.2, 6, 6, 'none');
    s += line(-w / 2, d / 2 - 1.5, w / 2, d / 2 - 1.5, '#888', 1.5);
    return s;
  },
  'kitchen-face'(w, d, c) {
    // 奥（-y）が作業側のカウンター、手前（+y）にダイニング側の立ち上がり
    const bar = Math.min(25, d * 0.28);
    let s = rect(-w / 2, -d / 2, w, d, c, 1);
    s += rect(-w / 2, d / 2 - bar, w, bar, shade(c, -0.12), 1);
    s += rect(-w / 2 + w * 0.1, -d / 2 + d * 0.12, w * 0.26, (d - bar) * 0.6, '#d5dade', 6);
    const sx = w / 2 - w * 0.2, cy = -d / 2 + (d - bar) * 0.42;
    s += ellipse(sx - 14, cy - 8, 8, 8, 'none') + ellipse(sx + 14, cy - 8, 8, 8, 'none') + ellipse(sx, cy + 14, 6, 6, 'none');
    return s;
  },
  'kitchen-l'(w, d, c) {
    // 奥の辺（上）と左の辺に沿った L 字のカウンター（奥行き 65cm）
    const t = Math.min(65, w * 0.45, d * 0.45);
    const path = `M${-w / 2},${-d / 2} H${w / 2} V${-d / 2 + t} H${-w / 2 + t} V${d / 2} H${-w / 2} Z`;
    let s = `<path d="${path}" fill="${c}" stroke="${LINE}" stroke-width="1" ${NS}/>`;
    s += rect(w / 2 - w * 0.36, -d / 2 + t * 0.18, w * 0.26, t * 0.62, '#d5dade', 6);
    const cx = -w / 2 + t / 2, cy = d / 2 - (d - t) * 0.45;
    s += ellipse(cx, cy - 15, 8, 8, 'none') + ellipse(cx, cy + 15, 8, 8, 'none') + ellipse(cx - 2, cy, 6, 6, 'none');
    s += line(-w / 2 + t, -d / 2 + t, -w / 2 + t, d / 2, '#888', 1.2) + line(-w / 2 + t, -d / 2 + t, w / 2, -d / 2 + t, '#888', 1.2);
    return s;
  },
  'kitchen-island'(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 2);
    s += rect(-w / 2 + 4, -d / 2 + 4, w - 8, d - 8, shade(c, 0.15), 1, 'stroke-opacity="0.4"');
    s += line(-w / 2 + 4, 0, w / 2 - 4, 0, shade(c, -0.25), 0.6, 'stroke-dasharray="3 2"');
    return s;
  },
  toilet(w, d, c) {
    // 奥（-y）にタンク、手前に便器
    const tank = Math.min(20, d * 0.3);
    let s = rect(-w / 2, -d / 2, w, tank, shade(c, -0.06), 3);
    s += ellipse(0, -d / 2 + tank + (d - tank) * 0.48, w * 0.44, (d - tank) * 0.5, c);
    s += ellipse(0, -d / 2 + tank + (d - tank) * 0.52, w * 0.28, (d - tank) * 0.33, '#dfe8ee');
    return s;
  },
  bathtub(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, '#ffffff', 6);
    s += rect(-w / 2 + 6, -d / 2 + 6, w - 12, d - 12, c, Math.min(w, d) * 0.3);
    s += ellipse(-w / 2 + 18, 0, 3, 3, '#9aa4ab');
    return s;
  },
  'unit-bath'(w, d, c) {
    // 奥に浴槽、手前に洗い場（タイル目地）
    const tubD = d * 0.45;
    let s = rect(-w / 2, -d / 2, w, d, c, 3);
    s += rect(-w / 2 + 4, -d / 2 + 4, w - 8, tubD, '#ffffff', 6);
    s += rect(-w / 2 + 10, -d / 2 + 10, w - 20, tubD - 12, '#d7e8f0', Math.min(w, tubD) * 0.25);
    const top = -d / 2 + tubD + 8;
    for (let y = top + 18; y < d / 2 - 4; y += 18) s += line(-w / 2 + 4, y, w / 2 - 4, y, '#c7d3da', 0.5);
    for (let x = -w / 2 + 20; x < w / 2 - 4; x += 20) s += line(x, top, x, d / 2 - 4, '#c7d3da', 0.5);
    s += ellipse(0, (top + d / 2) / 2, 3.5, 3.5, '#9aa4ab');
    return s;
  },
  washbasin(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 3);
    s += rect(-w / 2, -d / 2, w, 6, '#cfd8de', 1);
    s += ellipse(0, d * 0.05, w * 0.3, d * 0.27, '#e1e9ee');
    s += ellipse(0, -d * 0.18, 2.5, 2.5, '#8a949b');
    return s;
  },
  washer(w, d, c) {
    // 防水パン（外枠）＋ 洗濯機
    let s = rect(-w / 2, -d / 2, w, d, '#dfe4e7', 4);
    const m = 4;
    s += rect(-w / 2 + m, -d / 2 + m, w - m * 2, d - m * 2, c, 4);
    s += rect(-w / 2 + m, -d / 2 + m, w - m * 2, (d - m * 2) * 0.16, shade(c, -0.08), 2);
    s += ellipse(0, d * 0.08, (w - m * 2) * 0.32, (d - m * 2) * 0.32, '#cfd9df');
    s += ellipse(0, d * 0.08, (w - m * 2) * 0.2, (d - m * 2) * 0.2, '#e8eef1');
    return s;
  },
  wic(w, d, c) {
    // 3方の壁にハンガーパイプ（手前 +y が入口）
    const t = 4, rail = 45;
    let s = rect(-w / 2, -d / 2, w, d, c, 1, 'fill-opacity="0.75"');
    s += `<path d="M${-w / 2},${d / 2} V${-d / 2} H${w / 2} V${d / 2}" fill="none" stroke="${shade(c, -0.45)}" stroke-width="${t}" ${NS}/>`;
    const hang = (x1, y1, x2, y2, nx, ny) => {
      let r = line(x1, y1, x2, y2, '#7d7f82', 1.2);
      const len = Math.hypot(x2 - x1, y2 - y1), n = Math.floor(len / 8);
      for (let i = 1; i < n; i++) {
        const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
        r += line(x - nx * 14, y - ny * 14, x + nx * 14, y + ny * 14, shade(c, -0.25), 0.6);
      }
      return r;
    };
    s += hang(-w / 2 + rail / 2, -d / 2 + rail, -w / 2 + rail / 2, d / 2 - 10, 1, 0);
    s += hang(w / 2 - rail / 2, -d / 2 + rail, w / 2 - rail / 2, d / 2 - 10, 1, 0);
    s += hang(-w / 2 + rail, -d / 2 + rail / 2, w / 2 - rail, -d / 2 + rail / 2, 0, 1);
    return s;
  },
  'hanger-rack'(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, 'none', 2, `stroke="${shade(c, -0.2)}"`);
    s += line(-w / 2 + 4, 0, w / 2 - 4, 0, '#6c7074', 1.6);
    for (let x = -w / 2 + 10; x < w / 2 - 6; x += 9) s += line(x, -d * 0.32, x, d * 0.32, shade(c, 0.1), 0.6);
    return s;
  },
  fridge(w, d, c) {
    let s = rect(-w / 2, -d / 2, w, d, c, 3);
    s += line(-w / 2 + 2, d / 2 - 4, w / 2 - 2, d / 2 - 4, '#999', 0.8);
    s += line(w / 2 - 8, d / 2 - 1, w / 2 - 8, d / 2 - 7, '#666', 1.5);
    return s;
  },
};

/** 形状のみ（ローカル座標） */
export function shapeSVG(item) {
  const spec = getSpec(item.type);
  const fn = SHAPES[spec.shape] || SHAPES.chest;
  return fn(item.width, item.depth, item.color || spec.color, spec);
}

/**
 * 家具1つ分の SVG。opts.warn: 'error'（重要・赤）| 'warn'（注意・オレンジ）| false
 */
export function furnitureSVG(item, opts = {}) {
  const { labels = true, interactive = true, warn = false, dim = false } = opts;
  const attrs = interactive ? `data-id="${item.id}" class="furniture${item.locked ? ' locked' : ''}"` : '';
  let s = `<g ${attrs} ${dim ? 'opacity="0.35"' : ''}>`;
  s += `<g transform="translate(${item.x} ${item.y}) rotate(${item.rotation || 0})">`;
  // 左右反転（ベッドセットのナイトテーブルの側、L字ソファの向きなど）。外形は左右対称なので位置や当たり判定は変わらない
  s += item.mirror ? `<g transform="scale(-1 1)">${shapeSVG(item)}</g>` : shapeSVG(item);
  if (warn) {
    // 重要（重なり・はみ出し・ドアの開閉範囲など）は赤、注意（使うスペースが少し足りないなど）はオレンジ
    const [fill, stroke] = warn === 'warn' ? ['rgba(217,119,6,0.08)', '#d97706'] : ['rgba(220,60,50,0.10)', '#d93a2f'];
    s += `<rect x="${-item.width / 2 - 2}" y="${-item.depth / 2 - 2}" width="${item.width + 4}" height="${item.depth + 4}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="5 3" ${NS}/>`;
  }
  s += `</g>`;
  if (labels) {
    const fs = clamp(Math.min(item.width, item.depth) * 0.17, 6, 13);
    // 天井照明は下の家具の名前と重なるためラベルを省略
    if (Math.max(item.width, item.depth) > 35 && getSpec(item.type).layer !== 'ceiling') {
      s += `<text x="${item.x}" y="${item.y}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" class="f-label" fill="#2f2b28" stroke="rgba(255,255,255,0.85)" stroke-width="${fs * 0.22}" paint-order="stroke" style="pointer-events:none">${escapeHtml(item.name)}</text>`;
    }
  }
  s += `</g>`;
  return s;
}

/** ライブラリ用のプレビュー SVG */
export function previewSVG(spec, px = 56) {
  const item = { type: spec.type, width: spec.width, depth: spec.depth, color: spec.color, rotation: 0 };
  const m = Math.max(spec.width, spec.depth) * 0.12 + 4;
  const vb = `${-spec.width / 2 - m} ${-spec.depth / 2 - m} ${spec.width + m * 2} ${spec.depth + m * 2}`;
  return `<svg viewBox="${vb}" width="${px}" height="${px}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${shapeSVG(item)}</svg>`;
}

/** ライブラリ定義から家具インスタンスを作る */
export function createItem(spec, overrides = {}) {
  return {
    id: overrides.id || `${spec.type}-${Math.random().toString(36).slice(2, 8)}`,
    type: spec.type,
    name: spec.name,
    category: spec.category,
    x: 0, y: 0,
    width: spec.width, depth: spec.depth, height: spec.height,
    rotation: 0,
    color: spec.color,
    locked: false,
    // マイ家具は定義を家具に持たせておく（ライブラリから消しても、保存した間取りで形が分かるように）
    ...(spec.custom ? { customSpec: { ...spec } } : {}),
    ...(spec.price ? { price: spec.price } : {}), // マイ家具に登録した値段
    ...overrides,
  };
}
