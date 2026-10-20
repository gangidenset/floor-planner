// 寸法入りの間取り図を印刷・PDF にする
// PNG 書き出しと同じ図に、部屋（区切り）ごとの大きさ・家具の大きさを書き足し、A4 1枚に収めて印刷する。
// PDF にしたいときは、印刷画面の送り先で「PDF に保存」を選ぶ。
import { state, activeLayout, furnitureList } from './state.js';
import { modal, toast } from './ui.js';
import { escapeHtml } from './geometry.js';
import { exportSVG } from './render.js';
import { furnitureListPrintHTML } from './furniture-list.js';
import { layerOf } from './data/furniture-library.js';

const JO = 16200; // 1畳（cm²）

/** 図に書き足す文字：部屋の大きさ、家具の大きさ */
function extraSVG(project, furniture, { areaSizes, furnitureSizes }, px) {
  let s = '';
  const fs = 10.5 * px;
  const text = (x, y, t, size = fs, color = '#6b625a', weight = 400) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" stroke="#fff" stroke-width="${size * 0.3}" paint-order="stroke">${escapeHtml(t)}</text>`;
  if (areaSizes) {
    for (const a of project.areas || []) {
      s += text(a.x + 6 * px, a.y + 28 * px, `${Math.round(a.width)}×${Math.round(a.depth)}cm（約${(a.width * a.depth / JO).toFixed(1)}畳）`);
    }
  }
  if (furnitureSizes) {
    for (const f of furniture) {
      if (layerOf(f) === 'ceiling') continue;
      const t = `${Math.round(f.width)}×${Math.round(f.depth)}`;
      s += `<text x="${f.x}" y="${f.y + 13 * px}" font-size="${fs * 0.9}" text-anchor="middle" fill="#4b4540" stroke="#fff" stroke-width="${fs * 0.27}" paint-order="stroke">${t}</text>`;
    }
  }
  return s;
}

export async function openPrintPlan() {
  const p = state.project;
  const res = await modal({
    title: '印刷・PDF（寸法入りの間取り図）',
    body: `
      <p style="margin:0">今のレイアウトを、寸法入りの間取り図として A4 1枚に印刷します。<strong>PDF にしたいときは、印刷画面の送り先で「PDF に保存」</strong>を選んでください。家族との相談や、引っ越し業者・家具店に見せるときに使えます。</p>
      <label class="field">タイトル<input type="text" id="pp-title" maxlength="60" value="${escapeHtml(`${p.name}（${activeLayout().name}）`)}"></label>
      <label class="check"><input type="checkbox" id="pp-area" checked> 部屋ごとの大きさ（cm・畳）を書く</label>
      <label class="check"><input type="checkbox" id="pp-names" checked> 家具の名前を書く</label>
      <label class="check"><input type="checkbox" id="pp-sizes" checked> 家具の大きさ（幅×奥行き cm）を書く</label>
      <label class="check"><input type="checkbox" id="pp-bg" ${p.background ? '' : 'disabled'}> 下絵の画像（読み込んだ間取り図）も入れる</label>
      <label class="check"><input type="checkbox" id="pp-list"> 2ページ目に家具リスト（値段・搬入チェック付き）を付ける</label>
      <label class="field">用紙の向き
        <select id="pp-orient"><option value="auto">自動（間取りの形に合わせる）</option><option value="landscape">横</option><option value="portrait">縦</option></select></label>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: '印刷する', value: 'ok', primary: true }],
    collect: body => ({
      title: body.querySelector('#pp-title').value.trim(),
      areaSizes: body.querySelector('#pp-area').checked,
      labels: body.querySelector('#pp-names').checked,
      furnitureSizes: body.querySelector('#pp-sizes').checked,
      showBg: body.querySelector('#pp-bg').checked,
      list: body.querySelector('#pp-list').checked,
      orient: body.querySelector('#pp-orient').value,
    }),
  });
  if (res.value !== 'ok') return;
  const o = res.data;
  const furniture = furnitureList();
  const pxPerCm = 2;
  const { svg, width, height } = exportSVG(p, furniture, { showBg: o.showBg, dims: true, labels: o.labels, title: '', pxPerCm });
  const px = (1 / pxPerCm) * 1.6; // exportSVG と同じ文字の大きさの基準
  const full = svg.replace(/<\/svg>\s*$/, `${extraSVG(p, furniture, o, px)}</svg>`)
    .replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%" preserveAspectRatio="xMidYMid meet"');
  const landscape = o.orient === 'landscape' || (o.orient === 'auto' && width >= height);
  const area = (p.room.width * p.room.depth) / 10000;
  const listHTML = o.list ? furnitureListPrintHTML() : '';
  if (o.list && !listHTML) toast('家具がないので、家具リストは付けません');

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(o.title || p.name)}</title>
    <style>
      @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
      body { font-family: 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif; margin: 0; color: #2f2b28; }
      h1 { font-size: 15px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 0 0 6px; }
      .meta { font-size: 11px; color: #6b625a; margin: 0 0 6px; }
      .plan { width: 100%; height: ${landscape ? '170mm' : '255mm'}; }
      .plan svg { width: 100%; height: 100%; }
      .list { page-break-before: always; font-size: 11px; }
      table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; }
      th { background: #eee; } .fl-ng td { background: #fff3e0; } .muted { color: #777; } input { display: none; }
    </style></head><body>
    <h1>${escapeHtml(o.title || p.name)}</h1>
    <p class="meta">${new Date().toLocaleDateString('ja-JP')} 作成・間取り全体 ${Math.round(p.room.width)} × ${Math.round(p.room.depth)} cm（約${area.toFixed(1)}㎡）${p.scale?.status === 'unset' ? '・<strong>縮尺が未設定のため寸法は目安です</strong>' : ''}・家具 ${furniture.length}点</p>
    <div class="plan">${full}</div>
    ${listHTML ? `<div class="list">${listHTML}</div>` : ''}
    </body></html>`);
  doc.close();
  // 画像（下絵）の読み込みを待ってから印刷する
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 2000);
  }, 300);
}
