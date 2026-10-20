// 間取りの認識結果の確認・修正
// 自動で作ったドア・窓・収納扉、設備、部屋の名前を一覧にし、小さな間取り図の番号と見比べながら
// 種類の変更・名前の変更・削除をまとめて行う。
import { state, commit, activeLayout } from './state.js';
import { modal, toast } from './ui.js';
import { escapeHtml } from './geometry.js';
import { roomSVG, openingEnds, OPENING_LABELS, DOOR_STYLE_LABELS, doorStyle } from './floorplan.js';
import { furnitureLayerSVG } from './render.js';

// ドア・窓・収納扉の「種類」（一覧で選べるもの）
const KINDS = {
  swing: { label: '開き戸', apply: op => { op.type = 'door'; delete op.style; } },
  sliding: { label: '引き戸', apply: op => { op.type = 'door'; op.style = 'sliding'; } },
  folding: { label: '折れ戸', apply: op => { op.type = 'door'; op.style = 'folding'; } },
  closet: { label: '収納扉', apply: op => { op.type = 'closet'; delete op.style; } },
  window: { label: '窓（腰窓）', apply: op => { op.type = 'window'; op.sill = 'high'; delete op.style; } },
  'window-floor': { label: '掃き出し窓', apply: op => { op.type = 'window'; op.sill = 'floor'; delete op.style; } },
};

function kindOf(op) {
  if (op.type === 'door') return doorStyle(op);
  if (op.type === 'closet') return 'closet';
  return op.sill === 'floor' ? 'window-floor' : 'window';
}

/** 種類に合わせた名前（自動で付けた名前なら「（自動）」を残す） */
function nameFor(kind, wasAuto) {
  const base = kind === 'swing' ? OPENING_LABELS.door : kind === 'closet' ? OPENING_LABELS.closet
    : kind === 'window' ? '窓' : kind === 'window-floor' ? '掃き出し窓' : DOOR_STYLE_LABELS[kind];
  return wasAuto ? `${base}（自動）` : base;
}

/** 小さな間取り図（番号付き） */
function mapSVG(p, ops, fixtures) {
  const r = p.room;
  const m = Math.max(r.width, r.depth) * 0.05;
  const W = 420;
  const px = (Math.max(r.width, r.depth) + m * 2) / W;
  const badge = (key, x, y, n, color) => `<g class="rv-badge" data-key="${key}">
      <circle cx="${x}" cy="${y}" r="${11 * px}" fill="${color}" stroke="#fff" stroke-width="${2 * px}"/>
      <text x="${x}" y="${y}" font-size="${11 * px}" fill="#fff" text-anchor="middle" dominant-baseline="central" font-weight="700">${n}</text></g>`;
  let s = `<svg viewBox="${r.x - m} ${r.y - m} ${r.width + m * 2} ${r.depth + m * 2}" class="rv-map" preserveAspectRatio="xMidYMid meet">`;
  s += roomSVG(p, { px, dims: false, interactive: false });
  s += `<g opacity="0.85">${furnitureLayerSVG(fixtures, { labels: false, interactive: false })}</g>`;
  ops.forEach((op, i) => {
    const { a, b, nx, ny } = openingEnds(r, op);
    const off = 14 * px;
    s += badge(`op-${i}`, (a.x + b.x) / 2 + nx * off, (a.y + b.y) / 2 + ny * off, i + 1, op.type === 'window' ? '#3b82c4' : op.type === 'closet' ? '#7a68b8' : '#d07a2a');
  });
  fixtures.forEach((f, i) => { s += badge(`fx-${i}`, f.x, f.y, `設${i + 1}`, '#0f766e'); });
  return s + '</svg>';
}

/**
 * 認識結果の確認・修正のダイアログを開く。
 * 戻り値: 変更を反映したら true
 */
export async function openPlanReview() {
  const p = state.project;
  const ops = p.openings.slice();
  const fixtures = activeLayout().furniture.filter(f => f.autoFixture);
  const areas = (p.areas || []).slice();
  if (!ops.length && !fixtures.length && !areas.length) {
    toast('確認する認識結果がありません（間取り図を読み込んで「間取り全体」で作成すると表示されます）');
    return false;
  }
  const kindOptions = cur => Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label}</option>`).join('');
  const del = key => `<label class="check rv-del" title="削除する"><input type="checkbox" data-del="${key}"> 削除</label>`;
  const opRows = ops.map((op, i) => `<tr data-key="op-${i}">
      <td><span class="rv-num" style="background:${op.type === 'window' ? '#3b82c4' : op.type === 'closet' ? '#7a68b8' : '#d07a2a'}">${i + 1}</span></td>
      <td><select data-kind="${i}">${kindOptions(kindOf(op))}</select></td>
      <td><input type="text" data-name="op-${i}" value="${escapeHtml(op.label || OPENING_LABELS[op.type])}" maxlength="20"></td>
      <td class="muted">${Math.round(op.width)}cm</td>
      <td>${del(`op-${i}`)}</td></tr>`).join('');
  const fxRows = fixtures.map((f, i) => `<tr data-key="fx-${i}">
      <td><span class="rv-num" style="background:#0f766e">設${i + 1}</span></td>
      <td colspan="2">${escapeHtml(f.name)}</td>
      <td class="muted">${Math.round(f.width)}×${Math.round(f.depth)}cm</td>
      <td>${del(`fx-${i}`)}</td></tr>`).join('');
  const areaRows = areas.map((a, i) => `<tr data-key="ar-${i}">
      <td></td>
      <td colspan="2"><input type="text" data-name="ar-${i}" value="${escapeHtml(a.label)}" maxlength="20"></td>
      <td class="muted">${Math.round(a.width)}×${Math.round(a.depth)}cm</td>
      <td>${del(`ar-${i}`)}</td></tr>`).join('');

  const res = await modal({
    title: '認識結果の確認・修正',
    wide: true,
    body: `
      <style>
        .rv-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 14px; align-items: start; }
        @media (max-width: 760px) { .rv-grid { grid-template-columns: 1fr; } }
        .rv-map { width: 100%; height: auto; max-height: 62vh; background: #fafaf8; border: 1px solid var(--line); border-radius: 8px; }
        .rv-badge.on circle { stroke: #111; }
        .rv-badge.on { transform-box: fill-box; transform-origin: center; transform: scale(1.5); }
        .rv-list { max-height: 62vh; overflow: auto; }
        .rv-list table { width: 100%; border-collapse: collapse; }
        .rv-list td { padding: 3px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
        .rv-list tr.on { background: var(--accent-weak); }
        .rv-list tr.deleted td { opacity: 0.45; text-decoration: line-through; }
        .rv-list select, .rv-list input[type=text] { width: 100%; min-width: 0; }
        .rv-num { display: inline-flex; min-width: 22px; height: 22px; padding: 0 4px; border-radius: 11px; color: #fff; font-size: 11px; font-weight: 700; align-items: center; justify-content: center; }
        .rv-list h4 { margin: 10px 0 4px; font-size: 13px; }
        .rv-del { white-space: nowrap; font-size: 12px; }
      </style>
      <p style="margin:0">自動で認識したドア・窓・設備・部屋の一覧です。左の図の番号と見比べて、<strong>種類の変更・名前の変更・削除</strong>をまとめてできます。行にマウスを乗せると図の番号が大きくなります。</p>
      <div class="rv-grid">
        <div>${mapSVG(p, ops, fixtures)}</div>
        <div class="rv-list">
          ${ops.length ? `<h4>ドア・窓・収納扉（${ops.length}）</h4><table>${opRows}</table>` : ''}
          ${fixtures.length ? `<h4>自動で置いた設備（${fixtures.length}）</h4><table>${fxRows}</table>` : ''}
          ${areas.length ? `<h4>部屋の名前（${areas.length}）</h4><table>${areaRows}</table>` : ''}
        </div>
      </div>`,
    buttons: [
      { label: 'キャンセル', value: null },
      { label: '変更を反映', value: 'ok', primary: true },
    ],
    onMount: body => {
      const highlight = (key, on) => {
        body.querySelectorAll(`[data-key="${key}"]`).forEach(el => el.classList.toggle('on', on));
      };
      body.querySelectorAll('.rv-list tr[data-key], .rv-badge').forEach(el => {
        el.addEventListener('mouseenter', () => highlight(el.dataset.key, true));
        el.addEventListener('mouseleave', () => highlight(el.dataset.key, false));
      });
      body.querySelectorAll('[data-del]').forEach(cb => cb.addEventListener('change', () => {
        cb.closest('tr').classList.toggle('deleted', cb.checked);
      }));
      // 種類を変えたら、名前が自動の名前のままなら一緒に変える
      body.querySelectorAll('[data-kind]').forEach(sel => sel.addEventListener('change', () => {
        const i = Number(sel.dataset.kind);
        const input = body.querySelector(`[data-name="op-${i}"]`);
        const wasAuto = /（自動/.test(input.value);
        const autoNames = Object.keys(KINDS).flatMap(k => [nameFor(k, true), nameFor(k, false)]);
        if (autoNames.includes(input.value) || input.value === OPENING_LABELS[ops[i].type]) input.value = nameFor(sel.value, wasAuto);
      }));
    },
    collect: body => ({
      kinds: ops.map((_, i) => body.querySelector(`[data-kind="${i}"]`).value),
      opNames: ops.map((_, i) => body.querySelector(`[data-name="op-${i}"]`).value.trim()),
      areaNames: areas.map((_, i) => body.querySelector(`[data-name="ar-${i}"]`).value.trim()),
      deleted: new Set([...body.querySelectorAll('[data-del]:checked')].map(cb => cb.dataset.del)),
    }),
  });
  if (res.value !== 'ok') return false;

  const { kinds, opNames, areaNames, deleted } = res.data;
  let changed = 0;
  commit(pr => {
    ops.forEach((op, i) => {
      if (deleted.has(`op-${i}`)) return;
      let touched = false;
      if (kinds[i] !== kindOf(op)) { KINDS[kinds[i]].apply(op); touched = true; }
      if (opNames[i] && opNames[i] !== op.label) { op.label = opNames[i]; touched = true; }
      if (touched) changed++;
    });
    const delOps = new Set(ops.filter((_, i) => deleted.has(`op-${i}`)));
    pr.openings = pr.openings.filter(o => !delOps.has(o));
    const delFx = new Set(fixtures.filter((_, i) => deleted.has(`fx-${i}`)).map(f => f.id));
    const layout = pr.layouts.find(l => l.id === pr.activeLayoutId) || pr.layouts[0];
    layout.furniture = layout.furniture.filter(f => !delFx.has(f.id));
    areas.forEach((a, i) => { if (areaNames[i] && areaNames[i] !== a.label) { a.label = areaNames[i]; changed++; } });
    const delAreas = new Set(areas.filter((_, i) => deleted.has(`ar-${i}`)));
    pr.areas = (pr.areas || []).filter(a => !delAreas.has(a));
    changed += deleted.size;
  });
  toast(changed ? `認識結果を${changed}か所修正しました（元に戻すで取り消せます）` : '変更はありませんでした', changed ? 'ok' : '');
  return true;
}
