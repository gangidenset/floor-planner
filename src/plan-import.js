// 間取り図の自動認識ダイアログと、認識結果の反映
import { state, commit } from './state.js';
import { detectFloorplan, M2_PER_JO } from './plan-detect.js';
import { modal, toast } from './ui.js';
import { uid } from './geometry.js';
import { clampOpening, DOOR_STYLE_LABELS } from './floorplan.js';
import { findFixtures } from './plan-fixtures.js';
import { openPlanReview } from './plan-review.js';
import { getSpec } from './data/furniture-library.js';
import { createItem } from './furniture.js';

/**
 * 入力欄の数値を読む。全角の数字・小数点（日本語入力のまま打った「５３．２８」など）、カンマ、単位（㎡・m2・畳・cm）も受け付ける。
 * 読めなければ 0
 */
const num = text => {
  const s = String(text ?? '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.').replace(/[,，]/g, '')
    .replace(/(㎡|m2|ｍ２|平米|畳|帖|cm|ｃｍ)/gi, '').trim();
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const fmt = (v, d = 1) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : '');

/**
 * 背景画像を解析し、部屋を選んで広さを入力してもらい、部屋の輪郭・縮尺・開口部を作る。
 * 戻り値: true = 反映した / false = 手動設定を選んだ・キャンセル
 */
export async function autoDetectPlan() {
  const p = state.project;
  const bg = p.background;
  const src = bg && p.assets?.[bg.assetId];
  if (!src) { toast('先に間取り図の画像を読み込んでください', 'error'); return false; }

  let det;
  try {
    det = await detectFloorplan(src);
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
  // 開口部は画像上の絶対位置で持っておく（枠を動かしても位置がずれないように）
  const rooms = det.rooms.slice(0, 20).map(r => ({
    ...r,
    openings: r.openings.map(o => ({ ...o, abs: (o.wall === 'top' || o.wall === 'bottom' ? r.x : r.y) + o.offset })),
  }));
  const hasFurniture = p.layouts.some(l => l.furniture.length);
  const stroke = Math.max(det.width, det.height) / 260;
  let sel = rooms.length ? 0 : -1;

  const intro = rooms.length
    ? `壁に囲まれた部屋を <strong>${rooms.length}つ</strong> 見つけました。家具を配置する部屋を選び、その部屋の<strong>広さ</strong>（図面に書かれた畳数など）を入力してください。`
    : '部屋を自動で見つけられませんでした。<strong>画像の上をドラッグして部屋の枠を描いて</strong>から、広さを入力してください。';

  let sizeWarned = false;
  const res = await modal({
    title: '間取りの自動認識',
    wide: true,
    body: `
      <p style="margin:0">${intro}<br><span class="muted">壁などを作らず、画像を下絵として家具を置きたいときは「画像だけ使う（下絵）」を押してください（広さを入力しておくと縮尺も合わせます）。</span></p>
      <div class="detect-grid">
        <div class="detect-preview">
          <svg viewBox="0 0 ${det.width} ${det.height}" class="detect-svg" preserveAspectRatio="xMidYMid meet">
            <image href="${src}" width="${det.width}" height="${det.height}"/>
            ${det.plan ? `<g id="det-plan" style="pointer-events:none">
              ${det.plan.walls.map(w => `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="rgba(194,65,12,0.45)"/>`).join('')}
              <rect x="${det.plan.x}" y="${det.plan.y}" width="${det.plan.w}" height="${det.plan.h}" fill="none" stroke="#c2410c" stroke-width="${stroke * 1.2}" stroke-dasharray="${stroke * 4} ${stroke * 2}"/>
            </g>` : ''}
            <g id="det-rooms"></g><g id="det-handles"></g>
          </svg>
        </div>
        <div class="detect-side">
          ${det.plan ? `<div id="det-total-box" style="border:2px solid var(--accent);border-radius:8px;padding:8px 10px;background:var(--accent-weak)">
            <label class="field" style="margin:0"><strong>専有面積（物件情報の面積）</strong><span class="unit" data-unit="㎡"><input type="text" inputmode="decimal" id="det-total" placeholder="例 53.28"></span></label>
            <p class="muted" style="margin:4px 0 0">ここに入れると間取り全体の大きさが正しく合います（部屋ごとの広さより優先）。分からなければ下で部屋の広さを入力してください。</p>
          </div>` : ''}
          <p id="det-size-msg" class="note warn" style="margin:0" hidden>広さが入力されていません。このまま作ると<strong>寸法が目安</strong>になり、家具の大きさと合わなくなります。専有面積か部屋の広さを入れてください。<br>入力せずに作る場合は、もう一度「間取りを作成」を押してください。</p>
          <p class="note info" style="margin:0">青い枠はドラッグで移動、四隅と辺の□で大きさを変えられます。「＋ 枠を追加」または何もない所をドラッグで枠を増やせます。</p>
          <div class="btn-row">
            <button type="button" id="det-add">＋ 枠を追加</button>
            <button type="button" id="det-del" class="danger">選択中の枠を削除</button>
          </div>
          <div class="field">作成する範囲
            <label class="check"><input type="radio" name="det-mode" value="plan" ${det.plan ? 'checked' : 'disabled'}> 間取り全体（オレンジの範囲・黒い壁と部屋の区切りを再現）</label>
            <label class="check"><input type="radio" name="det-mode" value="room" ${det.plan ? '' : 'checked'}> 選んだ部屋だけ</label>
          </div>
          <div class="field">広さを入力する部屋（縮尺の基準）<div class="list" id="det-list"></div></div>
          <div class="grid2">
            <label class="field">広さ（畳）<span class="unit" data-unit="畳"><input type="text" inputmode="decimal" id="det-jo" placeholder="例 12"></span></label>
            <label class="field">広さ（㎡）<span class="unit" data-unit="㎡"><input type="text" inputmode="decimal" id="det-m2" placeholder="例 19.4"></span></label>
          </div>
          <label class="field">または 部屋の横幅<span class="unit" data-unit="cm"><input type="text" inputmode="decimal" id="det-w" placeholder="分かる場合のみ"></span></label>
          <label class="check"><input type="checkbox" id="det-openings" checked> 壁の切れ目からドア・窓を自動で追加する</label>
          <label class="check"><input type="checkbox" id="det-fixtures" checked> 浴槽・トイレ・洗面台・洗濯機置き場・キッチン・WIC のハンガーラックを図面から判定して配置する</label>
          <label class="check"><input type="checkbox" id="det-remove-img" checked> 作成後、読み込んだ画像を消す（壁・部屋の区切り・ドア・窓だけ残す）</label>
          <label class="check"><input type="checkbox" id="det-clear" ${hasFurniture ? (p.isSample ? 'checked' : '') : 'disabled'}> 家具のない新しいレイアウトで始める（今の配置は残ります）</label>
          <p class="muted" style="margin:0">1畳 = ${M2_PER_JO}㎡ で計算します。広さを空欄にすると縮尺は「未設定」になり、寸法は目安になります。自動で追加したドア・窓は「（自動）」と表示されるので、位置と種類を確認してください。</p>
        </div>
      </div>`,
    buttons: [
      { label: '画像だけ使う（下絵）', value: 'image' },
      { label: '手動で設定する', value: 'manual' },
      { label: '間取りを作成', value: 'ok', primary: true },
    ],
    onMount: body => {
      const jo = body.querySelector('#det-jo'), m2 = body.querySelector('#det-m2');
      jo.addEventListener('input', () => { m2.value = num(jo.value) ? fmt(num(jo.value) * M2_PER_JO, 2) : ''; });
      m2.addEventListener('input', () => { jo.value = num(m2.value) ? fmt(num(m2.value) / M2_PER_JO, 1) : ''; });
      setupFrameEditor(body, rooms, det, stroke, () => sel, i => { sel = i; });
      setTimeout(() => (body.querySelector('#det-total') || jo).focus(), 0);
    },
    // 広さが空欄のまま「間取りを作成」を押したら、1回目は止めて入力欄を示す（2回目はそのまま作成）
    beforeClose: (value, body) => {
      if (value !== 'ok' || sizeWarned) return true;
      const anySize = ['#det-total', '#det-jo', '#det-m2', '#det-w'].some(sel => num(body.querySelector(sel)?.value));
      if (anySize) return true;
      sizeWarned = true;
      body.querySelector('#det-size-msg').hidden = false;
      const target = body.querySelector('#det-total') || body.querySelector('#det-jo');
      target.scrollIntoView({ block: 'center' });
      target.focus();
      // スマホでは注意書きが画面の外になることがあるので、トーストでも知らせる
      toast('広さが空欄です。入力するか、このままでよければもう一度「間取りを作成」を押してください', '', 6000);
      return false;
    },
    collect: body => ({
      index: sel,
      totalM2: num(body.querySelector('#det-total')?.value),
      m2: num(body.querySelector('#det-m2').value),
      widthCm: num(body.querySelector('#det-w').value),
      // 何か入力されているのに数値として読めなかった欄（縮尺が「未設定」になるのを知らせる）
      unreadable: ['#det-total', '#det-m2', '#det-w'].some(sel => { const v = body.querySelector(sel)?.value.trim(); return v && !num(v); }),
      openings: body.querySelector('#det-openings').checked,
      fixtures: body.querySelector('#det-fixtures').checked,
      clear: body.querySelector('#det-clear').checked,
      removeImage: body.querySelector('#det-remove-img').checked,
      mode: body.querySelector('input[name="det-mode"]:checked')?.value || 'room',
    }),
  });
  // 枠が1つもない場合：間取り全体なら建物全体を基準にする（広さ欄には専有面積を入力）
  if (res.value === 'ok' && res.data.index < 0 && !(res.data.mode === 'plan' && det.plan) && !(res.data.totalM2 > 0 && det.plan)) {
    toast('部屋の枠がありません。画像の上をドラッグして枠を描くか、手動で設定してください', 'error', 5000);
    return false;
  }
  if (res.value === 'image') {
    useImageOnly(det, rooms[res.data.index], res.data);
    return true;
  }
  if (res.value !== 'ok') return false;

  const room = rooms[res.data.index] || { ...det.plan, areaPx: det.plan.w * det.plan.h };
  let cmPerPx, status = 'set', reference;
  if (res.data.totalM2 > 0 && det.plan?.floorPx > 0) {
    // 専有面積（間取り全体の床面積）から縮尺を決める
    cmPerPx = Math.sqrt((res.data.totalM2 * 10000) / det.plan.floorPx);
    reference = { areaM2: res.data.totalM2, total: true };
  } else if (res.data.m2 > 0) {
    cmPerPx = Math.sqrt((res.data.m2 * 10000) / room.areaPx);
    reference = { areaM2: res.data.m2 };
  } else if (res.data.widthCm > 0) {
    cmPerPx = res.data.widthCm / room.w;
    reference = { widthCm: res.data.widthCm };
  } else {
    // 広さが分からない場合：部屋の長辺を約 450cm と仮定（縮尺未設定として扱う）
    cmPerPx = 450 / Math.max(room.w, room.h);
    status = 'unset';
  }
  // 設備の判定は寸法（cm）を使うので、縮尺が決まってから行う
  const fx = res.data.fixtures
    ? findFixtures(rooms, det.symbols, cmPerPx, det.plan ? det.plan.wallThickness * 0.6 : 0, det.paper)
    : { fixtures: [], labels: {} };
  const opts = { k: cmPerPx, status, reference, withOpenings: res.data.openings, clearLayout: res.data.clear, removeImage: res.data.removeImage, fixtures: fx };
  if (res.data.mode === 'plan' && det.plan) {
    applyWholePlan(det.plan, rooms, opts);
    const r = state.project.room;
    toast(status === 'set'
      ? `間取り全体を作成しました（${Math.round(r.width)} × ${Math.round(r.depth)} cm、壁${state.project.walls.length}個・部屋${state.project.areas.length}つ${fixtureNote(fx.fixtures)}）`
      : `間取り全体を作成しましたが、広さが入力されていないため寸法は目安です（${Math.round(r.width)} × ${Math.round(r.depth)} cm）。もう一度「間取りを読み込む」で専有面積を入力するか、右パネルで縮尺を設定してください`,
      status === 'set' ? 'ok' : 'error', status === 'set' ? 6000 : 10000);
    // 作成した結果（ドア・窓・設備・部屋の名前）をすぐ確認・修正できるようにする（画面を全体表示にしてから開く）
    setTimeout(() => openPlanReview(), 400);
  } else {
    applySingleRoom(room, res.data.index + 1, opts);
    const area = (room.w * room.h * cmPerPx ** 2) / 10000;
    toast(status === 'set'
      ? `間取りを作成しました（部屋 ${Math.round(room.w * cmPerPx)} × ${Math.round(room.h * cmPerPx)} cm、約${fmt(area)}㎡${fixtureNote(fx.fixtures.filter(x => x.room === res.data.index))}）`
      : '間取りを作成しました。広さが未入力のため寸法は目安です（右パネルで㎡・畳を入力できます）', status === 'set' ? 'ok' : '', 6000);
  }
  return true;
}

/**
 * 図面のドアの記号（扇形・引き戸の平行線・折れ戸の山形）から、壁の上に置くドアを作る（内壁・外壁どちらも「自由配置」のドアにする）。
 * 位置は画像px → origin を原点とした cm。すでに近くにドアがある場合は作らない
 */
function doorsFromArcs(list, origin, k, existing, closetFront = () => 0) {
  const out = [];
  for (const d of list) {
    // 収納・WIC の折れ戸と引き戸は「収納扉」にする（部屋側の前の約70cmを空けるチェックの対象になる）
    const front = d.style === 'folding' || d.style === 'sliding' ? closetFront(d) : 0;
    if (front) {
      const width = Math.round(d.width * k);
      if (width < 40 || width > 400) continue;
      out.push({
        id: uid('op'), type: 'closet', wall: 'free', label: '収納扉（自動）',
        x: Math.round((d.x - origin.x) * k), y: Math.round((d.y - origin.y) * k),
        orient: d.orient, side: front, hinge: d.hinge, width,
      });
      continue;
    }
    const width = Math.round(d.width * k);
    const style = d.style || 'swing';
    // 引き戸は2〜4枚で 3m を超えることもある。折れ戸は浴室・収納の小さな戸もある
    const [minW, maxW] = style === 'sliding' ? [50, 400] : style === 'folding' ? [40, 200] : [45, 130];
    if (width < minW || width > maxW) continue;
    const op = {
      id: uid('op'), type: 'door', wall: 'free', label: `${style === 'swing' ? 'ドア' : DOOR_STYLE_LABELS[style]}（自動）`,
      x: Math.round((d.x - origin.x) * k), y: Math.round((d.y - origin.y) * k),
      orient: d.orient, side: d.side, hinge: d.hinge, width, ...(style === 'swing' ? {} : { style }),
    };
    const near = [...existing, ...out].some(o => o.type === 'door' && o.wall === 'free' && Math.hypot(o.x - op.x, o.y - op.y) < 40);
    if (!near) out.push(op);
  }
  return out;
}

/**
 * 戸の奥が収納なら、収納扉の「前」の向き（部屋側、+1 / -1）を返す。収納でなければ 0。
 * 収納 = WIC か、小さな部屋（2.5㎡以下で幅 120cm 以下）で浴室・洗面所・トイレではないもの。
 * 折れ戸は印が部屋側に描かれるので side の反対側が奥。引き戸は向きが分からないので両側を調べ、片側だけが収納のときに限る
 */
function closetFrontOf(d, rooms, labels, k) {
  const step = 30 / k; // 出入口の中心から 30cm 先の部屋を見る
  const isClosetAt = dir => {
    const px = d.orient === 'h' ? d.x : d.x + dir * step;
    const py = d.orient === 'h' ? d.y + dir * step : d.y;
    const i = rooms.findIndex(r => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (i < 0) return false;
    if (labels[i] === 'WIC') return true;
    if (labels[i]) return false; // 浴室・洗面所・トイレ
    const w = rooms[i].w * k, h = rooms[i].h * k;
    return (w * h) / 10000 <= 2.5 && Math.min(w, h) <= 120;
  };
  if (d.style === 'folding') return isClosetAt(-d.side) ? d.side : 0;
  const plus = isClosetAt(1), minus = isClosetAt(-1);
  return plus === minus ? 0 : plus ? -1 : 1;
}

/** 判定した設備の一覧（トースト用） */
function fixtureNote(list) {
  if (!list.length) return '';
  const names = [...new Set(list.map(x => fixtureName(x.type)))];
  return `。${names.join('・')}を図面から判定して配置しました`;
}

const fixtureName = type => getSpec(type).name.replace(/（.*）/, '');

/**
 * 判定した設備を今のレイアウトに家具として置く（固定はしないので、動かしたり消したりできる。前回自動で置いた設備は置き直す）。
 * list の位置は画像px、origin は画像上の部屋（間取り）の左上、k は 1px あたりの cm
 */
function placeFixtures(p, list, origin, k) {
  const layout = p.layouts.find(l => l.id === p.activeLayoutId) || p.layouts[0];
  layout.furniture = layout.furniture.filter(f => !f.autoFixture);
  const room = p.room;
  for (const fx of list) {
    // 部屋（間取りの外枠）からはみ出さないように寄せる
    const turned = fx.rotation === 90 || fx.rotation === 270;
    const fw = turned ? fx.depth : fx.width, fh = turned ? fx.width : fx.depth;
    const x = Math.min(Math.max((fx.cx - origin.x) * k, fw / 2), room.width - fw / 2);
    const y = Math.min(Math.max((fx.cy - origin.y) * k, fh / 2), room.depth - fh / 2);
    layout.furniture.push(createItem(getSpec(fx.type), {
      id: uid(fx.type),
      name: `${fixtureName(fx.type)}（自動）`,
      x: Math.round(x), y: Math.round(y),
      width: Math.round(fx.width), depth: Math.round(fx.depth), rotation: fx.rotation,
      autoFixture: true,
    }));
  }
}

/** 画像を下絵として使う：画像全体を配置範囲にし、壁・ドア・窓は作らない */
function useImageOnly(det, refRoom, data) {
  let k, status = 'set', reference;
  if (refRoom && data.m2 > 0) {
    k = Math.sqrt((data.m2 * 10000) / refRoom.areaPx);
    reference = { areaM2: data.m2 };
  } else if (refRoom && data.widthCm > 0) {
    k = data.widthCm / refRoom.w;
    reference = { widthCm: data.widthCm };
  } else {
    // 縮尺が分からない場合：画像の長辺を約 10m と仮定（縮尺未設定として表示）
    k = 1000 / Math.max(det.width, det.height);
    status = 'unset';
  }
  commit(p => {
    const bg = p.background;
    bg.x = 0; bg.y = 0;
    bg.width = Math.round(bg.naturalWidth * k);
    bg.height = Math.round(bg.naturalHeight * k);
    bg.visible = true;
    bg.opacity = Math.max(bg.opacity ?? 0.85, 0.85);
    p.room = { ...p.room, x: 0, y: 0, width: bg.width, depth: bg.height, label: '間取り図', followImage: true };
    p.walls = [];
    p.areas = [];
    p.openings = [];
    p.scale = { status, cmPerPx: status === 'set' ? k : null, reference: { ...reference, method: 'image' } };
    p.isSample = false;
    if (data.clear) {
      const l = { id: uid('layout'), name: '間取り図のレイアウト', furniture: [] };
      p.layouts.push(l);
      p.activeLayoutId = l.id;
    }
  });
  toast(status === 'set'
    ? '画像を下絵として読み込みました。家具を置いたり、壁・ドア・窓をなぞったりできます'
    : '画像を下絵として読み込みました。縮尺が未設定です：右パネル「縮尺を設定」か広さ（㎡・畳）で合わせてください', status === 'set' ? 'ok' : '', 7000);
}

/**
 * 壁の切れ目を開口部に変換する。
 * list: 画像上の開口部 { wall, abs, width, side }、frame: 画像上の枠 { x, y, w, h }、roomCm: cm の部屋
 * 外に面した 60〜110cm の切れ目で、窓の線が描かれていないものは玄関ドアの可能性があるのでドアにする
 */
function toOpenings(list, frame, k, roomCm) {
  const ops = [];
  for (const o of list) {
    const start = o.wall === 'top' || o.wall === 'bottom' ? frame.x : frame.y;
    const len = o.wall === 'top' || o.wall === 'bottom' ? frame.w : frame.h;
    if (o.abs + o.width <= start || o.abs >= start + len) continue;
    const width = o.width * k, offset = (o.abs - start) * k;
    let op = null;
    if (o.side === 'exterior') {
      // 切れ目に窓の線が描かれていなければドア（玄関）の候補
      if (width >= 60 && width <= 110 && !(o.lines >= 0.5)) op = { type: 'door', hinge: 'start', label: 'ドア（自動・要確認）' };
      else op = { type: 'window', sill: width >= 160 ? 'floor' : 'high', label: width >= 160 ? '掃き出し窓（自動）' : '窓（自動）' };
    } else if (width >= 50 && width <= 130) {
      op = { type: 'door', hinge: 'start', label: 'ドア（自動）' };
    }
    if (!op || width < 30) continue;
    ops.push(clampOpening(roomCm, { id: uid('op'), wall: o.wall, offset: Math.round(offset), width: Math.round(width), ...op }));
  }
  return ops;
}

function commonApply(p, origin, k, opts, layoutName) {
  const bg = p.background;
  // 基準点が (0,0) になるよう背景を配置
  bg.width = Math.round(bg.naturalWidth * k);
  bg.height = Math.round(bg.naturalHeight * k);
  bg.x = Math.round(-origin.x * k);
  bg.y = Math.round(-origin.y * k);
  p.scale = { status: opts.status, cmPerPx: opts.status === 'set' ? k : null, reference: { ...opts.reference, method: 'auto' } };
  p.isSample = false;
  if (opts.clearLayout) {
    const l = { id: uid('layout'), name: layoutName, furniture: [] };
    p.layouts.push(l);
    p.activeLayoutId = l.id;
  }
}

// 座標はすべて元画像のピクセル。k = 画像1pxあたりの cm
function applySingleRoom(room, number, opts) {
  const { k } = opts;
  commit(p => {
    p.room = { ...p.room, x: 0, y: 0, width: Math.round(room.w * k), depth: Math.round(room.h * k), label: p.room.label && !p.isSample ? p.room.label : `部屋${number}` };
    commonApply(p, room, k, opts, `部屋${number}のレイアウト`);
    p.walls = [];
    p.areas = [];
    if (opts.withOpenings) p.openings = toOpenings(room.openings, room, k, p.room);
    placeFixtures(p, opts.fixtures.fixtures.filter(x => x.room === number - 1), room, k);
    // 画像を消す場合も縮尺（cm）はそのまま。画像データは保存時に整理される
    if (opts.removeImage) p.background = null;
  });
}

/** 建物全体：外壁の内側を部屋とし、内壁と部屋の区切り（エリア）を作る */
function applyWholePlan(plan, rooms, opts) {
  const { k } = opts;
  const cm = v => Math.round(v * k);
  commit(p => {
    p.room = { ...p.room, x: 0, y: 0, width: cm(plan.w), depth: cm(plan.h), label: '間取り全体' };
    commonApply(p, plan, k, opts, '間取りのレイアウト');
    const W = p.room.width, D = p.room.depth;
    p.walls = plan.walls.map(w => {
      const x0 = Math.max(0, cm(w.x - plan.x)), y0 = Math.max(0, cm(w.y - plan.y));
      const x1 = Math.min(W, cm(w.x + w.w - plan.x)), y1 = Math.min(D, cm(w.y + w.h - plan.y));
      return { id: uid('wall'), x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }).filter(w => w.w >= 2 && w.h >= 2);
    p.areas = rooms.map((r, i) => {
      // 外周の内側に収める
      const x0 = Math.max(0, cm(r.x - plan.x)), y0 = Math.max(0, cm(r.y - plan.y));
      const x1 = Math.min(W, cm(r.x + r.w - plan.x)), y1 = Math.min(D, cm(r.y + r.h - plan.y));
      const area = { id: uid('area'), label: opts.fixtures.labels[i] || `部屋${i + 1}`, x: x0, y: y0, width: x1 - x0, depth: y1 - y0 };
      area.openings = toOpenings(r.openings, r, k, area);
      return area;
    });
    if (opts.withOpenings) {
      const abs = plan.openings.map(o => ({ ...o, abs: (o.wall === 'top' || o.wall === 'bottom' ? plan.x : plan.y) + o.offset }));
      p.openings = toOpenings(abs, plan, k, p.room);
      p.openings.push(...doorsFromArcs(plan.doors || [], plan, k, p.openings, d => closetFrontOf(d, rooms, opts.fixtures.labels, k)));
    }
    placeFixtures(p, opts.fixtures.fixtures, plan, k);
    if (opts.removeImage) p.background = null;
  });
}

/**
 * 認識結果の枠を編集できるようにする（移動・リサイズ・新規作成・選択）
 * 座標は画像のピクセル単位（SVG の viewBox と同じ）
 */
function setupFrameEditor(body, rooms, det, stroke, getSel, setSel) {
  const svg = body.querySelector('.detect-svg');
  const roomsG = body.querySelector('#det-rooms');
  const handlesG = body.querySelector('#det-handles');
  const list = body.querySelector('#det-list');
  const hs = stroke * 5;
  const minSize = stroke * 6;
  svg.style.touchAction = 'none';

  const draw = () => {
    const sel = getSel();
    roomsG.innerHTML = rooms.map((r, i) => {
      const on = i === sel;
      return `<g class="det-room" data-i="${i}" style="cursor:${on ? 'move' : 'pointer'}">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${on ? 'rgba(31,111,235,0.25)' : 'rgba(31,111,235,0.08)'}" stroke="#1f6feb" stroke-width="${on ? stroke * 1.4 : stroke}" ${on ? '' : `stroke-dasharray="${stroke * 3} ${stroke * 2}"`}/>
        <circle cx="${r.x + stroke * 10}" cy="${r.y + stroke * 10}" r="${stroke * 7}" fill="#1f6feb"/>
        <text x="${r.x + stroke * 10}" y="${r.y + stroke * 10}" font-size="${stroke * 8}" fill="#fff" text-anchor="middle" dominant-baseline="central" font-weight="700" style="pointer-events:none">${i + 1}</text>
      </g>`;
    }).join('');
    const r = rooms[sel];
    if (!r) { handlesG.innerHTML = ''; return; }
    const pts = {
      nw: [r.x, r.y], n: [r.x + r.w / 2, r.y], ne: [r.x + r.w, r.y], e: [r.x + r.w, r.y + r.h / 2],
      se: [r.x + r.w, r.y + r.h], s: [r.x + r.w / 2, r.y + r.h], sw: [r.x, r.y + r.h], w: [r.x, r.y + r.h / 2],
    };
    const cursor = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
    handlesG.innerHTML = Object.entries(pts).map(([h, [x, y]]) =>
      `<rect data-h="${h}" x="${x - hs / 2}" y="${y - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="#1f6feb" stroke-width="${stroke}" style="cursor:${cursor[h]}-resize"/>`).join('');
  };

  const drawList = () => {
    const sel = getSel();
    body.querySelector('#det-del').disabled = sel < 0;
    list.innerHTML = rooms.length
      ? rooms.map((r, i) => `<label class="check"><input type="radio" name="det-room" value="${i}" ${i === sel ? 'checked' : ''}> 部屋${i + 1}
          <span class="muted">（${r.edited ? '調整済み・' : ''}縦横比 ${fmt(r.w / r.h, 2)}）</span></label>`).join('')
      : '<span class="muted">まだ枠がありません。「＋ 枠を追加」を押すか、画像の上をドラッグして描いてください。</span>';
  };

  const toSvg = e => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(det.width, pt.x)), y: Math.max(0, Math.min(det.height, pt.y)) };
  };

  let drag = null;
  svg.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch { /* キャプチャできない入力は無視 */ }
    const pt = toSvg(e);
    const h = e.target.closest('[data-h]');
    const g = e.target.closest('.det-room');
    if (h && rooms[getSel()]) {
      drag = { type: 'resize', h: h.dataset.h, orig: { ...rooms[getSel()] } };
    } else if (g) {
      setSel(Number(g.dataset.i));
      drag = { type: 'move', start: pt, orig: { ...rooms[getSel()] } };
      draw(); drawList();
    } else {
      drag = { type: 'new', start: pt, created: false };
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const pt = toSvg(e);
    const r = rooms[getSel()];
    if (drag.type === 'move') {
      const o = drag.orig;
      r.x = Math.max(0, Math.min(det.width - o.w, o.x + pt.x - drag.start.x));
      r.y = Math.max(0, Math.min(det.height - o.h, o.y + pt.y - drag.start.y));
    } else if (drag.type === 'resize') {
      const o = drag.orig;
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (drag.h.includes('w')) x0 = Math.min(pt.x, x1 - minSize);
      if (drag.h.includes('e')) x1 = Math.max(pt.x, x0 + minSize);
      if (drag.h.includes('n')) y0 = Math.min(pt.y, y1 - minSize);
      if (drag.h.includes('s')) y1 = Math.max(pt.y, y0 + minSize);
      Object.assign(r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else if (drag.type === 'new') {
      const w = Math.abs(pt.x - drag.start.x), h = Math.abs(pt.y - drag.start.y);
      if (!drag.created) {
        if (w < minSize || h < minSize) return;
        rooms.push({ x: 0, y: 0, w: 0, h: 0, areaPx: 0, openings: [], edited: true });
        setSel(rooms.length - 1);
        drag.created = true;
      }
      Object.assign(rooms[getSel()], {
        x: Math.min(pt.x, drag.start.x), y: Math.min(pt.y, drag.start.y), w: Math.max(w, minSize), h: Math.max(h, minSize),
      });
    }
    const cur = rooms[getSel()];
    if (cur) { cur.edited = true; cur.areaPx = cur.w * cur.h; }
    draw();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    drawList();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  body.querySelector('#det-add').addEventListener('click', () => {
    const w = det.width * 0.3, h = det.height * 0.3;
    // 既存の枠と重なりにくいよう、少しずつずらして置く
    const shift = (rooms.length % 5) * stroke * 6;
    rooms.push({
      x: Math.min(det.width - w, det.width / 2 - w / 2 + shift), y: Math.min(det.height - h, det.height / 2 - h / 2 + shift),
      w, h, areaPx: w * h, openings: [], edited: true,
    });
    setSel(rooms.length - 1);
    draw(); drawList();
  });
  body.querySelector('#det-del').addEventListener('click', () => {
    const sel = getSel();
    if (sel < 0) return;
    rooms.splice(sel, 1);
    setSel(rooms.length ? Math.min(sel, rooms.length - 1) : -1);
    draw(); drawList();
  });
  list.addEventListener('change', e => {
    if (e.target.name === 'det-room') { setSel(Number(e.target.value)); draw(); }
  });
  draw();
  drawList();
}
