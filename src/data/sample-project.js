// サンプルプロジェクト（寸法・ドア・窓の位置はすべて架空のサンプルです）
import { getSpec } from './furniture-library.js';
import { createItem } from '../furniture.js';
import { uid } from '../geometry.js';

export const PROJECT_VERSION = 1;

function item(type, x, y, rotation = 0, extra = {}) {
  return createItem(getSpec(type), { id: uid(type), x, y, rotation, ...extra });
}

/** サンプル用の背景画像（1px = 1cm で描いた簡易間取り図 SVG） */
function sampleFloorplanImage() {
  const W = 780, H = 560, ox = 30, oy = 80; // 部屋の左上が (ox, oy)
  const rw = 720, rd = 450, t = 12;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="${ox + 300}" y="10" width="420" height="${oy - t - 10}" fill="#f1f1ef" stroke="#c9c9c4"/>
  <text x="${ox + 510}" y="${oy / 2 + 6}" font-size="16" text-anchor="middle" fill="#9a9a95" font-family="sans-serif">バルコニー（サンプル）</text>
  <rect x="${ox - t}" y="${oy - t}" width="${rw + t * 2}" height="${rd + t * 2}" fill="none" stroke="#555" stroke-width="${t}" />
  <rect x="${ox + 380}" y="${oy - t - 1}" width="260" height="${t + 2}" fill="#fff"/>
  <line x1="${ox + 380}" y1="${oy - t / 2}" x2="${ox + 640}" y2="${oy - t / 2}" stroke="#777" stroke-width="2"/>
  <rect x="${ox + rw - 1}" y="${oy + 40}" width="${t + 2}" height="120" fill="#fff"/>
  <line x1="${ox + rw + t / 2}" y1="${oy + 40}" x2="${ox + rw + t / 2}" y2="${oy + 160}" stroke="#777" stroke-width="2"/>
  <rect x="${ox + 40}" y="${oy + rd - 1}" width="80" height="${t + 2}" fill="#fff"/>
  <rect x="${ox + 560}" y="${oy + rd - 1}" width="120" height="${t + 2}" fill="#fff"/>
  <text x="${ox + 360}" y="${oy + rd / 2 + 8}" font-size="26" text-anchor="middle" fill="#d4d4cf" font-family="sans-serif">LDK 約19.6畳（サンプル）</text>
  <text x="${ox + 80}" y="${H - 10}" font-size="13" text-anchor="middle" fill="#9a9a95" font-family="sans-serif">廊下へ</text>
  <text x="${ox + 620}" y="${H - 10}" font-size="13" text-anchor="middle" fill="#9a9a95" font-family="sans-serif">収納</text>
</svg>`;
  return { dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), W, H, ox, oy };
}

export function createSampleProject() {
  const img = sampleFloorplanImage();
  const assetId = 'asset-sample-floorplan';
  const furniture = [
    item('kitchen', 35, 230, 270, { locked: true }),
    item('fridge', 37, 45, 270, { locked: true }),
    item('table-4', 250, 225, 0),
    item('chair', 215, 168, 0),
    item('chair', 285, 168, 0),
    item('chair', 215, 282, 180),
    item('chair', 285, 282, 180),
    item('pendant', 250, 225, 0),
    item('shelf', 260, 432, 180),
    item('rug', 570, 300, 90),
    item('sofa-3', 435, 300, 270),
    item('center-table', 560, 300, 90),
    item('tv-board', 700, 300, 90),
    item('tv', 703, 300, 90),
    item('plant-l', 690, 190, 0),
    item('floor-lamp', 435, 172, 0),
  ];
  const layoutId = uid('layout');
  return {
    version: PROJECT_VERSION,
    id: uid('project'),
    name: 'サンプル LDK',
    isSample: true,
    room: { x: 0, y: 0, width: 720, depth: 450, label: 'LDK（サンプル）' },
    openings: [
      { id: uid('op'), type: 'door', wall: 'bottom', offset: 40, width: 80, hinge: 'start', label: '入口ドア' },
      { id: uid('op'), type: 'window', wall: 'top', offset: 380, width: 260, sill: 'floor', label: '掃き出し窓' },
      { id: uid('op'), type: 'window', wall: 'right', offset: 40, width: 120, sill: 'high', label: '腰窓' },
      { id: uid('op'), type: 'closet', wall: 'bottom', offset: 560, width: 120, label: '収納扉' },
    ],
    background: {
      assetId,
      x: -img.ox, y: -img.oy,
      width: img.W, height: img.H,
      naturalWidth: img.W, naturalHeight: img.H,
      opacity: 0.9, visible: true,
    },
    walls: [],
    areas: [],
    scale: { status: 'sample', cmPerPx: 1 },
    layouts: [{ id: layoutId, name: 'レイアウト1', furniture }],
    activeLayoutId: layoutId,
    assets: { [assetId]: img.dataUrl },
  };
}

export function createEmptyProject() {
  const layoutId = uid('layout');
  return {
    version: PROJECT_VERSION,
    id: uid('project'),
    name: '新しいプロジェクト',
    isSample: false,
    room: { x: 0, y: 0, width: 600, depth: 450, label: '部屋' },
    openings: [],
    walls: [],
    areas: [],
    background: null,
    scale: { status: 'unset', cmPerPx: null },
    layouts: [{ id: layoutId, name: 'レイアウト1', furniture: [] }],
    activeLayoutId: layoutId,
    assets: {},
  };
}
