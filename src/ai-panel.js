// AI提案パネル：条件入力 → 3案生成 → プレビュー → 適用
import { state, emit, commit, furnitureList } from './state.js';
import { LIBRARY, CATEGORIES, groupOf } from './data/furniture-library.js';
import { TASTES, PURPOSES } from './ai-demo.js';
import { requestProposals, checkAIStatus } from './ai-layout.js';
import { validateLayout, issueSummary } from './layout-validator.js';
import { thumbnailSVG } from './render.js';
import { escapeHtml } from './geometry.js';
import { previewProposal, cancelPreview, applyProposal } from './actions.js';
import { modal, toast } from './ui.js';

const PRIORITIES = [
  ['flow', '生活動線重視'], ['open', '開放感重視'], ['storage', '収納重視'], ['design', 'デザイン重視'], ['relax', 'くつろぎ重視'],
];

let el;
let loading = false;
let aiStatus = { ai: false };
let lastResult = null;
let lastKey = null;

export function defaultConditions(project) {
  const hasBed = project.layouts.some(l => l.furniture.some(f => groupOf(f) === 'bed'));
  return {
    purpose: hasBed ? 'bedroom' : 'ldk',
    people: 2,
    taste: 'natural',
    favoriteColor: '#7E95B8',
    useFavorite: false,
    excluded: [],
    wanted: [],
    priorities: { flow: true, open: false, storage: false, design: false, relax: false },
    adjustChairs: true,
  };
}

function cond() {
  const p = state.project;
  if (!p.aiConditions) p.aiConditions = defaultConditions(p);
  return p.aiConditions;
}

export async function initAIPanel(container) {
  el = container;
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  aiStatus = await checkAIStatus();
  lastKey = null;
  renderAIPanel(true);
}

function onChange(e) {
  const t = e.target;
  const c = cond();
  const k = t.dataset.c;
  if (!k) return;
  if (k === 'purpose' || k === 'taste' || k === 'areaId') c[k] = t.value;
  else if (k === 'people') c.people = Math.max(1, Math.min(8, Number(t.value) || 1));
  else if (k === 'favoriteColor') { c.favoriteColor = t.value; c.useFavorite = true; }
  else if (k === 'useFavorite') c.useFavorite = t.checked;
  else if (k === 'adjustChairs') c.adjustChairs = t.checked;
  else if (k === 'priority') c.priorities[t.value] = t.checked;
  else if (k === 'owned') {
    c.excluded = c.excluded.filter(id => id !== t.value);
    if (!t.checked) c.excluded.push(t.value);
  } else if (k === 'roomW' || k === 'roomD') {
    const v = Math.max(50, Number(t.value) || 0);
    commit(p => { if (k === 'roomW') p.room.width = v; else p.room.depth = v; });
    return;
  } else if (k === 'addWanted') {
    if (t.value) c.wanted.push(t.value);
    t.value = '';
    lastKey = null;
  }
  state.dirty = true;
  emit('conditions');
}

async function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  const c = cond();
  if (a === 'remove-wanted') {
    c.wanted.splice(Number(b.dataset.i), 1);
    lastKey = null;
    emit('conditions');
  } else if (a === 'run') {
    await run(false);
  } else if (a === 'run-demo') {
    await run(true);
  } else if (a === 'preview') {
    const p = state.proposals[Number(b.dataset.i)];
    if (state.preview?.proposal === p) cancelPreview(); else previewProposal(p);
  } else if (a === 'apply') {
    applyProposal(state.proposals[Number(b.dataset.i)]);
  } else if (a === 'compare') {
    compare();
  } else if (a === 'all-owned') {
    c.excluded = b.dataset.v === 'none' ? furnitureList().filter(f => !f.locked).map(f => f.id) : [];
    lastKey = null;
    emit('conditions');
  }
}

async function run(forceDemo) {
  if (loading) return;
  const c = cond();
  const furniture = furnitureList();
  const req = {
    purpose: c.purpose, people: c.people, taste: c.taste,
    favoriteColor: c.useFavorite ? c.favoriteColor : '',
    owned: furniture.filter(f => !f.locked && !c.excluded.includes(f.id)).map(f => f.id),
    wanted: c.wanted.slice(),
    priorities: { ...c.priorities },
    adjustChairs: c.adjustChairs,
    roomWidth: state.project.room.width, roomDepth: state.project.room.depth,
    areaId: (state.project.areas || []).some(a => a.id === c.areaId) ? c.areaId : '',
  };
  if (!req.owned.length && !req.wanted.length) {
    toast('配置する家具がありません。「所有している家具」にチェックを入れるか、「追加したい家具」を選んでください', 'error', 4500);
    return;
  }
  loading = true;
  cancelPreview();
  lastKey = null;
  renderAIPanel(true);
  try {
    // 描画を先に反映させてから計算する
    await new Promise(r => setTimeout(r, 30));
    const res = await requestProposals(state.project, furniture, req, { forceDemo: forceDemo || !aiStatus.ai });
    for (const p of res.proposals) p.validation = validateLayout(state.project, p.furniture);
    state.proposals = res.proposals;
    lastResult = res;
    if (res.apiError) toast(`AI APIでエラーが発生したため、デモモードで作成しました（${res.apiError}）`, 'error', 6000);
    else toast(`${res.proposals.length}つの配置案を作成しました。カードを押すとキャンバスでプレビューできます`, 'ok');
  } catch (err) {
    console.error(err);
    toast(`配置案の作成に失敗しました：${err.message}`, 'error', 5000);
  } finally {
    loading = false;
    lastKey = null;
    emit('proposals');
    el.querySelector('.proposal')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function aiKey() {
  const p = state.project;
  return [p.id, p.activeLayoutId, p.room.width, p.room.depth, p.openings.length, furnitureList().map(f => f.id + f.name + f.locked).join(), state.proposals.length, lastResult, state.preview?.proposal?.id, loading, JSON.stringify(cond())].join('|');
}

export function renderAIPanel(force) {
  if (!el || !state.project) return;
  const key = aiKey();
  if (!force && key === lastKey) return;
  lastKey = key;
  const c = cond();
  const furniture = furnitureList();
  const libOpts = CATEGORIES.map(cat => `<optgroup label="${cat.label}">${LIBRARY.filter(l => l.category === cat.id).map(l => `<option value="${l.type}">${escapeHtml(l.name)}（${l.width}×${l.depth}）</option>`).join('')}</optgroup>`).join('');
  const nameOf = t => LIBRARY.find(l => l.type === t)?.name || t;
  const statusHTML = aiStatus.ai
    ? `<div class="ai-status on"><span class="led"></span>AI接続中（${escapeHtml(aiStatus.model || 'Claude')}）</div>`
    : `<div class="ai-status"><span class="led"></span>デモモード：AI API未設定のため、ルールベースで配置案を作成します</div>`;

  el.innerHTML = `
    ${statusHTML}
    <div class="section">
      <h3>部屋の条件</h3>
      ${(state.project.areas || []).length ? `<label class="field">配置する範囲
        <select data-c="areaId"><option value="">間取り全体</option>${state.project.areas.map(a => `<option value="${a.id}" ${c.areaId === a.id ? 'selected' : ''}>${escapeHtml(a.label)}（約${(a.width * a.depth / 16200).toFixed(1)}畳）</option>`).join('')}</select>
      </label>` : ''}
      <label class="field">部屋の用途
        <select data-c="purpose">${Object.entries(PURPOSES).map(([k, v]) => `<option value="${k}" ${c.purpose === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
      <div class="grid3">
        <label class="field">横幅<span class="unit" data-unit="cm"><input type="number" data-c="roomW" value="${state.project.room.width}" min="50"></span></label>
        <label class="field">奥行き<span class="unit" data-unit="cm"><input type="number" data-c="roomD" value="${state.project.room.depth}" min="50"></span></label>
        <label class="field">使用人数<span class="unit" data-unit="人"><input type="number" data-c="people" value="${c.people}" min="1" max="8"></span></label>
      </div>
      <label class="field">インテリアのテイスト
        <select data-c="taste">${Object.entries(TASTES).map(([k, v]) => `<option value="${k}" ${c.taste === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </label>
      <div class="row tight" style="align-items:center">
        <label class="check"><input type="checkbox" data-c="useFavorite" ${c.useFavorite ? 'checked' : ''}> 好みの色を指定</label>
        <input type="color" data-c="favoriteColor" value="${c.favoriteColor}">
      </div>
      <p class="muted">ドア・窓の位置は「配置設定」タブで指定した内容を使います（${state.project.openings.length}件）。</p>
    </div>

    <div class="section">
      <div class="section-title"><h3>既に所有している家具</h3>
        <span class="btn-row" style="flex:0 0 auto"><button data-a="all-owned" data-v="all">全選択</button><button data-a="all-owned" data-v="none">解除</button></span></div>
      <p class="muted">チェックした家具は今のサイズのまま配置し直します。固定した家具は動かしません。</p>
      <div class="owned-list">
        ${furniture.length ? furniture.map(f => f.locked || !inSelectedArea(f)
          ? `<label class="check muted"><input type="checkbox" checked disabled> ${escapeHtml(f.name)}（${f.locked ? '固定' : '範囲外・そのまま'}）</label>`
          : `<label class="check"><input type="checkbox" data-c="owned" value="${f.id}" ${c.excluded.includes(f.id) ? '' : 'checked'}> ${escapeHtml(f.name)} <span class="muted">${Math.round(f.width)}×${Math.round(f.depth)}</span></label>`).join('')
          : '<span class="muted">現在のレイアウトに家具がありません</span>'}
      </div>
    </div>

    <div class="section">
      <h3>使用したい家具（新しく追加）</h3>
      <select data-c="addWanted"><option value="">＋ 家具を選んで追加…</option>${libOpts}</select>
      <div class="chips">${c.wanted.map((t, i) => `<span class="chip">${escapeHtml(nameOf(t))}<button data-a="remove-wanted" data-i="${i}" aria-label="削除">✕</button></span>`).join('') || '<span class="muted">なし</span>'}</div>
      <label class="check"><input type="checkbox" data-c="adjustChairs" ${c.adjustChairs ? 'checked' : ''}> 人数に合わせてダイニングチェアを補う</label>
    </div>

    <div class="section">
      <h3>重視すること</h3>
      <div class="grid2">
        ${PRIORITIES.map(([k, v]) => `<label class="check"><input type="checkbox" data-c="priority" value="${k}" ${c.priorities[k] ? 'checked' : ''}> ${v}</label>`).join('')}
      </div>
      <button class="primary" data-a="run" ${loading ? 'disabled' : ''} style="padding:9px">${loading ? '<span class="spinner"></span> 配置案を作成中…' : 'AIで配置を提案'}</button>
      ${aiStatus.ai ? `<button data-a="run-demo" ${loading ? 'disabled' : ''}>デモモード（ルールベース）で作成</button>` : ''}
      <p class="muted">提案はすぐには反映されません。プレビューして「この配置を適用する」を押すと、新しいレイアウトとして追加されます（今の配置は残ります）。</p>
    </div>

    ${state.proposals.length ? `
    <div class="section">
      <div class="section-title"><h3>配置案（${state.proposals.length}件）${lastResult?.mode === 'demo' ? '・デモ' : ''}</h3><button data-a="compare">並べて比較</button></div>
      ${state.proposals.map((p, i) => proposalCard(p, i)).join('')}
    </div>` : ''}
  `;
}

/** AI配置の範囲（エリア）の中にある家具か */
function inSelectedArea(f) {
  const a = (state.project.areas || []).find(x => x.id === cond().areaId);
  return !a || (f.x >= a.x && f.x <= a.x + a.width && f.y >= a.y && f.y <= a.y + a.depth);
}

function list(arr) {
  return arr?.length ? `<ul>${arr.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<span class="muted">—</span>';
}

function proposalCard(p, i) {
  const v = p.validation;
  const ok = v && !v.counts.error && !v.counts.warn;
  const previewing = state.preview?.proposal === p;
  return `<article class="proposal ${previewing ? 'previewing' : ''}">
    <div class="proposal-head"><h4>${escapeHtml(p.title)}</h4>${p.recommended ? '<span class="reco">おすすめ</span>' : ''}</div>
    <button class="proposal-thumb" data-a="preview" data-i="${i}" title="キャンバスでプレビュー" style="border:none;border-radius:0;padding:0">${thumbnailSVG(state.project, p.furniture, { width: 300, height: 190 })}</button>
    <div class="proposal-body">
      <div class="vsum ${ok ? 'ok' : 'ng'}">チェック：${v ? escapeHtml(issueSummary(v)) : '—'}</div>
      <div>${escapeHtml(p.concept)}</div>
      <div class="label">配置の特徴</div>${list(p.features)}
      <details><summary>理由・メリット・注意点を見る</summary>
        <div class="label">おすすめする理由</div><div>${escapeHtml(p.reasons)}</div>
        <div class="label">メリット</div>${list(p.merits)}
        <div class="label">注意点</div>${list(p.cautions)}
        <div class="label">家具の座標・寸法（cm）</div>
        <div class="muted" style="max-height:140px;overflow:auto">${p.furniture.map(f => `${escapeHtml(f.name)}：(${f.x}, ${f.y}) ${f.width}×${f.depth} ${f.rotation}°`).join('<br>')}</div>
      </details>
    </div>
    <div class="proposal-actions">
      <button data-a="preview" data-i="${i}" class="${previewing ? 'active' : ''}">${previewing ? 'プレビュー中' : 'プレビュー'}</button>
      <button data-a="apply" data-i="${i}" class="primary">この配置を適用する</button>
    </div>
  </article>`;
}

function compare() {
  const ps = state.proposals;
  const room = state.project.room;
  const area = room.width * room.depth / 10000;
  const row = (label, f) => `<tr><td>${label}</td><td>${f}</td></tr>`;
  const body = `<div class="compare-grid">${ps.map(p => {
    const v = p.validation;
    return `<div class="col">
      <h4>${escapeHtml(p.title)} ${p.recommended ? '<span class="reco">おすすめ</span>' : ''}</h4>
      ${thumbnailSVG(state.project, p.furniture, { width: 300, height: 200 })}
      <table>
        ${row('歩ける床面積', v?.freeRatio != null ? `${(area * v.freeRatio).toFixed(1)}㎡` : '—')}
        ${row('重要な問題', `${v?.counts.error ?? '—'}件`)}
        ${row('注意点', `${v?.counts.warn ?? '—'}件`)}
        ${row('家具の数', `${p.furniture.length}点`)}
      </table>
      <div style="padding:6px 10px;font-size:12px;line-height:1.5">${escapeHtml(p.concept)}</div>
    </div>`;
  }).join('')}</div>`;
  modal({
    title: '配置案の比較',
    body,
    wide: true,
    buttons: [
      { label: '閉じる', value: null },
      ...ps.map((p, i) => ({ label: `${p.id}案をプレビュー`, value: i, primary: !!p.recommended })),
    ],
  }).then(v => { if (v !== null && v !== undefined) previewProposal(ps[v]); });
}
