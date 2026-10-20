// アプリ状態とUndo/Redo
// project（保存対象のデータ）と UI 状態を分けて管理する。
// 背景画像などの大きなデータ（project.assets）は履歴スナップショットに含めない。

const MAX_HISTORY = 100;

const listeners = new Set();

export const state = {
  project: null,
  selection: null,          // { kind: 'furniture' | 'opening', id }
  preview: null,            // AI提案のプレビュー { proposal }
  proposals: [],            // AI提案の一覧
  mode: 'select',           // 'select' | 'calibrate' | 'room' | 'bg'
  settings: { grid: true, snap: true, gridSize: 10, dims: true, labels: true, showBg: true, issues: true, wallThickness: 12, wallMoveConnected: true }, // issues: チェックで問題のある家具を赤い点線で囲む、wallThickness: 描く壁の厚み（cm）
  dirty: false,
  savedAt: null,
};

const history = { past: [], future: [], pending: null };

function snapshot() {
  const { assets, ...rest } = state.project;
  return JSON.stringify(rest);
}

function restore(snap) {
  const assets = state.project.assets;
  state.project = { ...JSON.parse(snap), assets };
  // 選択対象が消えていたら解除
  if (state.selection && !findSelected()) state.selection = null;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason = 'change') {
  for (const fn of listeners) fn(reason);
}

export function setProject(project, { dirty = false } = {}) {
  state.project = project;
  state.selection = null;
  state.preview = null;
  state.proposals = [];
  state.mode = 'select';
  state.dirty = dirty;
  history.past = [];
  history.future = [];
  history.pending = null;
  emit('project');
}

export function activeLayout() {
  const p = state.project;
  return p.layouts.find(l => l.id === p.activeLayoutId) || p.layouts[0];
}

export function furnitureList() {
  return activeLayout().furniture;
}

export function getItem(id) {
  return furnitureList().find(f => f.id === id);
}

export function getOpening(id) {
  return state.project.openings.find(o => o.id === id);
}

export function getWall(id) {
  return (state.project.walls || []).find(w => w.id === id);
}

export function findSelected() {
  const s = state.selection;
  if (!s) return null;
  if (s.kind === 'wall') return getWall(s.id);
  if (s.kind === 'furniture') return getItem(s.id);
  if (s.kind === 'opening') return getOpening(s.id);
  return null;
}

/** 変更を1ステップとして記録して適用する */
export function commit(mutator, reason = 'change') {
  const before = snapshot();
  mutator(state.project);
  const after = snapshot();
  if (before !== after) {
    history.past.push(before);
    if (history.past.length > MAX_HISTORY) history.past.shift();
    history.future = [];
    state.dirty = true;
  }
  emit(reason);
}

/** ドラッグなど連続操作の開始（終了時に1ステップとして記録） */
export function beginTransaction() {
  if (!history.pending) history.pending = snapshot();
}

export function endTransaction() {
  if (!history.pending) return;
  const before = history.pending;
  history.pending = null;
  if (before !== snapshot()) {
    history.past.push(before);
    if (history.past.length > MAX_HISTORY) history.past.shift();
    history.future = [];
    state.dirty = true;
  }
  emit('change');
}

export function inTransaction() { return !!history.pending; }

export function canUndo() { return history.past.length > 0; }
export function canRedo() { return history.future.length > 0; }

export function undo() {
  if (!history.past.length) return;
  history.future.push(snapshot());
  restore(history.past.pop());
  state.dirty = true;
  emit('history');
}

export function redo() {
  if (!history.future.length) return;
  history.past.push(snapshot());
  restore(history.future.pop());
  state.dirty = true;
  emit('history');
}

/**
 * 選択する。家具は複数選べる：{ kind: 'furniture', id: 代表の家具, ids: [選んだ家具すべて] }（ids を省略すると1つだけ）
 */
export function select(sel) {
  state.selection = sel;
  emit('selection');
}

/** 選択中の家具の id（複数選択に対応。家具以外を選んでいるときは空） */
export function selectedIds() {
  const s = state.selection;
  if (s?.kind !== 'furniture') return [];
  return s.ids?.length ? s.ids : [s.id];
}

export function setMode(mode) {
  state.mode = mode;
  emit('mode');
}
