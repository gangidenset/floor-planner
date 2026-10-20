// スマホ・タブレット向け：ホーム画面のアプリ（PWA）と、キーボードの代わりになるタッチ操作
// - サービスワーカーを登録してオフラインでも起動できるようにする
// - キャンバス上の操作バー（元に戻す・やり直す、選んだ家具の回転・反転・複製・削除・詳細）
// - 狭い画面で隠しているボタンを「その他」メニューから押せるようにする
import { state, subscribe, undo, redo, canUndo, canRedo } from './state.js';
import { endWallChain } from './canvas.js';
import * as A from './actions.js';
import { toast } from './ui.js';

const $ = id => document.getElementById(id);
const narrow = () => window.matchMedia('(max-width: 960px)').matches;

export function initMobile() {
  registerServiceWorker();
  wireTouchBar();
  wireMenu();
  wireInstall();
  wireDrawers();
}

function registerServiceWorker() {
  // http://（localhost 以外）ではサービスワーカーは使えない。その場合は普通の Web ページとして動く
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('[sw]', err));
  });
}

function wireTouchBar() {
  const bar = $('touch-bar');
  const statusbar = document.querySelector('.statusbar');
  // 操作バーをステータスバーのすぐ上に置く（ステータスバーは折り返しで高さが変わる）
  new ResizeObserver(() => bar.style.setProperty('--statusbar-h', `${statusbar.offsetHeight}px`)).observe(statusbar);

  $('tb-undo').onclick = () => undo();
  $('tb-redo').onclick = () => redo();
  $('tb-rotate').onclick = () => A.rotateSelected(90);
  $('tb-flip').onclick = () => A.flipSelected();
  $('tb-dup').onclick = () => A.duplicateSelected();
  $('tb-del').onclick = () => A.deleteSelected();
  $('tb-props').onclick = () => openRightPanel('props');

  const update = () => {
    $('tb-undo').disabled = !canUndo();
    $('tb-redo').disabled = !canRedo();
    const kind = state.selection?.kind;
    const furniture = kind === 'furniture';
    $('tb-sel').hidden = !kind || !!state.preview;
    // 回転・反転は家具だけ。壁・ドア・窓は複製できないので削除と詳細だけ
    $('tb-rotate').hidden = $('tb-flip').hidden = $('tb-dup').hidden = !furniture;
  };
  subscribe(update);
  update();
}

function openRightPanel(tab) {
  document.querySelector(`.tab[data-tab="${tab}"]`)?.click();
  if (!narrow()) return;
  document.body.classList.add('show-right');
  document.body.classList.remove('show-left');
  $('scrim').hidden = false;
}

function closeDrawers() {
  document.body.classList.remove('show-left', 'show-right');
  $('scrim').hidden = true;
}

function wireMenu() {
  // 狭い画面で隠しているヘッダーのボタンを、メニューから押す
  $('more-menu').addEventListener('click', e => {
    const id = e.target.closest('[data-click]')?.dataset.click;
    if (id) $(id)?.click();
  });
}

function wireDrawers() {
  // 家具一覧から家具を追加したら、置いた家具が見えるように一覧を閉じる
  $('library').addEventListener('click', e => {
    if (narrow() && e.target.closest('.lib-item') && !e.target.closest('[data-edit-custom]')) setTimeout(closeDrawers, 0);
  });
  // 壁を描くモード：タッチでは右クリック・Esc が使えないので「区切る」ボタンを出す
  subscribe(() => {
    const mb = $('mode-banner');
    if (state.mode !== 'draw-wall' || mb.hidden || $('mode-break')) return;
    const btn = document.createElement('button');
    btn.id = 'mode-break';
    btn.textContent = '区切る';
    btn.title = '続けて引いている壁をここで終える';
    btn.onclick = () => endWallChain();
    $('mode-done')?.before(btn);
  });
}

function wireInstall() {
  // Android の Chrome など：「ホーム画面に追加」をメニューから出せるようにする
  let deferred = null;
  const btn = $('btn-install');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    toast('ホーム画面に追加しました。次からはアイコンから開けます', 'ok');
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    btn.hidden = true;
  });
}
