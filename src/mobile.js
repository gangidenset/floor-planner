// スマホ・タブレット向け：ホーム画面のアプリ（PWA）と、キーボードの代わりになるタッチ操作
// - サービスワーカーを登録してオフラインでも起動できるようにする
// - キャンバス上の操作バー（元に戻す・やり直す、選んだ家具の回転・反転・複製・削除・詳細）
// - 狭い画面で隠しているボタンを「その他」メニューから押せるようにする
import { state, subscribe, undo, redo, canUndo, canRedo } from './state.js';
import { endWallChain } from './canvas.js';
import * as A from './actions.js';
import { toast, modal } from './ui.js';

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

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** 使っている端末・ブラウザ（ホーム画面への追加の手順を出し分ける） */
function detectBrowser() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  // アプリの中のブラウザ（LINE・Instagram・Facebook・X・Gmail など）ではホーム画面に追加できない
  const inApp = /Line\/|FBAN|FBAV|Instagram|Twitter|GSA\/|; wv\)|MicroMessenger/.test(ua);
  let browser = 'other';
  if (/CriOS/.test(ua)) browser = 'chrome-ios';
  else if (/FxiOS|EdgiOS/.test(ua)) browser = 'other-ios';
  else if (ios) browser = 'safari';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/EdgA/.test(ua)) browser = 'edge';
  else if (/Chrome\//.test(ua)) browser = 'chrome';
  return { ios, android, inApp, browser };
}

function installGuide() {
  const { ios, android, inApp, browser } = detectBrowser();
  const url = location.href.split('#')[0];
  const steps = [];
  if (inApp) {
    steps.push('今は<strong>アプリの中のブラウザ</strong>（LINE・Instagram・Gmail など）で開いています。ここからはホーム画面に追加できません。');
    steps.push(ios
      ? '右上・右下のメニュー（… や 共有ボタン）から<strong>「Safari で開く」</strong>（または「ブラウザで開く」）を選び、Safari で開き直してください。'
      : '右上のメニュー（⋮ や …）から<strong>「ブラウザで開く」「Chrome で開く」</strong>を選び、Chrome で開き直してください。');
    steps.push('開き直したら、もう一度この「ホーム画面に追加」を押すと手順が出ます。');
  } else if (browser === 'safari') {
    steps.push('画面下（iPad は上）の<strong>共有ボタン</strong>（□ に ↑ のマーク）を押します。見えないときは画面を少し下にスクロールすると出ます。');
    steps.push('メニューを下へスクロールして<strong>「ホーム画面に追加」</strong>を押します（見つからないときは一番下の「アクションを編集」から追加できます）。');
    steps.push('右上の<strong>「追加」</strong>を押すと、ホーム画面にアイコンができます。');
  } else if (browser === 'chrome-ios') {
    steps.push('アドレスバーの右の<strong>共有ボタン</strong>（□ に ↑ のマーク）を押します。');
    steps.push('<strong>「ホーム画面に追加」</strong>を押し、右上の「追加」を押します（出てこないときは iOS とChrome を最新にするか、Safari で開いてください）。');
  } else if (browser === 'other-ios') {
    steps.push('このブラウザでは追加できないことがあります。<strong>Safari</strong> で下のアドレスを開き、共有ボタン（□ に ↑）→「ホーム画面に追加」を押してください。');
  } else if (browser === 'samsung') {
    steps.push('画面下の<strong>メニュー（≡）</strong>を押します。');
    steps.push('<strong>「ページを追加」→「ホーム画面」</strong>（または「ホーム画面に追加」）を押します。');
  } else if (android || browser === 'chrome' || browser === 'edge') {
    steps.push('右上の<strong>メニュー（⋮）</strong>を押します（Edge は下の …）。');
    steps.push('<strong>「アプリをインストール」</strong>または<strong>「ホーム画面に追加」</strong>を押します。');
    steps.push('「インストール」（または「追加」）を押すと、ホーム画面にアイコンができます。');
  } else {
    steps.push('パソコンの Chrome・Edge では、アドレスバーの右にある<strong>インストールのマーク</strong>（□ に ↓）か、メニューの「アプリをインストール」から追加できます。');
    steps.push('スマホでは、下のアドレスを Android は Chrome、iPhone は Safari で開いてください。');
  }
  return modal({
    title: 'ホーム画面に追加する',
    body: `<ol style="margin:0 0 12px;padding-left:20px;line-height:1.7">${steps.map(t => `<li>${t}</li>`).join('')}</ol>
      <p style="margin:0 0 4px;font-size:12px;color:var(--muted)">このアプリのアドレス</p>
      <input type="text" readonly value="${url}" style="width:100%" onclick="this.select()">`,
    buttons: [{ label: 'アドレスをコピー', value: 'copy' }, { label: '閉じる', value: true, primary: true }],
  }).then(v => {
    if (v !== 'copy') return;
    navigator.clipboard?.writeText(url).then(() => toast('アドレスをコピーしました', 'ok'), () => toast('コピーできませんでした。アドレスを長押ししてコピーしてください', 'error'));
  });
}

function wireInstall() {
  // Android の Chrome など：ブラウザが「追加できる」と知らせたら、その画面をそのまま出す。
  // それ以外（iPhone・アプリ内ブラウザなど）は、端末に合わせた手順を出す
  let deferred = null;
  const btn = $('btn-install');
  btn.hidden = isStandalone();
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    toast('ホーム画面に追加しました。次からはアイコンから開けます', 'ok');
  });
  btn.addEventListener('click', async () => {
    if (!deferred) { installGuide(); return; }
    const e = deferred;
    deferred = null;
    e.prompt();
    const choice = await e.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') btn.hidden = true;
  });

  // スマホで初めて開いたときに一度だけ知らせる
  if (!isStandalone() && window.matchMedia('(max-width: 960px)').matches) {
    let shown = false;
    try { shown = localStorage.getItem('afp:installHint') === '1'; localStorage.setItem('afp:installHint', '1'); } catch { /* 保存できない環境 */ }
    if (!shown) setTimeout(() => toast('ホーム画面に追加すると、アプリとしてアイコンから開けます（「その他」→「ホーム画面に追加」）', '', 8000), 2500);
  }
}
