// 実寸で合わせる：内見などで測った長さ・ドアの幅を入れて、間取りを実際の寸法に合わせ直す
// - 長さ：部屋の横幅・奥行き、部屋（区切り）の横幅・奥行き、「📏 測る」で測った長さのどれかに実寸を入れると、
//   間取り全体（部屋・壁・区切り・ドア・窓・下絵の画像・家具の位置）をその比率で拡大縮小する。家具の大きさは変えない
// - ドアの幅：測った幅をそのまま入れる（搬入チェックで「確かめた幅」として扱う）
import { state, commit } from './state.js';
import { modal, toast } from './ui.js';
import { escapeHtml } from './geometry.js';
import { clampOpening, OPENING_LABELS } from './floorplan.js';
import { getLastMeasure } from './canvas.js';

const num = text => {
  const s = String(text ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[．。]/g, '.').replace(/[,，]/g, '').replace(/cm|ｃｍ/gi, '').trim();
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** 間取り全体を、部屋の左上を基準に f 倍する（壁の厚み・家具の大きさ・確かめたドア幅は変えない） */
export function scaleProject(p, f) {
  const r = p.room, ox = r.x, oy = r.y;
  const X = x => ox + (x - ox) * f, Y = y => oy + (y - oy) * f;
  const round = v => Math.round(v * 10) / 10;
  r.width = round(r.width * f);
  r.depth = round(r.depth * f);
  for (const w of p.walls || []) {
    if (w.w >= w.h) {
      const cy = Y(w.y + w.h / 2), len = w.w * f;
      Object.assign(w, { x: round(X(w.x + w.h / 2) - w.h / 2), y: round(cy - w.h / 2), w: round(len - w.h * (f - 1)) });
    } else {
      const cx = X(w.x + w.w / 2), len = w.h * f;
      Object.assign(w, { x: round(cx - w.w / 2), y: round(Y(w.y + w.w / 2) - w.w / 2), h: round(len - w.w * (f - 1)) });
    }
  }
  for (const a of p.areas || []) {
    Object.assign(a, { x: round(X(a.x)), y: round(Y(a.y)), width: round(a.width * f), depth: round(a.depth * f) });
    for (const op of a.openings || []) { op.offset = Math.round(op.offset * f); op.width = Math.round(op.width * f); }
  }
  for (const op of p.openings) {
    if (op.wall === 'free') { op.x = Math.round(X(op.x)); op.y = Math.round(Y(op.y)); }
    else op.offset = Math.round(op.offset * f);
    if (!op.measured) op.width = Math.round(op.width * f);
    clampOpening(r, op);
  }
  const bg = p.background;
  if (bg) {
    bg.x = X(bg.x); bg.y = Y(bg.y); bg.width *= f; bg.height *= f;
  }
  if (p.scale?.cmPerPx) p.scale = { ...p.scale, cmPerPx: p.scale.cmPerPx * f };
  for (const l of p.layouts) for (const it of l.furniture) { it.x = Math.round(X(it.x)); it.y = Math.round(Y(it.y)); }
}

export async function openCalibratePlan() {
  const p = state.project;
  const r = p.room;
  // 測った長さの候補（いまの図の上での長さ）
  const sources = [
    { id: 'room-w', label: `間取り全体の横幅（いま ${Math.round(r.width)}cm）`, len: r.width },
    { id: 'room-d', label: `間取り全体の奥行き（いま ${Math.round(r.depth)}cm）`, len: r.depth },
    ...(p.areas || []).flatMap(a => [
      { id: `${a.id}-w`, label: `${a.label}の横幅（いま ${Math.round(a.width)}cm）`, len: a.width },
      { id: `${a.id}-d`, label: `${a.label}の奥行き（いま ${Math.round(a.depth)}cm）`, len: a.depth },
    ]),
  ];
  const last = getLastMeasure();
  if (last) sources.unshift({ id: 'measure', label: `「📏 測る」で最後に測った長さ（いま ${last}cm）`, len: last });
  const doors = p.openings.filter(o => o.type === 'door' || o.type === 'closet');

  const res = await modal({
    title: '実寸で合わせる（測った寸法を入力）',
    wide: true,
    body: `
      <p style="margin:0">内見などで実際に測った寸法を入れると、間取りを実寸に合わせ直します。図面から作った間取りは寸法が推定なので、1か所測って入れるだけで全体の精度が上がります。</p>
      <div class="field"><strong>1. 長さを合わせる</strong>（間取り全体を拡大・縮小。家具の大きさはそのまま）
        <select id="cal-src">${sources.map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}</select>
        <span class="unit" data-unit="cm"><input type="text" inputmode="decimal" id="cal-real" placeholder="実際に測った長さ（例 305）"></span>
        <span class="muted" id="cal-preview">壁の端から端など、測った所と同じ所を選んでください。空欄なら拡大・縮小しません。</span>
      </div>
      ${doors.length ? `<div class="field"><strong>2. ドア・収納扉の幅を測った値にする</strong>（搬入チェックが正確になります。空欄のドアはそのまま）
        <div class="list">${doors.map((o, i) => `<label class="list-item" style="cursor:default;gap:8px">
          <span class="grow">${escapeHtml(o.label || OPENING_LABELS[o.type])}<span class="muted">（いま ${Math.round(o.width)}cm${o.measured ? '・測った値' : ''}）</span></span>
          <span class="unit" data-unit="cm" style="width:110px"><input type="text" inputmode="decimal" data-door="${i}" placeholder="測った幅"></span></label>`).join('')}</div>
      </div>` : ''}`,
    buttons: [{ label: 'キャンセル', value: null }, { label: '合わせる', value: 'ok', primary: true }],
    onMount: body => {
      const upd = () => {
        const src = sources.find(s => s.id === body.querySelector('#cal-src').value);
        const real = num(body.querySelector('#cal-real').value);
        body.querySelector('#cal-preview').textContent = real && src
          ? `${(real / src.len * 100).toFixed(1)}% に拡大・縮小 → 間取り全体 ${Math.round(r.width * real / src.len)} × ${Math.round(r.depth * real / src.len)} cm`
          : '壁の端から端など、測った所と同じ所を選んでください。空欄なら拡大・縮小しません。';
      };
      body.querySelector('#cal-src').addEventListener('change', upd);
      body.querySelector('#cal-real').addEventListener('input', upd);
    },
    collect: body => ({
      src: body.querySelector('#cal-src').value,
      real: num(body.querySelector('#cal-real').value),
      doors: doors.map((_, i) => num(body.querySelector(`[data-door="${i}"]`)?.value)),
    }),
  });
  if (res.value !== 'ok') return false;
  const { src, real, doors: widths } = res.data;
  const source = sources.find(s => s.id === src);
  const f = real && source ? real / source.len : 1;
  if (f !== 1 && (f < 0.2 || f > 5)) { toast('入れた長さが今の長さと大きく違います（5倍以上）。測った所と選んだ所が同じか確かめてください', 'error', 6000); return false; }
  const changedDoors = widths.filter(Boolean).length;
  if (f === 1 && !changedDoors) { toast('寸法が入力されていません'); return false; }
  commit(pr => {
    if (f !== 1) scaleProject(pr, f);
    doors.forEach((o, i) => {
      if (!widths[i]) return;
      o.width = Math.round(widths[i]);
      o.measured = true;
      clampOpening(pr.room, o);
    });
  });
  const msgs = [];
  if (f !== 1) msgs.push(`間取り全体を ${(f * 100).toFixed(1)}% にしました（${Math.round(state.project.room.width)} × ${Math.round(state.project.room.depth)} cm）`);
  if (changedDoors) msgs.push(`ドア${changedDoors}か所の幅を測った値にしました`);
  toast(`${msgs.join('。')}。元に戻すで取り消せます`, 'ok', 6000);
  return true;
}
