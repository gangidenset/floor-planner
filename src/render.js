// シーン（背景・部屋・家具）の SVG 文字列生成。キャンバス・サムネイル・PNG書き出しで共通利用。
import { furnitureSVG } from './furniture.js';
import { roomSVG } from './floorplan.js';
import { layerOf } from './data/furniture-library.js';
import { escapeHtml } from './geometry.js';

const LAYER_ORDER = { floor: 0, normal: 1, ceiling: 2 };

export function sortForDrawing(furniture) {
  return furniture
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (LAYER_ORDER[layerOf(a.f)] - LAYER_ORDER[layerOf(b.f)]) || (a.i - b.i))
    .map(o => o.f);
}

export function backgroundSVG(project, { interactive = false } = {}) {
  const bg = project.background;
  const src = bg && project.assets?.[bg.assetId];
  if (!bg || !src || bg.visible === false) return '';
  return `<image ${interactive ? 'class="bg-image"' : ''} href="${src}" x="${bg.x}" y="${bg.y}" width="${bg.width}" height="${bg.height}" opacity="${bg.opacity ?? 0.9}" preserveAspectRatio="none"/>`;
}

export function furnitureLayerSVG(furniture, { validation = null, labels = true, interactive = true, dim = false } = {}) {
  let s = '';
  for (const f of sortForDrawing(furniture)) {
    const lvl = validation?.byItem.get(f.id);
    s += furnitureSVG(f, { labels, interactive, warn: lvl === 'error' || lvl === 'warn' ? lvl : false, dim });
  }
  return s;
}

/** サムネイル用の小さな SVG */
export function thumbnailSVG(project, furniture, { width = 240, height = 160 } = {}) {
  const r = project.room;
  const m = Math.max(r.width, r.depth) * 0.06;
  const vb = `${r.x - m} ${r.y - m} ${r.width + m * 2} ${r.depth + m * 2}`;
  return `<svg viewBox="${vb}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" style="background:#fafaf8">
    ${roomSVG(project, { px: Math.max(r.width, r.depth) / width, dims: false, interactive: false })}
    ${furnitureLayerSVG(furniture, { labels: false, interactive: false })}
  </svg>`;
}

/** PNG 書き出し用の単独 SVG */
export function exportSVG(project, furniture, { showBg = true, dims = true, labels = true, title = '', pxPerCm = 2 } = {}) {
  const r = project.room;
  const margin = 70;
  const x0 = r.x - margin, y0 = r.y - margin - 30;
  const w = r.width + margin * 2, h = r.depth + margin * 2 + 60;
  const px = 1 / pxPerCm * 1.6;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${Math.round(w * pxPerCm)}" height="${Math.round(h * pxPerCm)}" font-family="'Hiragino Sans','Yu Gothic UI','Meiryo',sans-serif">`;
  s += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#ffffff"/>`;
  if (showBg) s += `<g>${backgroundSVG(project)}</g>`;
  s += roomSVG(project, { px, dims, interactive: false });
  s += furnitureLayerSVG(furniture, { labels, interactive: false });
  // 縮尺バー（100cm）
  const bx = r.x, by = r.y + r.depth + margin - 15;
  s += `<g><rect x="${bx}" y="${by}" width="100" height="6" fill="#3d3a37"/><rect x="${bx + 50}" y="${by}" width="50" height="6" fill="#fff" stroke="#3d3a37" stroke-width="1"/>
    <text x="${bx + 108}" y="${by + 6}" font-size="${11 * px}" fill="#3d3a37">100cm</text></g>`;
  if (title) s += `<text x="${r.x}" y="${y0 + 22}" font-size="${15 * px}" fill="#2f2b28" font-weight="600">${escapeHtml(title)}</text>`;
  s += '</svg>';
  return { svg: s, width: Math.round(w * pxPerCm), height: Math.round(h * pxPerCm) };
}
