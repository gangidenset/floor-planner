// 共通UI部品：モーダル・トースト
import { escapeHtml } from './geometry.js';

export function toast(message, type = '', ms = 3200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * モーダルを表示する。buttons: [{ label, value, primary, danger }]
 * 戻り値: 押されたボタンの value（閉じた場合は null）
 * onMount(body) でフォーム要素の初期化ができる。collect(body) の戻り値が { value, data } の data に入る。
 * beforeClose(value, body) が false を返すと閉じない（入力の確認用。閉じるボタン・Esc・背景クリックでは呼ばない）。
 */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onMount, collect, beforeClose }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head">${escapeHtml(title)}</div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${escapeHtml(b.label)}</button>`).join('')}</div>
    </div>`;
    root.appendChild(back);
    const bodyEl = back.querySelector('.modal-body');
    const close = value => {
      if (beforeClose && value !== null && beforeClose(value, bodyEl) === false) return;
      const data = collect && value !== null ? collect(bodyEl) : undefined;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(collect ? { value, data } : value);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        const primary = buttons.findIndex(b => b.primary);
        if (primary >= 0) { e.preventDefault(); close(buttons[primary].value); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', e => { if (e.target === back) close(null); });
    back.querySelectorAll('.modal-foot button').forEach(btn => btn.addEventListener('click', () => close(buttons[Number(btn.dataset.i)].value)));
    onMount?.(bodyEl, close);
    const focusEl = bodyEl.querySelector('input, select, textarea') || back.querySelector('.modal-foot .primary');
    focusEl?.focus();
    if (focusEl?.select) focusEl.select();
  });
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return modal({
    title,
    body: `<p style="margin:0">${message}</p>`,
    buttons: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
}
