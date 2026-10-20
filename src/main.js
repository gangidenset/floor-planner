// エントリーポイント：画面の組み立てとイベントの接続
import { state, subscribe, setProject, commit, undo, redo, canUndo, canRedo, furnitureList, activeLayout, emit, select } from './state.js';
import { initCanvas, requestRender, fitToView, zoomBy, getZoom, screenToWorld, setValidation, setFlowOverlay, resetCalibration, wallDrawKey } from './canvas.js';
import { initLibrary, initPropsPanel, renderPropsPanel, initCheckPanel, renderCheckPanel } from './panels.js';
import { initAIPanel, renderAIPanel } from './ai-panel.js';
import { validateLayout } from './layout-validator.js';
import { createSampleProject, createEmptyProject } from './data/sample-project.js';
import { importFloorplanFile, applyCalibration, scaleStatusText } from './floorplan.js';
import * as storage from './storage.js';
import * as A from './actions.js';
import { modal, toast, confirmDialog } from './ui.js';
import { autoDetectPlan } from './plan-import.js';
import { openFurnitureList } from './furniture-list.js';
import { openPrintPlan } from './print-plan.js';
import { open3DView } from './view3d.js';
import { createArea } from './area-draw.js';
import { loadCustomFurniture } from './custom-furniture.js';
import { escapeHtml, uid, deepClone, dist } from './geometry.js';
import { initMobile } from './mobile.js';

const $ = id => document.getElementById(id);
let validation = null;
let previewValidation = null;
let spaceDown = false;

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
function boot() {
  // マイ家具を先にライブラリへ（家具ライブラリの表示と、保存した間取りの中のマイ家具を読めるように）
  loadCustomFurniture();
  initCanvas($('canvas'), {
    onCursor: p => { $('cursor-pos').textContent = p ? `X ${Math.round(p.x)} / Y ${Math.round(p.y)} cm` : ''; },
    onZoom: k => { $('zoom-label').textContent = `${Math.round(k * 100)}%`; },
    onCalibrate,
    onRoomDrawn: r => {
      A.setRoomRect(r);
      A.endMode();
      toast(`部屋の輪郭を ${Math.round(r.w)} × ${Math.round(r.h)} cm に設定しました`, 'ok');
    },
    isSpaceDown: () => spaceDown,
    onErase: rect => A.eraseWalls(rect),
    onPlaceOpening: (type, pt, style) => A.placeOpening(type, pt, style),
    onWallDrawn: (a, b) => A.addWallSegment(a, b),
    onAreaDrawn: rect => createArea(rect),
    onAreaMissed: () => toast('そこは壁の上か、部屋の外です。部屋の中をクリックしてください'),
    snapOpening: (op, pt) => A.snapToWall(state.project, op, pt),
  });
  initLibrary($('library'), $('lib-search'));
  initPropsPanel($('tab-props'));
  initCheckPanel($('tab-check'));
  subscribe(onState);

  let project = null;
  const last = storage.lastProjectId();
  if (last) {
    try { project = storage.loadProject(last); } catch (e) { console.warn(e); }
  }
  setProject(project || createSampleProject());
  if (project) toast(`前回保存した「${project.name}」を開きました`);
  initAIPanel($('tab-ai'));
  wireUI();
  initMobile();
  // しばらくバックアップしていなければ知らせる（1日1回まで）
  const remind = storage.backupReminder();
  if (remind) setTimeout(() => toast(remind, '', 10000), 1500);
}

// ---------------------------------------------------------------------------
// 状態の変化に応じて画面を更新
// ---------------------------------------------------------------------------
function onState(reason) {
  const p = state.project;
  validation = validateLayout(p, furnitureList());
  previewValidation = state.preview ? (state.preview.proposal.validation ||= validateLayout(p, state.preview.proposal.furniture)) : null;
  setValidation(validation, previewValidation);
  requestRender();
  if (reason === 'project') setTimeout(fitToView, 0);

  renderPropsPanel(validation);
  if (reason !== 'drag') {
    renderCheckPanel($('tab-check'), state.preview ? previewValidation : validation, !!state.preview);
    renderAIPanel();
  }

  // ヘッダー
  const nameInput = $('project-name');
  if (document.activeElement !== nameInput) nameInput.value = p.name;
  $('dirty-flag').hidden = !state.dirty;
  $('btn-undo').disabled = !canUndo();
  $('btn-redo').disabled = !canRedo();
  document.title = `${p.name} - AI Floor Planner`;

  const v = state.preview ? previewValidation : validation;
  const badge = $('check-badge');
  const n = v.counts.error + v.counts.warn;
  badge.hidden = !n;
  badge.textContent = n;
  badge.classList.toggle('warn', !v.counts.error);

  const sc = scaleStatusText(p);
  const scEl = $('scale-status');
  scEl.textContent = sc.text;
  scEl.classList.toggle('unset', !sc.ok);

  renderBanners();
  renderLayoutSwitch();
}

function renderBanners() {
  const area = $('canvas-area');
  area.classList.toggle('mode-calibrate', state.mode === 'calibrate');
  area.classList.toggle('mode-room', state.mode === 'room');
  area.classList.toggle('mode-erase', state.mode === 'erase');
  area.classList.toggle('mode-place', state.mode.startsWith('place-') || state.mode === 'measure' || state.mode === 'draw-wall' || state.mode === 'draw-area');
  $('btn-measure')?.classList.toggle('active', state.mode === 'measure');
  const mb = $('mode-banner');
  const msgs = {
    calibrate: '<strong>縮尺の設定</strong>：長さが分かっている壁などの<strong>両端を順にクリック</strong>してください（2点）',
    room: '<strong>部屋の輪郭</strong>：部屋の角から対角の角まで<strong>ドラッグ</strong>してください',
    bg: '<strong>背景画像の調整</strong>：画像をドラッグで移動、右下の□で拡大・縮小（縦横比は固定）',
    erase: '<strong>壁を消す</strong>：消したい壁の上を<strong>ドラッグ</strong>（クリックで30cm四方）。通路にしたい所の壁を消せます',
    'place-door': '<strong>ドアを置く</strong>：ドアを付けたい<strong>壁の上をクリック</strong>してください（壁の向きに合わせて置かれます）',
    'place-sliding': '<strong>引き戸を置く</strong>：引き戸を付けたい<strong>壁の上をクリック</strong>してください（壁の向きに合わせて置かれます）',
    'place-folding': '<strong>折れ戸を置く</strong>：折れ戸を付けたい<strong>壁の上をクリック</strong>してください（壁の向きに合わせて置かれます）',
    'place-window': '<strong>窓を置く</strong>：窓を付けたい<strong>壁の上をクリック</strong>してください',
    'draw-wall': '<strong>壁を描く</strong>：始点と終点を<strong>クリック</strong>して壁を引きます。続けてクリックすると、つながった壁を引けます。<strong>数字を打って Enter</strong> でその長さに。右クリック・ダブルクリック・Esc で区切り、もう一度 Esc で終了（Alt で縦横にそろえない）',
    'draw-area': '<strong>部屋を描く</strong>：壁に囲まれた所を<strong>クリック</strong>すると、その範囲を部屋にします（ドア・窓の所は閉じているものとして扱います）。<strong>ドラッグ</strong>で長方形の部屋も描けます',
    measure: '<strong>距離を測る</strong>：測りたい<strong>2点を順にクリック</strong>してください（Shift で縦・横にそろえる。もう一度クリックで測り直し）',
  };
  if (msgs[state.mode]) {
    mb.hidden = false;
    const done = state.mode === 'bg' || state.mode === 'erase' || state.mode === 'measure' || state.mode === 'draw-wall' || state.mode === 'draw-area';
    mb.innerHTML = `<span>${msgs[state.mode]}</span><button id="mode-done" class="${done ? 'primary' : ''}">${done ? '完了' : 'キャンセル'}</button>`;
    $('mode-done').onclick = () => A.endMode();
  } else mb.hidden = true;

  const pb = $('preview-banner');
  if (state.preview) {
    const pr = state.preview.proposal;
    const c = previewValidation.counts;
    pb.hidden = false;
    pb.innerHTML = `<span><strong>プレビュー中：${escapeHtml(pr.title)}</strong>（現在の配置は変更されていません${c.error + c.warn ? `／重要${c.error}・注意${c.warn}` : ''}）</span>
      <button class="primary" id="pv-apply">この配置を適用する</button><button id="pv-cancel">プレビューを終了</button>`;
    $('pv-apply').onclick = () => A.applyProposal(pr);
    $('pv-cancel').onclick = () => A.cancelPreview();
  } else pb.hidden = true;
  area.classList.toggle('has-banner', !mb.hidden || !pb.hidden);
}

function renderLayoutSwitch() {
  const p = state.project;
  const box = $('layout-switch');
  const key = p.layouts.map(l => l.id + l.name).join() + p.activeLayoutId + !!state.preview;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<span class="muted">レイアウト</span>
    <select id="layout-select" aria-label="レイアウトを切り替え" ${state.preview ? 'disabled' : ''}>${p.layouts.map(l => `<option value="${l.id}" ${l.id === p.activeLayoutId ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}</select>
    <button id="layout-dup" title="現在のレイアウトを複製" ${state.preview ? 'disabled' : ''}>複製</button>`;
  $('layout-select').onchange = e => A.switchLayout(e.target.value);
  $('layout-dup').onclick = () => A.duplicateLayout();
}

// ---------------------------------------------------------------------------
// 縮尺設定
// ---------------------------------------------------------------------------
async function onCalibrate(a, b) {
  const cur = dist(a, b);
  const res = await modal({
    title: '縮尺の設定',
    body: `<p style="margin:0">クリックした2点間の<strong>実際の長さ</strong>を入力してください。<br><span class="muted">例：間取り図に「3,640」と書かれた壁なら 364 cm</span></p>
      <label class="field">実際の長さ<span class="unit" data-unit="cm"><input type="number" id="calib-len" min="1" step="1" value="${Math.round(cur)}"></span></label>
      <p class="muted" style="margin:0">現在の表示上の長さ：約${Math.round(cur)}cm（${state.project.scale?.status === 'unset' ? '縮尺未設定のため目安' : '現在の縮尺'}）</p>`,
    buttons: [{ label: 'やり直す', value: 'retry' }, { label: 'キャンセル', value: null }, { label: '縮尺を設定', value: 'ok', primary: true }],
    collect: body => Number(body.querySelector('#calib-len').value),
  });
  if (res.value === 'retry') { resetCalibration(); return; }
  if (res.value !== 'ok' || !(res.data > 0)) { A.endMode(); return; }
  commit(p => applyCalibration(p, a, b, res.data));
  A.endMode();
  fitToView();
  const next = await confirmDialog('縮尺を設定しました', `画像上の 1px が約 ${state.project.scale.cmPerPx.toFixed(2)}cm になりました。<br>続けて、間取り図に合わせて<strong>部屋の輪郭</strong>をドラッグで描きますか？`, '輪郭を描く');
  if (next) A.startMode('room');
}

// ---------------------------------------------------------------------------
// プロジェクト操作
// ---------------------------------------------------------------------------
async function confirmDiscard() {
  if (!state.dirty) return true;
  return confirmDialog('未保存の変更があります', '保存していない変更は失われます。続けますか？', '続ける', true);
}

async function newProject() {
  if (!(await confirmDiscard())) return;
  const res = await modal({
    title: '新規プロジェクト',
    body: `<label class="field">プロジェクト名<input type="text" id="np-name" value="新しいプロジェクト" maxlength="60"></label>
      <div class="grid2">
        <label class="field">部屋の横幅<span class="unit" data-unit="cm"><input type="number" id="np-w" value="600" min="50"></span></label>
        <label class="field">部屋の奥行き<span class="unit" data-unit="cm"><input type="number" id="np-d" value="450" min="50"></span></label>
      </div>
      <p class="muted" style="margin:0">あとから間取り図の画像を読み込み、縮尺と部屋の輪郭を合わせることもできます。</p>`,
    buttons: [{ label: 'キャンセル', value: null }, { label: 'サンプルLDKで始める', value: 'sample' }, { label: '空の部屋で始める', value: 'empty', primary: true }],
    collect: b => ({ name: b.querySelector('#np-name').value.trim(), w: Number(b.querySelector('#np-w').value), d: Number(b.querySelector('#np-d').value) }),
  });
  if (!res.value) return;
  let p;
  if (res.value === 'sample') p = createSampleProject();
  else {
    p = createEmptyProject();
    p.name = res.data.name || '新しいプロジェクト';
    p.room.width = Math.max(50, res.data.w || 600);
    p.room.depth = Math.max(50, res.data.d || 450);
  }
  setProject(p, { dirty: true });
  toast(res.value === 'sample' ? 'サンプルLDKを開きました' : '新しいプロジェクトを作成しました。ドア・窓は右パネルから追加できます');
}

async function openProject() {
  const list = storage.listProjects();
  const body = list.length
    ? `<div class="list proj-list">${list.map(p => `<div class="list-item" data-id="${p.id}">
        <span class="grow"><strong>${escapeHtml(p.name)}</strong><br><span class="muted">${new Date(p.updatedAt).toLocaleString('ja-JP')}・レイアウト${p.layouts || 1}件</span></span>
        <button data-open="${p.id}" class="primary">開く</button><button data-del="${p.id}" class="danger">削除</button></div>`).join('')}</div>`
    : '<p class="muted">保存済みのプロジェクトはまだありません。「保存」を押すとブラウザに保存されます。</p>';
  const res = await modal({
    title: '保存済みのプロジェクト',
    body,
    buttons: [{ label: 'サンプルを開く', value: 'sample' }, { label: '閉じる', value: null }],
    onMount: (el, close) => {
      el.addEventListener('click', async e => {
        const o = e.target.closest('[data-open]');
        const d = e.target.closest('[data-del]');
        if (o) close({ open: o.dataset.open });
        if (d) {
          storage.deleteProject(d.dataset.del);
          d.closest('.list-item').remove();
          toast('プロジェクトを削除しました');
        }
      });
    },
  });
  if (!res) return;
  if (!(await confirmDiscard())) return;
  if (res === 'sample') { setProject(createSampleProject()); return; }
  try {
    const p = storage.loadProject(res.open);
    if (!p) throw new Error('プロジェクトが見つかりません');
    setProject(p);
    toast(`「${p.name}」を開きました`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function saveProject() {
  try {
    const p = state.project;
    if (p.isSample && p.name === 'サンプル LDK') p.name = 'サンプル LDK（保存版）';
    // 削除した背景画像のデータは保存しない
    const used = p.background?.assetId;
    p.assets = used && p.assets?.[used] ? { [used]: p.assets[used] } : {};
    state.savedAt = storage.saveProject(p);
    state.dirty = false;
    emit('saved');
    toast('ブラウザに保存しました。再読み込みしても復元されます', 'ok');
  } catch (e) {
    toast(e.message, 'error', 6000);
  }
}

async function saveAs() {
  const p = deepClone(state.project);
  p.id = uid('project');
  p.name = `${p.name}のコピー`;
  setProject(p, { dirty: true });
  saveProject();
}

async function importPlan(file) {
  if (!file) return;
  try {
    toast('間取り図を読み込んでいます…');
    const img = await importFloorplanFile(file);
    const assetId = uid('asset');
    const room = state.project.room;
    const aspect = img.height / img.width;
    const w = Math.max(room.width, room.depth / aspect) * 1.15;
    state.project.assets = { ...Object.fromEntries(Object.entries(state.project.assets || {}).filter(([k]) => k === state.project.background?.assetId)), [assetId]: img.dataUrl };
    commit(p => {
      p.background = {
        assetId, naturalWidth: img.width, naturalHeight: img.height,
        width: Math.round(w), height: Math.round(w * aspect),
        x: Math.round(room.x + room.width / 2 - w / 2), y: Math.round(room.y + room.depth / 2 - (w * aspect) / 2),
        opacity: 0.85, visible: true,
      };
      p.scale = { status: 'unset', cmPerPx: null };
    });
    state.settings.showBg = true;
    if (state.project.isSample) state.project.name = file.name.replace(/\.[^.]+$/, '') || '新しい間取り';
    // 画像から部屋を自動認識。手動設定を選んだ場合は縮尺設定モードへ
    if (await autoDetectPlan()) {
      fitToView();
    } else {
      A.startMode('calibrate');
      toast('縮尺が未設定です：長さが分かる壁の両端をクリックしてください', '', 6000);
    }
  } catch (e) {
    toast(e.message, 'error', 6000);
  }
}

async function exportPng() {
  try {
    const furniture = state.preview ? state.preview.proposal.furniture : furnitureList();
    const title = `${state.project.name} ／ ${state.preview ? state.preview.proposal.title : activeLayout().name}`;
    await storage.exportPNG(state.project, furniture, { showBg: state.settings.showBg, dims: state.settings.dims, labels: state.settings.labels, title });
    toast('PNG画像を書き出しました', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function showHelp() {
  modal({
    title: '操作方法',
    body: `<ul class="help-list">
      <li><strong>家具を追加</strong>：左の一覧をクリック（画面中央の空いている場所に追加）またはキャンバスへドラッグ</li>
      <li><strong>移動</strong>：家具をドラッグ（グリッドと壁にスナップ。<kbd>Alt</kbd>を押しながらで解除）／矢印キーで1cm（<kbd>Shift</kbd>で10cm）</li>
      <li><strong>サイズ変更</strong>：四隅・辺の□ハンドルをドラッグ、または右パネルで数値入力</li>
      <li><strong>回転</strong>：上の○ハンドルをドラッグ（15°刻み、<kbd>Shift</kbd>で1°）、<kbd>R</kbd>キーで90°、右パネルのボタン</li>
      <li><strong>複製・削除</strong>：<kbd>Ctrl</kbd>+<kbd>D</kbd>／<kbd>Delete</kbd>、または右パネル</li>
      <li><strong>複数選択</strong>：<kbd>Shift</kbd>+クリックで追加・解除、<kbd>Shift</kbd>+何もない所をドラッグで範囲選択、<kbd>Ctrl</kbd>+<kbd>A</kbd>ですべて。選んだ家具はまとめて移動・回転・固定・複製・削除できます</li>
      <li><strong>左右反転</strong>：<kbd>F</kbd> キー、または右パネルの「⇋ 左右反転」（ナイトテーブルの側、L字ソファの向きなど）</li>
      <li><strong>壁を描く</strong>：右パネルの「壁を描く」または <kbd>W</kbd> キー。クリックで始点・終点（続けてクリックでつながった壁）、数字＋<kbd>Enter</kbd> で長さ指定、<kbd>Esc</kbd> で区切り</li>
      <li><strong>部屋を描く</strong>：右パネルの「部屋を描く」で、壁に囲まれた所をクリック（ドラッグで長方形）。名前を付けると、AI提案の「配置する範囲」に使えます</li>
      <li><strong>実寸で合わせる</strong>：右パネルの「📐 実寸で合わせる」で、測った長さ・ドアの幅を入れて間取りを実寸に直す</li>
      <li><strong>立体表示</strong>：下の「🧊 立体表示」または <kbd>V</kbd> キー。斜め上から見た図を90°ずつ回して確認</li>
      <li><strong>印刷・PDF</strong>：「その他」→「印刷・PDF」で寸法入りの間取り図を A4 に（PDF は印刷画面で「PDF に保存」）</li>
      <li><strong>距離を測る</strong>：下の「📏 測る」または <kbd>M</kbd> キーで、2点をクリック（<kbd>Shift</kbd> で縦・横にそろえる）</li>
      <li><strong>家具リスト・搬入チェック</strong>：「その他」→「家具リスト」で一覧・CSV 書き出し・印刷。玄関と部屋のドアを通るかも表示。値段・購入済み・予算を入れると合計と残りを計算</li>
      <li><strong>壁の長さ・厚み</strong>：壁を選んで右パネルに数値を入れる（つながった壁とドアも一緒に動かせます）</li>
      <li><strong>バックアップ</strong>：「その他」→「すべてをバックアップ」で全プロジェクトを1つのファイルに保存。「ファイルを読み込む」で復元</li>
      <li><strong>画面操作</strong>：何もない所をドラッグで移動、ホイールでズーム、<kbd>Space</kbd>+ドラッグでも移動、<kbd>0</kbd>で全体表示</li>
      <li><strong>元に戻す</strong>：<kbd>Ctrl</kbd>+<kbd>Z</kbd>／やり直す：<kbd>Ctrl</kbd>+<kbd>Y</kbd>、保存：<kbd>Ctrl</kbd>+<kbd>S</kbd></li>
      <li><strong>間取り図</strong>：「間取りを読み込む」→ 壁の両端をクリックして実寸を入力（縮尺設定）→ 部屋の輪郭をドラッグ</li>
      <li><strong>AI提案</strong>：右パネル「AI提案」で条件を入れて実行 → カードでプレビュー → 「この配置を適用する」で新しいレイアウトとして追加</li>
    </ul>`,
    buttons: [{ label: '閉じる', value: true, primary: true }],
  });
}

// ---------------------------------------------------------------------------
// UI イベント
// ---------------------------------------------------------------------------
function wireUI() {
  $('btn-new').onclick = newProject;
  $('btn-open').onclick = openProject;
  $('btn-save').onclick = saveProject;
  $('btn-undo').onclick = undo;
  $('btn-redo').onclick = redo;
  $('btn-png').onclick = exportPng;
  $('btn-import-plan').onclick = () => $('file-plan').click();
  $('file-plan').onchange = e => { importPlan(e.target.files[0]); e.target.value = ''; };
  $('file-json').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !(await confirmDiscard())) return;
    try {
      const p = await storage.readProjectFile(f);
      if (p.backup) {
        // バックアップファイル：中のプロジェクトをすべてブラウザに戻し、いちばん新しいものを開く
        const when = p.exportedAt ? new Date(p.exportedAt).toLocaleString('ja-JP') : '';
        const ok = await confirmDialog('バックアップから復元', `${when ? `${escapeHtml(when)} のバックアップ。` : ''}<strong>${p.projects.length}件</strong>のプロジェクトをこのブラウザに戻します。<br>同じプロジェクトがすでにある場合は、バックアップの内容で上書きされます。`, '復元する');
        if (!ok) return;
        const n = storage.restoreBackup(p.projects, p.customFurniture);
        const first = storage.listProjects()[0];
        const opened = first && storage.loadProject(first.id);
        if (opened) setProject(opened);
        toast(`${n}件のプロジェクトを復元しました${opened ? `（「${opened.name}」を開きました。ほかは「開く」から選べます）` : ''}`, 'ok', 7000);
        return;
      }
      setProject(p, { dirty: true });
      toast(`「${p.name}」を読み込みました（保存するとブラウザに残ります）`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };

  const nameInput = $('project-name');
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim() || '無題のプロジェクト';
    commit(p => { p.name = v; });
  });

  // その他メニュー
  const more = $('more-menu'), moreBtn = $('btn-more');
  moreBtn.onclick = e => { e.stopPropagation(); more.hidden = !more.hidden; moreBtn.setAttribute('aria-expanded', String(!more.hidden)); };
  document.addEventListener('click', () => { more.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); });
  more.addEventListener('click', e => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'export-json') { storage.exportProjectJSON(state.project); toast('このプロジェクトをファイルに書き出しました', 'ok'); }
    if (a === 'furniture-list') openFurnitureList();
    if (a === 'print-plan') openPrintPlan();
    if (a === 'backup-all') {
      const n = storage.exportAllBackup(state.project);
      toast(n ? `${n}件のプロジェクトをバックアップファイルに保存しました。消えないように大事な場所（クラウドなど）に置いてください` : 'バックアップするプロジェクトがありません（保存したプロジェクトがまだありません）', n ? 'ok' : '', 7000);
    }
    if (a === 'import-json') $('file-json').click();
    if (a === 'save-as') saveAs();
    if (a === 'help') showHelp();
  });

  // タブ
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ステータスバー
  $('zoom-in').onclick = () => zoomBy(1.25);
  $('zoom-out').onclick = () => zoomBy(0.8);
  $('zoom-fit').onclick = fitToView;
  $('btn-measure').onclick = () => A.startMode('measure');
  $('btn-3d').onclick = () => open3DView();
  // 表示設定は次に開いたときも同じ状態にする（ブラウザに保存。保存できない環境では毎回はじめの状態）
  const optKey = key => (key === 'issues' ? 'afp:showIssues' : `afp:opt:${key}`);
  const loadOpt = (key, fallback) => {
    try { const v = localStorage.getItem(optKey(key)); return v === null ? fallback : v === '1'; } catch { return fallback; }
  };
  const saveOpt = (key, on) => {
    try { localStorage.setItem(optKey(key), on ? '1' : '0'); } catch { /* 保存できない環境 */ }
  };
  const bindOpt = (id, key) => {
    state.settings[key] = loadOpt(key, state.settings[key]);
    $(id).checked = state.settings[key];
    $(id).onchange = e => { state.settings[key] = e.target.checked; saveOpt(key, e.target.checked); requestRender(); };
  };
  // 描く壁の厚み（右パネルで変えた値を覚えておく）
  try { const t = Number(localStorage.getItem('afp:opt:wallThickness')); if (t >= 3 && t <= 50) state.settings.wallThickness = t; } catch { /* 保存できない環境 */ }
  bindOpt('opt-grid', 'grid');
  bindOpt('opt-snap', 'snap');
  bindOpt('opt-dims', 'dims');
  bindOpt('opt-labels', 'labels');
  bindOpt('opt-issues', 'issues');
  // 通路表示はキャンバス側で持っている
  $('opt-flow').checked = loadOpt('flow', false);
  if ($('opt-flow').checked) setFlowOverlay(true);
  $('opt-flow').onchange = e => { saveOpt('flow', e.target.checked); setFlowOverlay(e.target.checked); };

  // ライブラリからのドロップ
  const area = $('canvas-area');
  area.addEventListener('dragover', e => {
    if ([...e.dataTransfer.types].includes('text/afp-type')) { e.preventDefault(); area.classList.add('drop-target'); }
  });
  area.addEventListener('dragleave', () => area.classList.remove('drop-target'));
  area.addEventListener('drop', e => {
    area.classList.remove('drop-target');
    const type = e.dataTransfer.getData('text/afp-type');
    if (!type) return;
    e.preventDefault();
    const p = screenToWorld(e.clientX, e.clientY);
    A.addFurniture(type, { x: Math.round(p.x), y: Math.round(p.y) });
  });
  $('canvas').addEventListener('contextmenu', e => e.preventDefault());

  // 狭い画面用のパネル開閉
  const closeDrawers = () => { document.body.classList.remove('show-left', 'show-right'); $('scrim').hidden = true; };
  $('toggle-left').onclick = () => { document.body.classList.toggle('show-left'); document.body.classList.remove('show-right'); $('scrim').hidden = !document.body.classList.contains('show-left'); };
  $('toggle-right').onclick = () => { document.body.classList.toggle('show-right'); document.body.classList.remove('show-left'); $('scrim').hidden = !document.body.classList.contains('show-right'); };
  $('scrim').onclick = closeDrawers;

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
  window.addEventListener('blur', () => { spaceDown = false; });
  window.addEventListener('beforeunload', e => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  $('zoom-label').textContent = `${Math.round(getZoom() * 100)}%`;
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  for (const n of ['props', 'ai', 'check']) $(`tab-${n}`).hidden = n !== name;
}

function onKeyDown(e) {
  if (document.querySelector('.modal-backdrop')) return;
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (typing) return;
  // 壁を描くモード：長さの打ち込み・Enter・Esc（引いている途中を終える）
  if (!mod && state.mode === 'draw-wall' && wallDrawKey(e.key)) { e.preventDefault(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); A.duplicateSelected(); return; }
  if (mod && e.key.toLowerCase() === 'a') {
    // 家具をすべて選択
    e.preventDefault();
    const ids = furnitureList().map(f => f.id);
    if (ids.length) select({ kind: 'furniture', id: ids[ids.length - 1], ids: ids.length > 1 ? ids : undefined });
    return;
  }
  if (e.key === 'f' || e.key === 'F') { A.flipSelected(); return; }
  if (e.key === 'm' || e.key === 'M') { A.startMode('measure'); return; }
  if (e.key === 'w' || e.key === 'W') { A.startMode('draw-wall'); return; }
  if (e.key === 'v' || e.key === 'V') { open3DView(); return; }
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (state.mode !== 'select') A.endMode();
    else if (state.preview) A.cancelPreview();
    else select(null);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); A.deleteSelected(); return; }
  if (e.key === 'r' || e.key === 'R') { A.rotateSelected(e.shiftKey ? -90 : 90); return; }
  if (e.key === '0') { fitToView(); return; }
  if (e.key === '+' || e.key === '=') { zoomBy(1.25); return; }
  if (e.key === '-') { zoomBy(0.8); return; }
  const step = e.shiftKey ? 10 : 1;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key] && state.selection?.kind === 'furniture') {
    e.preventDefault();
    A.nudgeSelected(...arrows[e.key]);
  }
}

boot();
