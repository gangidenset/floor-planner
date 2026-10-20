// 家具リスト（購入リスト）
// 今のレイアウトの家具を、名前・サイズごとに個数をまとめて一覧にし、CSV 書き出し・印刷ができる。
// 搬入チェックの結果（玄関・部屋のドアを通るか）も並べて表示する。
// 値段（1つあたり）と購入済みを入力でき、合計金額・購入済み・残り・予算の残りを出す。
import { state, furnitureList, commit } from './state.js';
import { modal, toast } from './ui.js';
import { escapeHtml } from './geometry.js';
import { getSpec, CATEGORIES } from './data/furniture-library.js';
import { carryProblems, isCarried } from './carry-check.js';
import { downloadBlob } from './storage.js';

/** 一覧の行（同じ名前・同じ大きさの家具をまとめる） */
function buildRows(includeFixtures) {
  const results = new Map();
  carryProblems(state.project, furnitureList(), results);
  const rows = new Map();
  for (const f of furnitureList()) {
    if (f.autoFixture && !includeFixtures) continue;
    const size = [f.width, f.depth, f.height || 0].map(v => Math.round(v));
    const key = `${f.name}|${size.join('x')}`;
    const r = results.get(f.id);
    const carry = !isCarried(f) ? '—' : !r ? '（ドア未設定）'
      : r.reason ? (r.estimated ? `要確認：${r.door.label || 'ドア'}（推定の有効幅 約${r.clear}cm）を通らないかも` : `⚠ ${r.door.label || 'ドア'}（有効幅 約${r.clear}cm）を通らない可能性`)
      : `OK（${r.door.label || 'ドア'} 有効幅 約${r.clear}cm）`;
    const spec = f.customSpec || getSpec(f.type);
    const row = rows.get(key) || {
      key, ids: [], name: f.name, size, count: 0, carry, note: spec.note || '', url: spec.url || '',
      category: CATEGORIES.find(c => c.id === getSpec(f.type).category)?.label || '',
      fixture: !!f.autoFixture, price: 0, bought: 0, total: 0, paid: 0,
    };
    row.count++;
    row.ids.push(f.id);
    if (f.price && !row.price) row.price = f.price;
    row.total += f.price || 0;
    if (f.purchased) { row.bought++; row.paid += f.price || 0; }
    if (carry.startsWith('⚠') || (carry.startsWith('要確認') && !row.carry.startsWith('⚠'))) row.carry = carry;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category, 'ja') || a.name.localeCompare(b.name, 'ja'));
}

const yen = v => `${Math.round(v).toLocaleString('ja-JP')}円`;
const boughtLabel = r => (r.bought === 0 ? '' : r.bought === r.count ? '購入済み' : `${r.bought}/${r.count}購入済み`);

/** editable: 値段の入力欄と購入済みのチェックを出す（画面用）。false なら文字だけ（印刷用） */
function tableHTML(rows, editable = false) {
  const head = '<thead><tr><th>分類</th><th>家具</th><th>幅×奥行き×高さ（cm）</th><th>個数</th><th>値段（1つ）</th><th>金額</th><th>購入済み</th><th>搬入</th><th>メモ</th></tr></thead>';
  const body = rows.map(r => {
    const ng = r.carry.startsWith('⚠') || r.carry.startsWith('要確認');
    const price = editable
      ? `<input type="text" inputmode="numeric" data-price="${escapeHtml(r.key)}" value="${r.price || ''}" placeholder="—" style="width:90px;text-align:right">`
      : (r.price ? yen(r.price) : '—');
    const bought = editable
      ? `<label class="check" style="white-space:nowrap"><input type="checkbox" data-bought="${escapeHtml(r.key)}" ${r.bought === r.count ? 'checked' : ''}> ${r.bought && r.bought < r.count ? `${r.bought}/${r.count}` : ''}</label>`
      : boughtLabel(r);
    const memo = escapeHtml(r.note) + (r.url ? ` <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">お店のページ</a>` : '');
    return `<tr${ng ? ' class="fl-ng"' : ''}${r.bought === r.count ? ' style="opacity:.7"' : ''}>
      <td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.name)}${r.fixture ? ' <span class="muted">（設備）</span>' : ''}</td>
      <td>${r.size.join(' × ')}</td><td style="text-align:right">${r.count}</td>
      <td style="text-align:right">${price}</td><td style="text-align:right">${r.total ? yen(r.total) : '—'}</td>
      <td>${bought}</td><td>${escapeHtml(r.carry)}</td><td>${memo}</td></tr>`;
  }).join('');
  return `<table class="fl-table">${head}<tbody>${body}</tbody></table>`;
}

/** 合計：全体・購入済み・残り・予算の残り */
function totals(rows) {
  const total = rows.reduce((s, r) => s + r.total, 0), paid = rows.reduce((s, r) => s + r.paid, 0);
  const budget = Number(state.project.budget) || 0;
  const noPrice = rows.filter(r => !r.price).reduce((s, r) => s + r.count, 0);
  return { total, paid, rest: total - paid, budget, left: budget ? budget - total : null, noPrice };
}

function totalsHTML(rows) {
  const t = totals(rows);
  let html = `合計 <strong>${yen(t.total)}</strong>（購入済み ${yen(t.paid)}・これから ${yen(t.rest)}）`;
  if (t.left !== null) {
    const over = t.left < 0;
    html += `・予算 ${yen(t.budget)} に対して <strong style="color:${over ? '#b91c1c' : '#15803d'}">${over ? `${yen(-t.left)} オーバー` : `残り ${yen(t.left)}`}</strong>`;
  }
  if (t.noPrice) html += ` <span class="muted">（値段が未入力の家具 ${t.noPrice}点）</span>`;
  return html;
}

function csvOf(rows) {
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['分類', '家具', '幅(cm)', '奥行き(cm)', '高さ(cm)', '個数', '値段(1つ・円)', '金額(円)', '購入済み', '搬入', 'メモ', 'URL'].map(q).join(',')];
  for (const r of rows) lines.push([r.category, r.name, ...r.size, r.count, r.price || '', r.total || '', boughtLabel(r), r.carry, r.note, r.url].map(q).join(','));
  const t = totals(rows);
  lines.push('', ['合計', t.total, '購入済み', t.paid, 'これから', t.rest, ...(t.left !== null ? ['予算', t.budget, '予算の残り', t.left] : [])].map(q).join(','));
  // Excel で文字化けしないよう BOM を付ける
  return '﻿' + lines.join('\r\n');
}

/** 印刷用の iframe に一覧を入れて印刷する */
function printRows(rows, title) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>body{font-family:'Hiragino Sans','Yu Gothic UI','Meiryo',sans-serif;font-size:12px;margin:16mm}
    h1{font-size:16px;margin:0 0 8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;text-align:left}
    th{background:#eee}.fl-ng td{background:#fff3e0}.muted{color:#777}</style></head>
    <body><h1>${escapeHtml(title)}</h1><p>${new Date().toLocaleDateString('ja-JP')} 作成・全${rows.reduce((s, r) => s + r.count, 0)}点・${totalsHTML(rows)}</p>${tableHTML(rows)}</body></html>`);
  doc.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
}

export async function openFurnitureList() {
  let includeFixtures = false;
  let rows = buildRows(includeFixtures);
  const title = `家具リスト：${state.project.name}`;
  const summary = () => `全${rows.reduce((s, r) => s + r.count, 0)}点（${rows.length}種類）${rows.some(r => r.carry.startsWith('⚠') || r.carry.startsWith('要確認')) ? '・<strong style="color:#b45309">搬入を確かめたい家具があります</strong>' : ''}<br>${totalsHTML(rows)}`;
  await modal({
    title: '家具リスト（購入リスト）',
    wide: true,
    body: `
      <style>
        .fl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .fl-table th, .fl-table td { border-bottom: 1px solid var(--line); padding: 5px 6px; text-align: left; vertical-align: top; }
        .fl-table th { background: #f6f5f3; position: sticky; top: 0; }
        .fl-table tr.fl-ng td { background: #fff7ed; }
        .fl-wrap { max-height: 55vh; overflow: auto; }
      </style>
      <p style="margin:0">「${escapeHtml(state.project.name)}」の今のレイアウトに置いた家具の一覧です。同じ名前・同じ大きさの家具は個数にまとめています。「搬入」は玄関と置く部屋のドアを通るかの目安です（図面から読み取ったドア幅は推定なので「要確認」と出ます。実際の幅を測ってドアを選び、右パネルで幅を直すと正確になります）。</p>
      <div class="row" style="justify-content:space-between;align-items:center">
        <span id="fl-summary">${summary()}</span>
        <span class="row" style="gap:10px;align-items:center">
          <label style="display:flex;align-items:center;gap:6px">予算<span class="unit" data-unit="円"><input type="text" inputmode="numeric" id="fl-budget" value="${state.project.budget || ''}" placeholder="例 300000" style="width:110px"></span></label>
          <label class="check"><input type="checkbox" id="fl-fixtures"> 設備（浴槽・トイレなど）も含める</label>
        </span>
      </div>
      <div class="fl-wrap" id="fl-table">${rows.length ? tableHTML(rows, true) : '<p class="muted">家具がありません</p>'}</div>
      <div class="btn-row">
        <button type="button" id="fl-csv">CSV で書き出し（Excel で開けます）</button>
        <button type="button" id="fl-print">印刷</button>
      </div>`,
    buttons: [{ label: '閉じる', value: true, primary: true }],
    onMount: body => {
      const refresh = () => {
        rows = buildRows(includeFixtures);
        body.querySelector('#fl-table').innerHTML = rows.length ? tableHTML(rows, true) : '<p class="muted">家具がありません</p>';
        body.querySelector('#fl-summary').innerHTML = summary();
      };
      const toNum = v => Number(String(v).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^0-9.]/g, '')) || 0;
      body.querySelector('#fl-fixtures').addEventListener('change', e => { includeFixtures = e.target.checked; refresh(); });
      // 値段・購入済み：同じ行（同じ名前・大きさ）の家具すべてに入れる
      body.querySelector('#fl-table').addEventListener('change', e => {
        const key = e.target.dataset.price ?? e.target.dataset.bought;
        const row = rows.find(r => r.key === key);
        if (!row) return;
        const ids = new Set(row.ids);
        commit(() => {
          for (const f of furnitureList()) {
            if (!ids.has(f.id)) continue;
            if (e.target.dataset.price !== undefined) f.price = Math.round(toNum(e.target.value));
            else f.purchased = e.target.checked;
          }
        });
        refresh();
      });
      body.querySelector('#fl-budget').addEventListener('change', e => {
        commit(p => { p.budget = Math.round(toNum(e.target.value)) || 0; });
        body.querySelector('#fl-summary').innerHTML = summary();
      });
      body.querySelector('#fl-csv').addEventListener('click', () => {
        if (!rows.length) { toast('家具がありません'); return; }
        downloadBlob(new Blob([csvOf(rows)], { type: 'text/csv' }), `${state.project.name.replace(/[\\/:*?"<>|]/g, '_')}_家具リスト.csv`);
        toast('家具リストを CSV で書き出しました', 'ok');
      });
      body.querySelector('#fl-print').addEventListener('click', () => {
        if (!rows.length) { toast('家具がありません'); return; }
        printRows(rows, title);
      });
    },
  });
}

/** 印刷用：家具リストの表と合計（設備は含めない） */
export function furnitureListPrintHTML() {
  const rows = buildRows(false);
  if (!rows.length) return '';
  return `<h2>家具リスト</h2><p>全${rows.reduce((s, r) => s + r.count, 0)}点・${totalsHTML(rows)}</p>${tableHTML(rows)}`;
}
