// 保存・読み込み・書き出し（LocalStorage / JSON / PNG）
import { PROJECT_VERSION } from './data/sample-project.js';
import { LIBRARY_MAP, registerCustomSpecs } from './data/furniture-library.js';
import { exportSVG } from './render.js';
import { uid } from './geometry.js';
import { exportCustomFurniture, importCustomFurniture } from './custom-furniture.js';

const INDEX_KEY = 'afp:index';
const PROJECT_KEY = id => `afp:project:${id}`;
const LAST_KEY = 'afp:last';

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function listProjects() {
  return readIndex().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function saveProject(project) {
  const now = new Date().toISOString();
  const data = { ...project, updatedAt: now };
  try {
    localStorage.setItem(PROJECT_KEY(project.id), JSON.stringify(data));
  } catch (e) {
    throw new Error('ブラウザの保存容量が不足しています。背景画像を小さくするか、JSON書き出しで保存してください。');
  }
  const list = readIndex().filter(p => p.id !== project.id);
  list.push({ id: project.id, name: project.name, updatedAt: now, layouts: project.layouts.length });
  writeIndex(list);
  localStorage.setItem(LAST_KEY, project.id);
  return now;
}

export function loadProject(id) {
  const raw = localStorage.getItem(PROJECT_KEY(id));
  if (!raw) return null;
  return migrateProject(JSON.parse(raw));
}

export function deleteProject(id) {
  localStorage.removeItem(PROJECT_KEY(id));
  writeIndex(readIndex().filter(p => p.id !== id));
  if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
}

export function lastProjectId() {
  return localStorage.getItem(LAST_KEY);
}

/** 読み込んだデータの最低限の検証と補完 */
export function migrateProject(p) {
  if (!p || typeof p !== 'object' || !p.room || !Array.isArray(p.layouts)) {
    throw new Error('AI Floor Planner のプロジェクトファイルではありません');
  }
  p.version = p.version || PROJECT_VERSION;
  p.id = p.id || uid('project');
  p.name = p.name || '無題のプロジェクト';
  p.openings = Array.isArray(p.openings) ? p.openings : [];
  p.walls = Array.isArray(p.walls) ? p.walls : [];
  p.areas = Array.isArray(p.areas) ? p.areas : [];
  p.scale = p.scale || { status: 'unset', cmPerPx: null };
  p.assets = p.assets || {};
  if (!p.layouts.length) p.layouts.push({ id: uid('layout'), name: 'レイアウト1', furniture: [] });
  for (const l of p.layouts) {
    l.id = l.id || uid('layout');
    // マイ家具は、家具に持たせた定義をライブラリに戻してから読む（このブラウザに登録がなくても表示できるように）
    registerCustomSpecs((l.furniture || []).filter(f => f.customSpec && !LIBRARY_MAP[f.type]).map(f => f.customSpec), { listed: false });
    l.furniture = (l.furniture || []).filter(f => LIBRARY_MAP[f.type]).map(f => ({
      rotation: 0, locked: false, ...f,
      x: Number(f.x) || 0, y: Number(f.y) || 0,
      width: Math.max(1, Number(f.width) || 10), depth: Math.max(1, Number(f.depth) || 10), height: Number(f.height) || 0,
    }));
  }
  if (!p.layouts.some(l => l.id === p.activeLayoutId)) p.activeLayoutId = p.layouts[0].id;
  return p;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(name) {
  return (name || 'floorplan').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

export function exportProjectJSON(project) {
  const blob = new Blob([JSON.stringify({ ...project, exportedAt: new Date().toISOString(), app: 'AI Floor Planner' }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${safeName(project.name)}.json`);
}

export async function readProjectFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSONファイルを読み取れませんでした');
  }
  // すべてのプロジェクトをまとめたバックアップファイル
  if (data?.kind === 'backup' && Array.isArray(data.projects)) {
    const projects = data.projects.map(p => { try { return migrateProject(p); } catch { return null; } }).filter(Boolean);
    if (!projects.length) throw new Error('バックアップファイルにプロジェクトが入っていません');
    return { backup: true, projects, exportedAt: data.exportedAt, customFurniture: Array.isArray(data.customFurniture) ? data.customFurniture : [] };
  }
  return migrateProject(data);
}

// ---------------------------------------------------------------------------
// バックアップ（ブラウザに保存した全プロジェクトを1つのファイルに）
// ---------------------------------------------------------------------------
const BACKUP_KEY = 'afp:lastBackup';
const REMIND_KEY = 'afp:backupRemindedOn';

/** 最後にバックアップした日時（ISO）。一度もなければ null */
export function lastBackupAt() {
  try { return localStorage.getItem(BACKUP_KEY); } catch { return null; }
}

/**
 * ブラウザに保存した全プロジェクトを1つの JSON ファイルに書き出す。
 * current を渡すと、そのプロジェクトは保存前の今の状態で書き出す。戻り値は書き出した件数
 */
export function exportAllBackup(current) {
  const projects = [];
  for (const meta of listProjects()) {
    if (current && meta.id === current.id) continue;
    try { const raw = localStorage.getItem(PROJECT_KEY(meta.id)); if (raw) projects.push(JSON.parse(raw)); } catch { /* 壊れたデータは飛ばす */ }
  }
  if (current && !current.isSample) projects.unshift(current);
  const now = new Date();
  const blob = new Blob([JSON.stringify({ app: 'AI Floor Planner', kind: 'backup', exportedAt: now.toISOString(), projects, customFurniture: exportCustomFurniture() }, null, 2)], { type: 'application/json' });
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  downloadBlob(blob, `AI-Floor-Planner-バックアップ-${ymd}.json`);
  try { localStorage.setItem(BACKUP_KEY, now.toISOString()); } catch { /* 保存できない環境 */ }
  return projects.length;
}

/** バックアップの中のプロジェクトをブラウザに保存する（同じプロジェクトは上書き）。戻り値は保存した件数 */
export function restoreBackup(projects, customFurniture = []) {
  importCustomFurniture(customFurniture); // マイ家具も戻す
  let n = 0;
  for (const p of projects) {
    try { saveProject(p); n++; } catch { /* 容量不足などは飛ばす */ }
  }
  return n;
}

/**
 * バックアップを促すメッセージ（1日1回まで）。保存したプロジェクトがあり、
 * 一度もバックアップしていないか、最後のバックアップから7日以上たっていれば文面を返す
 */
export function backupReminder() {
  try {
    if (!listProjects().length) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(REMIND_KEY) === today) return null;
    const last = lastBackupAt();
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    if (days !== null && days < 7) return null;
    localStorage.setItem(REMIND_KEY, today);
    return days === null
      ? '間取りはこのブラウザの中にだけ保存されています。消えないように「その他」→「すべてをバックアップ」でファイルに保存しておきましょう'
      : `最後のバックアップから${days}日たっています。「その他」→「すべてをバックアップ」でファイルに保存しておきましょう`;
  } catch {
    return null;
  }
}

export async function exportPNG(project, furniture, options) {
  const { svg, width, height } = exportSVG(project, furniture, options);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('PNGの生成に失敗しました'));
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise(res => canvas.toBlob(res, 'image/png'));
    downloadBlob(png, `${safeName(project.name)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
