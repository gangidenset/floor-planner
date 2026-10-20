// 左パネル（家具ライブラリ）・右パネル（配置設定・チェック）
import { state, emit, commit, select, beginTransaction, endTransaction, inTransaction, getItem, getOpening, getWall, activeLayout, selectedIds } from './state.js';
import { CATEGORIES, LIBRARY, getSpec } from './data/furniture-library.js';
import { previewSVG } from './furniture.js';
import { escapeHtml, normAngle } from './geometry.js';
import { WALL_LABELS, OPENING_LABELS, DOOR_STYLE_LABELS, doorStyle, clampOpening, scaleStatusText, syncRoomToImage } from './floorplan.js';
import * as A from './actions.js';
import { toast } from './ui.js';
import { autoDetectPlan } from './plan-import.js';
import { isDiningTable, followTable, poseOf, attachNearbyChairs } from './table-chairs.js';
import { openPlanReview } from './plan-review.js';
import { openCalibratePlan } from './calibrate-plan.js';
import { editCustomFurniture } from './custom-furniture.js';
import { M2_PER_JO } from './plan-detect.js';

// ---------------------------------------------------------------------------
// 家具ライブラリ
// ---------------------------------------------------------------------------
export function initLibrary(container, searchInput) {
  const draw = () => {
    const q = searchInput.value.trim().toLowerCase();
    const addBtn = '<div class="btn-row" style="padding:0 0 6px"><button type="button" data-add-custom title="持っている家具や買いたい商品の大きさを登録します">＋ マイ家具を登録（自分の家具・買いたい商品）</button></div>';
    container.innerHTML = addBtn + CATEGORIES.map(cat => {
      const items = LIBRARY.filter(i => i.category === cat.id && (!q || i.name.toLowerCase().includes(q) || cat.label.includes(q)));
      if (!items.length) return '';
      return `<details class="lib-cat" open>
        <summary>${cat.label}</summary>
        <div class="lib-items">
          ${items.map(i => `<button class="lib-item" draggable="true" data-type="${i.type}" title="${escapeHtml(i.name)}（${i.width}×${i.depth}×${i.height}cm）">
            ${previewSVG(i, 52)}
            <span class="name">${escapeHtml(i.name)}</span>
            <span class="size">${i.width}×${i.depth}</span>
            ${i.custom ? `<span class="size" data-edit-custom="${i.type}" role="button" title="編集・削除" style="text-decoration:underline;cursor:pointer">✎ 編集</span>` : ''}
          </button>`).join('')}
        </div>
      </details>`;
    }).join('') || '<p class="muted" style="padding:8px">該当する家具がありません</p>';
  };
  draw();
  searchInput.addEventListener('input', draw);
  container.addEventListener('click', async e => {
    if (e.target.closest('[data-add-custom]')) { if (await editCustomFurniture()) draw(); return; }
    const ed = e.target.closest('[data-edit-custom]');
    if (ed) { e.stopPropagation(); if (await editCustomFurniture(ed.dataset.editCustom)) draw(); return; }
    const b = e.target.closest('.lib-item');
    if (!b) return;
    A.addFurniture(b.dataset.type);
    document.body.classList.remove('show-left');
  });
  container.addEventListener('dragstart', e => {
    const b = e.target.closest('.lib-item');
    if (!b) return;
    e.dataTransfer.setData('text/afp-type', b.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
}

// ---------------------------------------------------------------------------
// 配置設定パネル
// ---------------------------------------------------------------------------
const SWATCHES = ['#B7A99A', '#A9B2A4', '#9FA7B0', '#D9CBB5', '#E3D9CB', '#C9A77C', '#8C6D52', '#6B5B4E', '#4A4F57', '#2E3238', '#E2B654', '#B5651D', '#8DA382', '#C7887A', '#7E95B8', '#FFFFFF'];

let propsEl, lastKey = null, validationRef = null;

function num(v, d = 1) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * d) / d : 0;
}

function field(label, bind, { type = 'number', unit = '', step = 1, min, attrs = '' } = {}) {
  const input = `<input type="${type}" data-bind="${bind}" step="${step}" ${min != null ? `min="${min}"` : ''} ${attrs}>`;
  return `<label class="field">${label}${unit ? `<span class="unit" data-unit="${unit}">${input}</span>` : input}</label>`;
}

/** data-bind のパスから [対象オブジェクト, キー] を取得 */
function resolve(path) {
  const [scope, key] = path.split('.');
  const p = state.project;
  const sel = state.selection;
  const obj = {
    item: sel?.kind === 'furniture' ? getItem(sel.id) : null,
    op: sel?.kind === 'opening' ? getOpening(sel.id) : null,
    wall: sel?.kind === 'wall' ? getWall(sel.id) : null,
    room: p.room,
    bg: p.background,
    layout: activeLayout(),
    settings: state.settings,
  }[scope];
  return [obj, key, scope];
}

function readValue(obj, key) {
  if (obj && key === 'area') return String(Math.round(obj.width * obj.depth / 100) / 100);
  if (obj && key === 'jo') return String(Math.round(obj.width * obj.depth / 10000 / M2_PER_JO * 10) / 10);
  if (obj && key === 'style' && obj.type === 'door') return doorStyle(obj); // 開き方が未設定のドアは開き戸
  // 壁の長さ（長い辺）と厚み（短い辺）
  if (obj && key === 'length' && 'w' in obj && 'h' in obj) return String(Math.round(Math.max(obj.w, obj.h) * 10) / 10);
  if (obj && key === 'thickness' && 'w' in obj && 'h' in obj) return String(Math.round(Math.min(obj.w, obj.h) * 10) / 10);
  const v = obj?.[key];
  return typeof v === 'number' ? String(Math.round(v * 10) / 10) : (v ?? '');
}

function writeValue(path, input) {
  const [obj, key, scope] = resolve(path);
  if (!obj) return;
  let v = input.type === 'checkbox' ? input.checked : input.value;
  if (input.type === 'number' || input.type === 'range') {
    if (v === '' || !Number.isFinite(Number(v))) return;
    v = Number(v);
  }
  if (scope === 'item') {
    if (key === 'price') v = Math.max(0, Math.round(v));
    if (['width', 'depth'].includes(key)) v = Math.max(1, v);
    if (key === 'height') v = Math.max(0, v);
    if (key === 'rotation') v = normAngle(v);
    // ダイニングテーブルの位置・向きを数値で変えたときも、つながった椅子を一緒に動かす
    if (['x', 'y', 'rotation'].includes(key)) {
      const before = poseOf(obj);
      obj[key] = v;
      followTable(obj, before);
      return;
    }
    // つながりをオンにしたら、まわりにある椅子をつなげる
    if (key === 'chairsAttached' && v) {
      obj.chairsAttached = true;
      const n = attachNearbyChairs(obj);
      toast(n ? `まわりの椅子${n}脚をテーブルにつなげました。テーブルを動かすと一緒に動きます` : 'テーブルのまわり（60cm 以内）に椅子がありません。椅子を近くに置いてから、もう一度オンにしてください');
      return;
    }
  }
  if (scope === 'room' && (key === 'area' || key === 'jo')) {
    const m2 = key === 'jo' ? v * M2_PER_JO : v;
    if (m2 >= 1) scaleRoomToArea(state.project, m2);
    return;
  }
  if (scope === 'room' && ['width', 'depth'].includes(key)) v = Math.max(50, v);
  if (scope === 'settings' && key === 'wallThickness') {
    // 描く壁の厚み（3〜50cm）。次に開いたときも同じ厚みにする
    v = Math.min(50, Math.max(3, Math.round(v)));
    try { localStorage.setItem('afp:opt:wallThickness', String(v)); } catch { /* 保存できない環境 */ }
  }
  if (scope === 'wall' && ['w', 'h'].includes(key)) v = Math.max(2, v);
  if (scope === 'wall' && key === 'length') { A.resizeWall(state.project, obj, v, state.settings.wallMoveConnected !== false); return; }
  if (scope === 'wall' && key === 'thickness') { A.setWallThickness(obj, v); return; }
  if (scope === 'bg' && key === 'width') {
    v = Math.max(20, v);
    obj.height = v * obj.naturalHeight / obj.naturalWidth;
    if (state.project.scale?.status !== 'unset') state.project.scale = { status: 'unset', cmPerPx: null };
  }
  if (scope === 'bg' && key === 'opacity') v = Math.min(1, Math.max(0.05, v / 100));
  // 部屋の幅・奥行きを手で変えたら、画像の範囲への追従はやめる
  if (scope === 'room' && ['width', 'depth', 'x', 'y'].includes(key)) delete obj.followImage;
  if (scope === 'op' && key === 'style' && v !== doorStyle(obj)) {
    // 名前が開き方のままなら、新しい開き方の名前に変える
    if (obj.label === DOOR_STYLE_LABELS[doorStyle(obj)] || obj.label === OPENING_LABELS.door) obj.label = DOOR_STYLE_LABELS[v];
  }
  // ドアの幅を手で直したら、図面からの推定ではなく確かめた幅として扱う（搬入チェック用）
  if (scope === 'op' && key === 'width') obj.measured = true;
  if (scope === 'op' && key === 'type' && v !== obj.type) {
    if (obj.label === OPENING_LABELS[obj.type]) obj.label = OPENING_LABELS[v];
    if (v === 'window' && !obj.sill) obj.sill = 'high';
  }
  obj[key] = v;
  if (scope === 'bg') syncRoomToImage(state.project);
  if (scope === 'op') clampOpening(state.project.room, obj);
  if (scope === 'room') for (const op of state.project.openings) clampOpening(obj, op);
}

/** 部屋（と背景画像・開口部）を、広さが m2 になるよう縦横比を保って拡大縮小する */
function scaleRoomToArea(p, m2) {
  const r = p.room;
  const f = Math.sqrt((m2 * 10000) / (r.width * r.depth));
  if (!Number.isFinite(f) || Math.abs(f - 1) < 1e-4) return;
  r.width = Math.round(r.width * f * 10) / 10;
  r.depth = Math.round(r.depth * f * 10) / 10;
  for (const op of p.openings) {
    op.offset = Math.round(op.offset * f);
    if (p.background) op.width = Math.round(op.width * f);
    clampOpening(r, op);
  }
  const bg = p.background;
  if (bg) {
    bg.x = r.x + (bg.x - r.x) * f;
    bg.y = r.y + (bg.y - r.y) * f;
    bg.width *= f;
    bg.height *= f;
    p.scale = { status: 'set', cmPerPx: bg.width / bg.naturalWidth, reference: { areaM2: m2, method: 'area' } };
  }
}

function panelKey() {
  const p = state.project, s = state.selection;
  return [s?.kind, s?.id, selectedIds().join(), selectedIds().map(id => getItem(id)?.locked).join(), p.activeLayoutId, p.openings.length, (p.walls || []).length, (p.areas || []).map(a => a.id + a.label).join(), p.openings.map(o => o.type + o.wall).join(), p.layouts.length,
    !!p.background, p.background?.visible, state.mode, p.scale?.status, p.isSample,
    s?.kind === 'furniture' ? getItem(s.id)?.locked : '', s?.kind === 'opening' ? getOpening(s.id)?.type : ''].join('|');
}

export function initPropsPanel(el) {
  propsEl = el;
  const isDiscrete = t => t.type === 'checkbox' || t.tagName === 'SELECT';
  el.addEventListener('focusin', e => { if (e.target.dataset.bind && !isDiscrete(e.target)) beginTransaction(); });
  el.addEventListener('input', e => {
    const b = e.target.dataset.bind;
    if (!b || e.target.type === 'checkbox' || e.target.tagName === 'SELECT' || e.target.dataset.commit === 'change') return;
    if (e.target.type === 'range' || e.target.type === 'color') beginTransaction();
    writeValue(b, e.target);
    emit('input');
  });
  el.addEventListener('change', e => {
    if (e.target.dataset.areaLabel) {
      const id = e.target.dataset.areaLabel, v = e.target.value.trim() || '部屋';
      commit(p => { const a = p.areas.find(x => x.id === id); if (a) a.label = v; });
      return;
    }
    const b = e.target.dataset.bind;
    if (!b) return;
    if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') {
      commit(() => writeValue(b, e.target));
      return;
    }
    if (!inTransaction()) { commit(() => writeValue(b, e.target)); return; }
    writeValue(b, e.target);
    endTransaction();
  });
  el.addEventListener('focusout', e => { if (e.target.dataset.bind && !isDiscrete(e.target)) endTransaction(); });
  el.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act, arg = btn.dataset.arg;
    switch (act) {
      case 'rotate': A.rotateSelected(Number(arg)); break;
      case 'flip': A.flipSelected(); break;
      case 'duplicate': A.duplicateSelected(); break;
      case 'lock-all': A.setLockedSelected(true); break;
      case 'unlock-all': A.setLockedSelected(false); break;
      case 'delete': A.deleteSelected(); break;
      case 'front': A.reorderSelected(true); break;
      case 'back': A.reorderSelected(false); break;
      case 'color': {
        const f = getItem(state.selection.id);
        commit(() => { f.color = arg; });
        break;
      }
      case 'add-opening': A.addOpening(arg); break;
      case 'flip-side': { const op = getOpening(state.selection.id); commit(() => { op.side = op.side === -1 ? 1 : -1; }); break; }
      case 'rotate-opening': { const op = getOpening(state.selection.id); commit(() => { op.orient = op.orient === 'v' ? 'h' : 'v'; }); break; }
      case 'add-wall': A.addWall(); break;
      case 'review-plan': openPlanReview(); break;
      case 'calibrate-plan': openCalibratePlan(); break;
      case 'clear-walls': A.clearWalls(); break;
      case 'rotate-wall': {
        const w = getWall(state.selection.id);
        commit(() => {
          const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
          [w.w, w.h] = [w.h, w.w];
          w.x = Math.round(cx - w.w / 2); w.y = Math.round(cy - w.h / 2);
        });
        break;
      }
      case 'del-area': commit(p => { p.areas = p.areas.filter(a => a.id !== arg); }); break;
      case 'select-opening': select({ kind: 'opening', id: arg }); break;
      case 'select-item': select({ kind: 'furniture', id: arg }); break;
      case 'mode': A.startMode(arg); break;
      case 'load-plan': document.getElementById('file-plan').click(); break;
      case 'auto-detect': autoDetectPlan(); break;
      case 'image-area':
        commit(p => { p.room.followImage = true; syncRoomToImage(p); });
        toast('画像全体を配置範囲にしました（壁・ドア・窓はそのまま残しています）');
        break;
      case 'remove-bg':
        commit(p => { p.background = null; });
        if (state.mode === 'bg' || state.mode === 'calibrate') A.endMode();
        toast('読み込んだ画像を削除しました（部屋の寸法・ドア・窓はそのまま。元に戻すで復元できます）');
        break;
      case 'dup-layout': A.duplicateLayout(); break;
      case 'new-layout': A.newEmptyLayout(); break;
      case 'del-layout': A.deleteLayout(); break;
      case 'deselect': select(null); break;
    }
  });
}

export function renderPropsPanel(validation) {
  validationRef = validation;
  const key = panelKey();
  if (key !== lastKey) {
    lastKey = key;
    propsEl.innerHTML = buildProps(validation);
  }
  // 値の同期（入力中の要素は上書きしない）
  propsEl.querySelectorAll('[data-bind]').forEach(inp => {
    if (inp === document.activeElement && inp.type !== 'checkbox') return;
    const [obj, k, scope] = resolve(inp.dataset.bind);
    if (!obj) return;
    if (inp.type === 'checkbox') inp.checked = k === 'visible' ? obj[k] !== false : !!obj[k];
    else if (scope === 'bg' && k === 'opacity') inp.value = Math.round((obj.opacity ?? 0.9) * 100);
    else inp.value = readValue(obj, k);
  });
  const issuesEl = propsEl.querySelector('#item-issues');
  if (issuesEl && state.selection?.kind === 'furniture') {
    const html = itemIssuesHTML(validation, state.selection.id);
    if (issuesEl.innerHTML !== html) issuesEl.innerHTML = html;
  }
}

function itemIssuesHTML(validation, id) {
  const list = validation?.issues.filter(i => i.itemIds.includes(id)) || [];
  if (!list.length) return '<div class="note">この家具に関する問題はありません。</div>';
  return list.map(i => `<div class="issue ${i.level}"><span class="lv">${i.level === 'error' ? '重要' : '注意'}</span><span>${escapeHtml(i.message)}</span></div>`).join('');
}

function buildProps(validation) {
  const sel = state.selection;
  if (sel?.kind === 'furniture') {
    const items = selectedIds().map(getItem).filter(Boolean);
    if (items.length > 1) return multiProps(items);
    const f = getItem(sel.id);
    if (f) return furnitureProps(f, validation);
  }
  if (sel?.kind === 'opening') {
    const op = getOpening(sel.id);
    if (op) return openingProps(op);
  }
  if (sel?.kind === 'wall') {
    const w = getWall(sel.id);
    if (w) return wallProps();
  }
  return roomProps();
}

/** 複数の家具を選んでいるとき：まとめて回転・反転・固定・複製・削除 */
function multiProps(items) {
  const locked = items.filter(f => f.locked).length;
  return `
  <div class="section">
    <div class="section-title"><h3>${items.length}個の家具を選択中</h3><button class="icon-btn" data-act="deselect" title="選択を解除">✕</button></div>
    <div class="list">${items.map(f => `<div class="list-item" style="cursor:default"><span class="grow">${escapeHtml(f.name)}${f.locked ? ' <span class="muted">（固定）</span>' : ''}</span></div>`).join('')}</div>
    <p class="muted" style="margin:0">選んだ家具のどれかをドラッグすると、まとめて動きます。矢印キーでも動かせます。Shift＋クリックで追加・解除、Shift＋何もない所をドラッグで範囲選択。</p>
    <div class="field">まとめて回転（並びを保ったまま）
      <div class="btn-row">
        <button data-act="rotate" data-arg="-90" title="左に90°">⟲ 90°</button>
        <button data-act="rotate" data-arg="90" title="右に90°">90° ⟳</button>
        <button data-act="flip" title="それぞれの家具の形の左右を入れ替えます">⇋ 左右反転</button>
      </div>
    </div>
    <div class="btn-row">
      <button data-act="lock-all" ${locked === items.length ? 'disabled' : ''}>すべて固定</button>
      <button data-act="unlock-all" ${locked === 0 ? 'disabled' : ''}>固定を解除</button>
    </div>
    <div class="btn-row">
      <button data-act="duplicate">まとめて複製</button>
      <button data-act="delete" class="danger">まとめて削除</button>
    </div>
    ${locked ? `<p class="muted" style="margin:0">固定した家具（${locked}個）は、回転・反転・移動では動きません。</p>` : ''}
  </div>`;
}

function furnitureProps(f, validation) {
  const spec = getSpec(f.type);
  const cat = CATEGORIES.find(c => c.id === spec.category)?.label || '';
  const dis = f.locked ? 'disabled' : '';
  return `
  <div class="section">
    <div class="section-title"><h3>選択中の家具</h3><button class="icon-btn" data-act="deselect" title="選択を解除">✕</button></div>
    <div class="row tight" style="align-items:center">${previewSVG({ ...spec, width: f.width, depth: f.depth, color: f.color }, 44)}<span class="muted">${escapeHtml(cat)}</span></div>
    ${field('家具名', 'item.name', { type: 'text', attrs: 'maxlength="40"' })}
    <div class="grid3">
      ${field('幅', 'item.width', { unit: 'cm', min: 1, attrs: dis })}
      ${field('奥行き', 'item.depth', { unit: 'cm', min: 1, attrs: dis })}
      ${field('高さ', 'item.height', { unit: 'cm', min: 0 })}
    </div>
    <div class="grid2">
      ${field('X座標（中心）', 'item.x', { unit: 'cm', attrs: dis })}
      ${field('Y座標（中心）', 'item.y', { unit: 'cm', attrs: dis })}
    </div>
    <div class="field">回転角度
      <div class="row">
        <span class="unit" data-unit="°"><input type="number" data-bind="item.rotation" step="1" ${dis}></span>
      </div>
      <div class="btn-row">
        <button data-act="rotate" data-arg="-90" ${dis} title="左に90°">⟲ 90°</button>
        <button data-act="rotate" data-arg="-15" ${dis} title="左に15°">⟲ 15°</button>
        <button data-act="rotate" data-arg="15" ${dis} title="右に15°">15° ⟳</button>
        <button data-act="rotate" data-arg="90" ${dis} title="右に90°">90° ⟳</button>
      </div>
      <div class="btn-row"><button data-act="flip" ${dis} title="形の左右を入れ替えます（ナイトテーブルの側、L字ソファの向きなど）">⇋ 左右反転</button></div>
    </div>
    <div class="field">色
      <div class="row tight" style="align-items:center">
        <input type="color" data-bind="item.color">
        <div class="swatches">${SWATCHES.map(c => `<button class="swatch" style="background:${c}" data-act="color" data-arg="${c}" title="${c}" aria-label="色 ${c}"></button>`).join('')}</div>
      </div>
    </div>
    <label class="check"><input type="checkbox" data-bind="item.locked"> 位置を固定する（ドラッグやAI提案で動かさない）</label>
    <div class="grid2" style="align-items:end">
      ${field('値段（1つあたり）', 'item.price', { unit: '円', min: 0, step: 100 })}
      <label class="check"><input type="checkbox" data-bind="item.purchased"> 購入済み・持っている</label>
    </div>
    ${isDiningTable(f) ? `<label class="check"><input type="checkbox" data-bind="item.chairsAttached"> 椅子をテーブルにつなげる（テーブルを動かす・回す・複製・削除すると椅子も一緒に）</label>` : ''}
    <div class="btn-row">
      <button data-act="duplicate">複製</button>
      <button data-act="delete" class="danger">削除</button>
    </div>
    <div class="btn-row">
      <button data-act="front" title="重なったときに上に表示">前面へ</button>
      <button data-act="back" title="重なったときに下に表示">背面へ</button>
    </div>
  </div>
  <div class="section">
    <h3>この家具のチェック</h3>
    <div id="item-issues">${itemIssuesHTML(validation, f.id)}</div>
  </div>
  <p class="muted">ショートカット：<kbd>R</kbd> 90°回転 / <kbd>Ctrl</kbd>+<kbd>D</kbd> 複製 / <kbd>Delete</kbd> 削除 / 矢印キーで1cm移動（<kbd>Shift</kbd>で10cm）/ ドラッグ中に <kbd>Alt</kbd> でスナップ解除</p>`;
}

function wallProps() {
  const w = getWall(state.selection.id);
  const horiz = w && w.w >= w.h;
  return `
  <div class="section">
    <div class="section-title"><h3>壁の設定</h3><button class="icon-btn" data-act="deselect" title="選択を解除">✕</button></div>
    <p class="muted" style="margin:0">${horiz ? '横向き' : '縦向き'}の壁です。長さを変えると${horiz ? '右端' : '下端'}が動きます（${horiz ? '左端' : '上端'}はそのまま）。</p>
    <div class="grid2">
      ${field('長さ', 'wall.length', { unit: 'cm', min: 5, attrs: 'data-commit="change" title="入力して Enter かほかの所をクリックで反映"' })}
      ${field('厚み', 'wall.thickness', { unit: 'cm', min: 2, attrs: 'data-commit="change"' })}
    </div>
    <label class="check"><input type="checkbox" data-bind="settings.wallMoveConnected"> ${horiz ? '右端' : '下端'}につながった壁（とそこのドア・窓）も一緒に動かす</label>
    <details><summary class="muted">細かい位置（左上の角と縦横の大きさ）</summary>
    <div class="grid2">
      ${field('左端 X', 'wall.x', { unit: 'cm' })}
      ${field('上端 Y', 'wall.y', { unit: 'cm' })}
      ${field('横の長さ', 'wall.w', { unit: 'cm', min: 2 })}
      ${field('縦の長さ', 'wall.h', { unit: 'cm', min: 2 })}
    </div></details>
    <div class="btn-row">
      <button data-act="rotate-wall">向きを90°回転</button>
      <button data-act="delete" class="danger">この壁を削除</button>
    </div>
    <p class="muted">壁はドラッグで移動できます。家具が壁と重なると「チェック」に表示され、通路の判定でも壁は通れないものとして扱います。</p>
  </div>`;
}

function openingProps(op) {
  const wallOpts = Object.entries(WALL_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  return `
  <div class="section">
    <div class="section-title"><h3>${OPENING_LABELS[op.type]}の設定</h3><button class="icon-btn" data-act="deselect" title="選択を解除">✕</button></div>
    ${field('名前', 'op.label', { type: 'text', attrs: 'maxlength="20"' })}
    <label class="field">種類
      <select data-bind="op.type"><option value="door">ドア</option><option value="window">窓</option><option value="closet">収納扉</option></select>
    </label>
    ${op.wall === 'free' ? `
    <div class="grid3">
      ${field('中心 X', 'op.x', { unit: 'cm' })}
      ${field('中心 Y', 'op.y', { unit: 'cm' })}
      ${field('幅', 'op.width', { unit: 'cm', min: 30 })}
    </div>
    <div class="btn-row">
      <button data-act="flip-side">${op.type === 'door' ? '開く向きを反転' : '内側・外側を反転'}</button>
      <button data-act="rotate-opening">向きを90°回転</button>
    </div>` : `
    <label class="field">位置する壁<select data-bind="op.wall">${wallOpts}</select></label>
    <div class="grid2">
      ${field('壁の端からの距離', 'op.offset', { unit: 'cm', min: 0 })}
      ${field('幅', 'op.width', { unit: 'cm', min: 30 })}
    </div>`}
    ${op.type === 'door' ? `<label class="field">ドアの開き方
      <select data-bind="op.style">${Object.entries(DOOR_STYLE_LABELS).map(([k, v]) => `<option value="${k}" ${doorStyle(op) === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
    ${op.type === 'door' && doorStyle(op) !== 'sliding' ? `<label class="field">${doorStyle(op) === 'folding' ? '固定側（たたむ側）' : '吊り元（ヒンジ）'}の位置
      <select data-bind="op.hinge"><option value="start">左／上側</option><option value="end">右／下側</option></select></label>` : ''}
    ${op.type === 'window' ? `<label class="field">窓の種類
      <select data-bind="op.sill"><option value="floor">掃き出し窓（床まである）</option><option value="high">腰窓（床から約90cm）</option></select></label>` : ''}
    <p class="muted">${op.wall === 'free' ? 'ドラッグで動かすと、近くの壁の向きに合わせて置き直されます。' : '距離は、上下の壁は左端から、左右の壁は上端から測ります。キャンバス上でドラッグして壁に沿って動かせます。'}</p>
    <div class="btn-row"><button data-act="delete" class="danger">この${OPENING_LABELS[op.type]}を削除</button></div>
  </div>`;
}

function roomProps() {
  const p = state.project;
  const bg = p.background;
  const sc = scaleStatusText(p);
  const ops = p.openings.map(o => `<button class="list-item" data-act="select-opening" data-arg="${o.id}">
      <span class="dot" style="background:${o.type === 'door' ? '#d07a2a' : o.type === 'window' ? '#3b82c4' : '#7a68b8'}"></span>
      <span class="grow">${escapeHtml(o.label || OPENING_LABELS[o.type])}</span>
      <span class="muted">${WALL_LABELS[o.wall]}・${Math.round(o.width)}cm</span></button>`).join('');
  const modeBtn = (mode, label) => `<button data-act="mode" data-arg="${mode}" class="${state.mode === mode ? 'active' : ''}">${label}</button>`;
  return `
  ${p.isSample ? '<div class="note info">これは<strong>サンプルの間取り</strong>です。部屋の寸法・ドア・窓の位置は説明用の架空のデータです。</div>' : ''}
  ${p.room.followImage ? '<div class="note info">間取り図の画像を<strong>下絵</strong>として使っています。画像全体が配置範囲です。家具を置いたり「＋ 壁」「＋ ドア」「＋ 窓」で画像をなぞったりできます。</div>' : ''}
  <div class="section">
    <h3>部屋</h3>
    ${field('部屋の名前', 'room.label', { type: 'text', attrs: 'maxlength="30"' })}
    <div class="grid2">
      ${field('横幅', 'room.width', { unit: 'cm', min: 50 })}
      ${field('奥行き', 'room.depth', { unit: 'cm', min: 50 })}
    </div>
    <div class="grid2">
      ${field('広さ', 'room.area', { unit: '㎡', step: 0.1, min: 1, attrs: 'data-commit="change"' })}
      ${field('畳数', 'room.jo', { unit: '畳', step: 0.1, min: 1, attrs: 'data-commit="change"' })}
    </div>
    <p class="muted" style="margin:0">広さ（㎡・畳）を入力すると、縦横比を保ったまま部屋${p.background ? 'と間取り図' : ''}の大きさを合わせます（1畳＝${M2_PER_JO}㎡）。</p>
    <div class="btn-row">${modeBtn('room', '部屋の輪郭をドラッグで描く')}</div>
    <div class="btn-row"><button data-act="calibrate-plan" title="内見で測った長さ・ドアの幅を入れて、間取りを実寸に合わせ直します">📐 実寸で合わせる（測った寸法を入力）</button></div>
    <p class="muted">家具の位置・サイズはすべて実寸（cm）で管理しています。</p>
  </div>
  <div class="section">
    <div class="section-title"><h3>壁と部屋の区切り</h3></div>
    ${(p.areas || []).length ? `<div class="list">${p.areas.map(a => `<div class="list-item" style="cursor:default">
        <input type="text" data-area-label="${a.id}" value="${escapeHtml(a.label)}" maxlength="20" style="width:7em" aria-label="部屋の名前">
        <span class="grow muted">${Math.round(a.width)}×${Math.round(a.depth)}cm・約${(a.width * a.depth / 10000 / M2_PER_JO).toFixed(1)}畳</span>
        <button class="icon-btn" data-act="del-area" data-arg="${a.id}" title="この区切りを削除" aria-label="削除">✕</button></div>`).join('')}</div>`
      : '<p class="muted" style="margin:0">間取り図を読み込んで「間取り全体」で作成すると、黒い壁と部屋の区切りが作られます。</p>'}
    <p class="muted" style="margin:0">内壁 ${(p.walls || []).length}個。「壁を消す」で通路にしたい所の壁をドラッグして消せます。壁をクリックで選択・ドラッグで移動、Delete キーで削除。</p>
    <div class="btn-row">
      <button data-act="mode" data-arg="draw-wall" class="${state.mode === 'draw-wall' ? 'active primary' : 'primary'}" title="クリックで壁を引きます（W キー）">✏ 壁を描く</button>
      <button data-act="mode" data-arg="draw-area" class="${state.mode === 'draw-area' ? 'active' : ''}" title="壁に囲まれた所をクリックして、名前付きの部屋（区切り）にします">▭ 部屋を描く</button>
      ${field('描く壁の厚み', 'settings.wallThickness', { unit: 'cm', min: 3 })}
    </div>
    <div class="btn-row">
      <button data-act="mode" data-arg="erase" class="${state.mode === 'erase' ? 'active' : ''}">壁を消す（消しゴム）</button>
      <button data-act="mode" data-arg="place-door" class="${state.mode === 'place-door' ? 'active' : ''}">＋ ドア</button>
      <button data-act="mode" data-arg="place-window" class="${state.mode === 'place-window' ? 'active' : ''}">＋ 窓</button>
    </div>
    ${(p.areas || []).length || p.openings.some(o => /（自動/.test(o.label || '')) ? `<div class="btn-row"><button data-act="review-plan">認識結果を確認・修正</button></div>` : ''}
    <div class="btn-row">
      <button data-act="add-wall">＋ 壁</button>
      <button data-act="clear-walls" class="danger" ${(p.walls || []).length || (p.areas || []).length ? '' : 'disabled'}>壁をすべて削除</button>
    </div>
  </div>
  <div class="section">
    <div class="section-title"><h3>ドア・窓・収納</h3></div>
    ${p.openings.length ? `<div class="list">${ops}</div>` : '<div class="note warn">ドアや窓が未設定です。位置が分かる場合は追加してください（AI提案と動線チェックに使います）。</div>'}
    <div class="btn-row">
      <button data-act="mode" data-arg="place-door" class="${state.mode === 'place-door' ? 'active' : ''}">＋ ドアを置く</button>
      <button data-act="mode" data-arg="place-window" class="${state.mode === 'place-window' ? 'active' : ''}">＋ 窓を置く</button>
      <button data-act="add-opening" data-arg="closet">＋ 収納扉</button>
    </div>
    <div class="btn-row">
      <button data-act="mode" data-arg="place-sliding" class="${state.mode === 'place-sliding' ? 'active' : ''}">＋ 引き戸を置く</button>
      <button data-act="mode" data-arg="place-folding" class="${state.mode === 'place-folding' ? 'active' : ''}">＋ 折れ戸を置く</button>
    </div>
  </div>
  <div class="section">
    <h3>間取り図（背景画像）</h3>
    ${bg ? `
      <div class="note ${sc.ok ? '' : 'warn'}">${escapeHtml(sc.text)}${sc.ok ? '' : '<br>「縮尺を設定」で、長さが分かる壁の両端をクリックし実寸を入力してください。'}</div>
      <div class="btn-row"><button data-act="auto-detect" class="accent-outline">間取りを自動認識</button><button data-act="image-area" ${p.room.followImage ? 'disabled' : ''} title="画像全体を家具の配置範囲にする">画像全体を配置範囲に</button></div>
      <div class="btn-row">
        ${modeBtn('calibrate', '縮尺を設定')}
        ${modeBtn('bg', '位置・大きさを調整')}
      </div>
      <label class="check"><input type="checkbox" data-bind="bg.visible"> 背景画像を表示</label>
      <label class="field">不透明度<input type="range" min="5" max="100" step="5" data-bind="bg.opacity"></label>
      <div class="grid3">
        ${field('X', 'bg.x', { unit: 'cm' })}
        ${field('Y', 'bg.y', { unit: 'cm' })}
        ${field('表示幅', 'bg.width', { unit: 'cm', min: 20 })}
      </div>
      <p class="muted">背景画像は家具とは別のレイヤーです。「位置・大きさを調整」中のみ動かせます。</p>
      <div class="btn-row"><button data-act="load-plan">別の画像を読み込む</button><button data-act="remove-bg" class="danger">読み込んだ画像を削除</button></div>
    ` : `
      <p class="muted">PNG / JPG / JPEG / PDF（1ページ目）の間取り図を読み込めます。</p>
      <div class="btn-row"><button data-act="load-plan" class="accent-outline">間取りを読み込む</button></div>
    `}
  </div>
  <div class="section">
    <h3>レイアウト（配置パターン）</h3>
    ${field('レイアウト名', 'layout.name', { type: 'text', attrs: 'maxlength="40"' })}
    <div class="btn-row">
      <button data-act="dup-layout" title="現在の配置をコピーして別パターンを作る">複製</button>
      <button data-act="new-layout" title="固定家具だけの新しいレイアウト">新規</button>
      <button data-act="del-layout" class="danger" ${p.layouts.length <= 1 ? 'disabled' : ''}>削除</button>
    </div>
    <p class="muted">キャンバス左上で切り替えられます（${p.layouts.length}件）。</p>
  </div>
  <div class="section">
    <h3>操作のヒント</h3>
    <ul class="muted" style="margin:0;padding-left:18px;line-height:1.7">
      <li>左の家具をクリック（またはドラッグ）で追加</li>
      <li>家具をドラッグで移動、四隅・辺のハンドルでサイズ変更、上の丸ハンドルで回転</li>
      <li>何もない所をドラッグで画面移動、ホイールでズーム</li>
      <li>右上「AI提案」タブで配置案を3パターン作成</li>
    </ul>
  </div>`;
}

// ---------------------------------------------------------------------------
// チェックパネル
// ---------------------------------------------------------------------------
export function initCheckPanel(el) {
  el.addEventListener('click', e => {
    const it = e.target.closest('[data-item]');
    if (it && !state.preview) select({ kind: 'furniture', id: it.dataset.item });
  });
}

export function renderCheckPanel(el, validation, isPreview) {
  const issues = validation?.issues || [];
  const room = state.project.room;
  const area = room.width * room.depth / 10000;
  const free = validation?.freeRatio != null ? `${(area * validation.freeRatio).toFixed(1)}㎡（${Math.round(validation.freeRatio * 100)}%）` : '—';
  el.innerHTML = `
    ${isPreview ? '<div class="note info">プレビュー中の提案をチェックしています。</div>' : ''}
    <div class="section">
      <h3>レイアウトチェック</h3>
      <div class="grid2">
        <div class="note">部屋の広さ<br><strong>${area.toFixed(1)}㎡（約${(area / 1.62).toFixed(1)}畳）</strong></div>
        <div class="note">歩ける床（幅50cm以上）<br><strong>${free}</strong></div>
      </div>
      ${issues.length ? '' : '<div class="note" style="background:#edf7f0;color:#276749">問題は見つかりませんでした。</div>'}
      <div class="list">
        ${issues.map(i => `<div class="issue ${i.level}" ${i.itemIds[0] ? `data-item="${i.itemIds[0]}"` : ''}>
          <span class="lv">${i.level === 'error' ? '重要' : i.level === 'warn' ? '注意' : '情報'}</span><span>${escapeHtml(i.message)}</span></div>`).join('')}
      </div>
    </div>
    <div class="section">
      <h3>チェック内容</h3>
      <ul class="muted" style="margin:0;padding-left:18px;line-height:1.7">
        <li>部屋からのはみ出し</li>
        <li>家具同士の重なり（ラグの上の家具、テーブルとチェア、天井照明などは許容）</li>
        <li>ドアの開閉範囲・収納扉の前（約70cm）・窓の前</li>
        <li>ソファの前・ベッドの横・収納の前など「使うためのスペース」</li>
        <li>入口ドアから幅50cm以上の通路でたどり着けるか（「通路表示」で緑色に表示）</li>
        <li>搬入：玄関と置く部屋のドアを、いちばん薄い向きにして通るか（ドアの有効幅・高さ約200cmで判定）</li>
      </ul>
    </div>`;
}
