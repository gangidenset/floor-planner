// マイ家具：自分の家具や買いたい商品を、名前・大きさ・メモ（お店のURLなど）付きで登録してライブラリから置けるようにする。
// 登録はこのブラウザに保存し（すべての間取りで使える）、バックアップファイルにも入る。
import { modal, toast } from './ui.js';
import { uid, escapeHtml } from './geometry.js';
import { getSpec, registerCustomSpecs, unregisterCustomSpec, LIBRARY } from './data/furniture-library.js';
import { previewSVG } from './furniture.js';

const KEY = 'afp:customFurniture';

// 形のもとにする家具（見た目・配置のルールを引き継ぐ）
export const BASES = [
  ['chest', '箱・チェスト'], ['shelf', '棚・本棚'], ['shelf-low', 'ローボード'], ['wardrobe', 'ワードローブ'],
  ['sofa-2', 'ソファ'], ['sofa-1', '1人掛けソファ'], ['sofa-l', 'L字ソファ'], ['beanbag-mini', 'クッション・ビーズソファ'],
  ['table-4', 'テーブル'], ['table-round', '丸テーブル'], ['center-table', 'ローテーブル'], ['desk', 'デスク'],
  ['chair', '椅子'], ['desk-chair', 'デスクチェア'], ['bed-single', 'ベッド'], ['tv-board', 'テレビボード'], ['tv', 'テレビ'],
  ['rug', 'ラグ'], ['plant-l', '観葉植物'], ['floor-lamp', 'フロアランプ'], ['fridge', '冷蔵庫'], ['washer', '洗濯機'],
];

export function loadCustomFurniture() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(list)) registerCustomSpecs(list);
    return list;
  } catch {
    return [];
  }
}

function saveList(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { toast('ブラウザの保存容量が足りず、マイ家具を保存できませんでした', 'error'); }
}

export const customList = () => LIBRARY.filter(s => s.custom);

/** バックアップ用：登録したマイ家具の定義 */
export function exportCustomFurniture() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

/** バックアップから戻す（同じ家具は上書き） */
export function importCustomFurniture(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  const cur = exportCustomFurniture().filter(c => !list.some(n => n.type === c.type));
  const all = [...cur, ...list.filter(s => s?.custom && s.type)];
  saveList(all);
  registerCustomSpecs(all);
  return list.length;
}

const num = text => {
  const s = String(text ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[．。]/g, '.').replace(/[,，]/g, '').replace(/cm|ｃｍ/gi, '').trim();
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * マイ家具を登録・編集する。type を渡すとその家具の編集（削除もできる）。
 * 戻り値: 保存・削除したら true
 */
export async function editCustomFurniture(type = null) {
  const cur = type ? getSpec(type) : null;
  const base0 = cur?.base || 'chest';
  const res = await modal({
    title: cur ? 'マイ家具の編集' : 'マイ家具を登録',
    body: `
      <p style="margin:0">持っている家具や、買いたい商品の大きさを登録すると、家具ライブラリの「マイ家具」から置けます（すべての間取りで使えます）。</p>
      <label class="field">名前<input type="text" id="cf-name" maxlength="40" value="${escapeHtml(cur?.name || '')}" placeholder="例 実家から持ってくる本棚、○○のソファ"></label>
      <label class="field">形（見た目と配置ルールのもとにする家具）
        <select id="cf-base">${BASES.map(([t, l]) => `<option value="${t}" ${t === base0 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="grid3">
        <label class="field">幅<span class="unit" data-unit="cm"><input type="text" inputmode="decimal" id="cf-w" value="${cur ? cur.width : ''}" placeholder="例 120"></span></label>
        <label class="field">奥行き<span class="unit" data-unit="cm"><input type="text" inputmode="decimal" id="cf-d" value="${cur ? cur.depth : ''}" placeholder="例 40"></span></label>
        <label class="field">高さ<span class="unit" data-unit="cm"><input type="text" inputmode="decimal" id="cf-h" value="${cur ? cur.height : ''}" placeholder="例 180"></span></label>
      </div>
      <div class="row" style="align-items:center;gap:10px">
        <label class="field" style="margin:0">色 <input type="color" id="cf-color" value="${cur?.color || getSpec(base0).color}"></label>
        <span id="cf-preview"></span>
      </div>
      <label class="field">値段<span class="unit" data-unit="円"><input type="text" inputmode="numeric" id="cf-price" value="${cur?.price || ''}" placeholder="分かる場合のみ（家具リストの合計に使います）"></span></label>
      <label class="field">メモ（色・サイズ違い・買う予定など）<input type="text" id="cf-note" maxlength="100" value="${escapeHtml(cur?.note || '')}"></label>
      <label class="field">お店のページ（URL）<input type="url" id="cf-url" maxlength="500" value="${escapeHtml(cur?.url || '')}" placeholder="https://…"></label>`,
    buttons: [
      ...(cur ? [{ label: '削除', value: 'delete', danger: true }] : []),
      { label: 'キャンセル', value: null },
      { label: cur ? '保存' : '登録', value: 'ok', primary: true },
    ],
    onMount: body => {
      const preview = () => {
        const b = getSpec(body.querySelector('#cf-base').value);
        const w = num(body.querySelector('#cf-w').value) || b.width, d = num(body.querySelector('#cf-d').value) || b.depth;
        body.querySelector('#cf-preview').innerHTML = previewSVG({ ...b, width: w, depth: d, color: body.querySelector('#cf-color').value }, 56);
      };
      body.querySelector('#cf-base').addEventListener('change', e => {
        if (!cur) body.querySelector('#cf-color').value = getSpec(e.target.value).color;
        preview();
      });
      ['#cf-w', '#cf-d', '#cf-color'].forEach(s => body.querySelector(s).addEventListener('input', preview));
      preview();
    },
    beforeClose: (value, body) => {
      if (value !== 'ok') return true;
      const ok = body.querySelector('#cf-name').value.trim() && num(body.querySelector('#cf-w').value) && num(body.querySelector('#cf-d').value);
      if (!ok) toast('名前・幅・奥行きを入れてください', 'error');
      return !!ok;
    },
    collect: body => ({
      name: body.querySelector('#cf-name').value.trim(),
      base: body.querySelector('#cf-base').value,
      width: num(body.querySelector('#cf-w').value), depth: num(body.querySelector('#cf-d').value), height: num(body.querySelector('#cf-h').value),
      color: body.querySelector('#cf-color').value,
      note: body.querySelector('#cf-note').value.trim(),
      price: num(body.querySelector('#cf-price').value),
      url: body.querySelector('#cf-url').value.trim(),
    }),
  });
  if (!res.value) return false;
  const list = exportCustomFurniture();
  if (res.value === 'delete') {
    saveList(list.filter(s => s.type !== type));
    unregisterCustomSpec(type);
    toast(`「${cur.name}」をマイ家具から外しました（置いてある家具はそのまま残ります）`, 'ok');
    return true;
  }
  const d = res.data;
  const base = getSpec(d.base);
  const spec = {
    ...base,
    type: cur?.type || uid('custom'),
    category: 'custom', custom: true, base: d.base,
    name: d.name, width: Math.round(d.width), depth: Math.round(d.depth), height: Math.round(d.height || base.height),
    color: d.color, note: d.note, url: /^https?:\/\//.test(d.url) ? d.url : '', price: Math.round(d.price) || 0,
  };
  saveList([...list.filter(s => s.type !== spec.type), spec]);
  registerCustomSpecs([spec]);
  toast(cur ? `「${spec.name}」を保存しました` : `「${spec.name}」をマイ家具に登録しました。家具ライブラリのいちばん上から置けます`, 'ok', 5000);
  return true;
}
