// 家具ライブラリ（寸法の単位は cm）
// group は配置ルール・重なり判定・検証に使う「役割」。
// layer: 'floor' = 床置きの敷物（他の家具と重なってよい）, 'ceiling' = 天井照明（重なってよい）, 'normal'

export const CATEGORIES = [
  { id: 'custom', label: 'マイ家具（自分で登録した家具）' },
  { id: 'sofa', label: 'ソファ' },
  { id: 'tv', label: 'テレビ・テレビボード' },
  { id: 'dining-table', label: 'ダイニングテーブル' },
  { id: 'dining-chair', label: 'ダイニングチェア' },
  { id: 'bed', label: 'ベッド' },
  { id: 'desk', label: 'デスク' },
  { id: 'desk-chair', label: 'デスクチェア' },
  { id: 'kitchen', label: 'キッチン' },
  { id: 'water', label: '水まわり（トイレ・浴室・洗面）' },
  { id: 'shelf', label: '収納棚・WIC' },
  { id: 'chest', label: 'チェスト' },
  { id: 'rug', label: 'ラグ' },
  { id: 'light', label: '照明' },
  { id: 'plant', label: '観葉植物' },
  { id: 'other', label: 'その他' },
];

const L = [
  // ソファ
  { type: 'sofa-2', category: 'sofa', group: 'sofa', shape: 'sofa', name: '2人掛けソファ', width: 160, depth: 85, height: 75, color: '#B7A99A', seats: 2 },
  { type: 'sofa-3', category: 'sofa', group: 'sofa', shape: 'sofa', name: '3人掛けソファ', width: 200, depth: 90, height: 78, color: '#A9B2A4', seats: 3 },
  { type: 'sofa-1', category: 'sofa', group: 'armchair', shape: 'armchair', name: '1人掛けソファ', width: 80, depth: 80, height: 75, color: '#C4B5A2', seats: 1 },
  { type: 'sofa-l', category: 'sofa', group: 'sofa', shape: 'sofa-l', name: 'カウチソファ（L字）', width: 230, depth: 150, height: 78, color: '#9FA7B0', seats: 4 },
  // ビーズクッションソファ（ヨギボーなど）：寝かせて置いたときの大きさの目安（形が変わるので右パネルで調整してください）
  { type: 'beanbag-max', category: 'sofa', group: 'beanbag', shape: 'beanbag', name: 'ビーズクッション（ヨギボー Max など）', width: 170, depth: 65, height: 55, color: '#8FA3B8' },
  { type: 'beanbag-midi', category: 'sofa', group: 'beanbag', shape: 'beanbag', name: 'ビーズクッション（ヨギボー Midi など）', width: 135, depth: 65, height: 45, color: '#B8A08F' },
  { type: 'beanbag-mini', category: 'sofa', group: 'beanbag', shape: 'beanbag', name: 'ビーズクッション（ヨギボー Mini など）', width: 60, depth: 60, height: 55, color: '#9FB08A' },
  // リビングセット（ソファ＋センターテーブルを1つの家具として扱う。奥行き = ソファ + 通る間 40cm + テーブル）
  { type: 'living-set-2', category: 'sofa', group: 'living-set', shape: 'living-set', name: 'リビングセット（2人掛け＋テーブル）', width: 160, depth: 175, height: 75, color: '#B7A99A', seats: 2, sofaDepth: 85, tableWidth: 100, tableDepth: 50, tableColor: '#C9A77C' },
  { type: 'living-set-3', category: 'sofa', group: 'living-set', shape: 'living-set', name: 'リビングセット（3人掛け＋テーブル）', width: 200, depth: 180, height: 78, color: '#A9B2A4', seats: 3, sofaDepth: 90, tableWidth: 110, tableDepth: 50, tableColor: '#C9A77C' },
  // テレビ
  { type: 'tv-board', category: 'tv', group: 'tvboard', shape: 'tvboard', name: 'テレビボード', width: 150, depth: 40, height: 45, color: '#8C6D52' },
  { type: 'tv-board-l', category: 'tv', group: 'tvboard', shape: 'tvboard', name: 'ロータイプTVボード（大）', width: 180, depth: 42, height: 38, color: '#6E5A48' },
  { type: 'tv', category: 'tv', group: 'tv', shape: 'tv', name: 'テレビ（50型）', width: 112, depth: 25, height: 72, color: '#2E3238' },
  // ダイニングテーブル
  { type: 'table-4', category: 'dining-table', group: 'table', shape: 'table', name: 'ダイニングテーブル（4人）', width: 140, depth: 80, height: 72, color: '#C9A77C', seats: 4 },
  { type: 'table-2', category: 'dining-table', group: 'table', shape: 'table', name: 'ダイニングテーブル（2人）', width: 80, depth: 75, height: 72, color: '#C9A77C', seats: 2 },
  { type: 'table-6', category: 'dining-table', group: 'table', shape: 'table', name: 'ダイニングテーブル（6人）', width: 180, depth: 90, height: 72, color: '#B48D63', seats: 6 },
  { type: 'table-round', category: 'dining-table', group: 'table', shape: 'table-round', name: '丸テーブル', width: 100, depth: 100, height: 72, color: '#D2B48C', seats: 4 },
  // ダイニングセット（テーブル＋椅子を1つの家具として扱う。大きさは椅子を含めた外形。奥行き = テーブル + 椅子の出っ張り 42cm×2）
  { type: 'dining-set-2', category: 'dining-table', group: 'dining-set', shape: 'dining-set', name: 'ダイニングセット（2人）', width: 80, depth: 159, height: 80, color: '#C9A77C', seats: 2 },
  { type: 'dining-set-4', category: 'dining-table', group: 'dining-set', shape: 'dining-set', name: 'ダイニングセット（4人）', width: 140, depth: 164, height: 80, color: '#C9A77C', seats: 4 },
  { type: 'dining-set-6', category: 'dining-table', group: 'dining-set', shape: 'dining-set', name: 'ダイニングセット（6人）', width: 180, depth: 174, height: 80, color: '#B48D63', seats: 6 },
  { type: 'dining-set-round', category: 'dining-table', group: 'dining-set', shape: 'dining-set-round', name: 'ダイニングセット（丸・4人）', width: 184, depth: 184, height: 80, color: '#D2B48C', seats: 4 },
  // ダイニングチェア
  { type: 'chair', category: 'dining-chair', group: 'chair', shape: 'chair', name: 'ダイニングチェア', width: 45, depth: 50, height: 80, color: '#A0826A' },
  { type: 'bench', category: 'dining-chair', group: 'chair', shape: 'bench', name: 'ダイニングベンチ', width: 120, depth: 35, height: 43, color: '#A0826A' },
  // ベッド
  { type: 'bed-single', category: 'bed', group: 'bed', shape: 'bed', name: 'シングルベッド', width: 97, depth: 200, height: 40, color: '#E6E0D6' },
  { type: 'bed-semidouble', category: 'bed', group: 'bed', shape: 'bed', name: 'セミダブルベッド', width: 122, depth: 200, height: 40, color: '#E6E0D6' },
  { type: 'bed-double', category: 'bed', group: 'bed', shape: 'bed', name: 'ダブルベッド', width: 140, depth: 200, height: 40, color: '#DCD3C6' },
  // ベッドセット（ベッド＋枕元のナイトテーブルを1つの家具として扱う。幅 = ベッド + ナイトテーブル 40cm と隙間 3cm × 台数）
  { type: 'bed-set-single', category: 'bed', group: 'bed-set', shape: 'bed-set', name: 'ベッドセット（シングル＋ナイトテーブル）', width: 140, depth: 200, height: 50, color: '#E6E0D6', nightstands: 1, nightstandColor: '#B99B7C' },
  { type: 'bed-set-semidouble', category: 'bed', group: 'bed-set', shape: 'bed-set', name: 'ベッドセット（セミダブル＋ナイトテーブル）', width: 165, depth: 200, height: 50, color: '#E6E0D6', nightstands: 1, nightstandColor: '#B99B7C' },
  { type: 'bed-set-double', category: 'bed', group: 'bed-set', shape: 'bed-set', name: 'ベッドセット（ダブル＋ナイトテーブル2台）', width: 226, depth: 200, height: 50, color: '#DCD3C6', nightstands: 2, nightstandColor: '#B99B7C' },
  // デスク
  { type: 'desk', category: 'desk', group: 'desk', shape: 'desk', name: 'デスク', width: 120, depth: 60, height: 72, color: '#BFA383' },
  { type: 'desk-s', category: 'desk', group: 'desk', shape: 'desk', name: 'コンパクトデスク', width: 90, depth: 50, height: 70, color: '#D7C3A6' },
  // デスクチェア
  { type: 'desk-chair', category: 'desk-chair', group: 'deskchair', shape: 'desk-chair', name: 'デスクチェア', width: 60, depth: 60, height: 100, color: '#4A4F57' },
  // 収納棚
  { type: 'shelf', category: 'shelf', group: 'storage', shape: 'shelf', name: 'オープンシェルフ', width: 80, depth: 35, height: 180, color: '#B08F6E', tall: true },
  { type: 'bookshelf-w', category: 'shelf', group: 'storage', shape: 'shelf', name: 'ワイド本棚', width: 120, depth: 30, height: 180, color: '#9C7B5B', tall: true },
  { type: 'shelf-low', category: 'shelf', group: 'storage', shape: 'shelf', name: 'ローボード収納', width: 120, depth: 40, height: 80, color: '#C2A584' },
  { type: 'wardrobe', category: 'shelf', group: 'storage', shape: 'wardrobe', name: 'ワードローブ', width: 100, depth: 60, height: 180, color: '#D3C4B1', tall: true },
  { type: 'wic', category: 'shelf', group: 'wic', shape: 'wic', name: 'ウォークインクローゼット（WIC）', width: 200, depth: 160, height: 240, color: '#E6DCCB', tall: true },
  { type: 'hanger-rack', category: 'shelf', group: 'storage', shape: 'hanger-rack', name: 'ハンガーラック', width: 120, depth: 50, height: 160, color: '#9A9EA3', tall: true },
  // チェスト
  { type: 'chest', category: 'chest', group: 'storage', shape: 'chest', name: 'チェスト', width: 80, depth: 45, height: 100, color: '#B99B7C' },
  { type: 'nightstand', category: 'chest', group: 'nightstand', shape: 'chest', name: 'ナイトテーブル', width: 40, depth: 35, height: 50, color: '#B99B7C' },
  // ラグ
  { type: 'rug', category: 'rug', group: 'rug', shape: 'rug', name: 'ラグ（200×140）', width: 200, depth: 140, height: 1, color: '#E3D9CB', layer: 'floor' },
  { type: 'rug-l', category: 'rug', group: 'rug', shape: 'rug', name: 'ラグ（240×200）', width: 240, depth: 200, height: 1, color: '#D8CFC2', layer: 'floor' },
  { type: 'rug-round', category: 'rug', group: 'rug', shape: 'rug-round', name: '丸ラグ（Φ150）', width: 150, depth: 150, height: 1, color: '#E7DDD0', layer: 'floor' },
  // 照明
  { type: 'floor-lamp', category: 'light', group: 'lamp', shape: 'floor-lamp', name: 'フロアランプ', width: 40, depth: 40, height: 160, color: '#F2E3B3' },
  { type: 'pendant', category: 'light', group: 'pendant', shape: 'pendant', name: 'ペンダントライト', width: 45, depth: 45, height: 30, color: '#F4D58D', layer: 'ceiling' },
  // 観葉植物
  { type: 'plant-l', category: 'plant', group: 'plant', shape: 'plant', name: '観葉植物（大）', width: 50, depth: 50, height: 150, color: '#6F9A6A' },
  { type: 'plant-s', category: 'plant', group: 'plant', shape: 'plant', name: '観葉植物（小）', width: 30, depth: 30, height: 60, color: '#86B07E' },
  // その他
  { type: 'center-table', category: 'other', group: 'coffee', shape: 'coffee-table', name: 'センターテーブル', width: 100, depth: 50, height: 40, color: '#C9A77C' },
  { type: 'side-table', category: 'other', group: 'side', shape: 'side-table', name: 'サイドテーブル', width: 45, depth: 45, height: 50, color: '#A88B6D' },
  // ロボット掃除機（ルンバなど）：本体は直径約34cm・高さ約9cm。充電台は壁に付け、前に戻ってくるための空きが要る
  { type: 'robot-vacuum', category: 'other', group: 'robot', shape: 'robot-vacuum', name: 'ロボット掃除機（ルンバなど）', width: 34, depth: 34, height: 9, color: '#3A3D42' },
  { type: 'robot-dock', category: 'other', group: 'robot-dock', shape: 'robot-dock', name: 'ロボット掃除機の充電台', width: 35, depth: 30, height: 12, color: '#2F3236' },
  // キッチン
  { type: 'kitchen', category: 'kitchen', group: 'kitchen', shape: 'kitchen', name: 'キッチン（I型）', width: 255, depth: 65, height: 85, color: '#E9E9E6' },
  { type: 'kitchen-face', category: 'kitchen', group: 'kitchen', shape: 'kitchen-face', name: '対面キッチン（ペニンシュラ）', width: 255, depth: 95, height: 85, color: '#E9E9E6' },
  { type: 'kitchen-l', category: 'kitchen', group: 'kitchen', shape: 'kitchen-l', name: 'キッチン（L型）', width: 240, depth: 180, height: 85, color: '#E9E9E6' },
  { type: 'kitchen-island', category: 'kitchen', group: 'kitchen-island', shape: 'kitchen-island', name: 'キッチンカウンター（アイランド）', width: 180, depth: 90, height: 90, color: '#D9D3C7' },
  { type: 'fridge', category: 'kitchen', group: 'fridge', shape: 'fridge', name: '冷蔵庫', width: 65, depth: 70, height: 180, color: '#EEF0F2', tall: true },
  { type: 'cupboard', category: 'kitchen', group: 'storage', shape: 'shelf', name: '食器棚', width: 100, depth: 45, height: 180, color: '#CDBBA4', tall: true },
  // 水まわり
  { type: 'toilet', category: 'water', group: 'toilet', shape: 'toilet', name: 'トイレ', width: 40, depth: 70, height: 80, color: '#F5F7F8' },
  { type: 'bathtub', category: 'water', group: 'bath', shape: 'bathtub', name: '浴槽（お風呂）', width: 140, depth: 75, height: 55, color: '#E6F0F5' },
  { type: 'unit-bath', category: 'water', group: 'bath', shape: 'unit-bath', name: 'ユニットバス（1616）', width: 160, depth: 160, height: 220, color: '#EEF3F6', tall: true },
  { type: 'washbasin', category: 'water', group: 'washbasin', shape: 'washbasin', name: '洗面台', width: 75, depth: 55, height: 190, color: '#F2F2F0' },
  { type: 'washer', category: 'water', group: 'washer', shape: 'washer', name: '洗濯機置き場（防水パン＋洗濯機）', width: 64, depth: 64, height: 105, color: '#F1F3F4' },
];

export const LIBRARY = L;
export const LIBRARY_MAP = Object.fromEntries(L.map(i => [i.type, i]));

/**
 * 自分で登録した家具（マイ家具）をライブラリに加える・置き換える。
 * spec は { type: 'custom-…', category: 'custom', custom: true, group, shape, name, width, depth, height, color, note, url, ... }
 * listed: false なら一覧（家具ライブラリ）には出さず、形の情報だけ使えるようにする（置いた家具を読み込むとき用）
 */
export function registerCustomSpecs(specs, { listed = true } = {}) {
  for (const s of specs) {
    if (!s?.type || !s.custom) continue;
    if (listed) {
      const i = L.findIndex(x => x.type === s.type);
      if (i >= 0) L[i] = s; else L.push(s);
    }
    LIBRARY_MAP[s.type] = s;
  }
}

/** マイ家具をライブラリから外す（置いてある家具は、家具が持っている定義でそのまま残る） */
export function unregisterCustomSpec(type) {
  const i = L.findIndex(x => x.type === type && x.custom);
  if (i >= 0) L.splice(i, 1);
}

export function getSpec(type) {
  return LIBRARY_MAP[type] || LIBRARY_MAP['side-table'];
}

/** 家具を使う側に必要なスペース（cm）。sides のどれか1つが空いていればOK */
export const ACCESS_RULES = {
  sofa: { sides: ['front'], distance: 50 },
  armchair: { sides: ['front'], distance: 45 },
  beanbag: { sides: ['front', 'back', 'left', 'right'], distance: 40 }, // どの向きからでも座れるので、どこか1方向が空いていればよい
  bed: { sides: ['left', 'right'], distance: 50 },
  'bed-set': { sides: ['left', 'right'], distance: 50 },
  // 充電台の前は、ロボット掃除機が戻ってこられるよう 50cm ほど空ける（背面を壁に付ける）
  'robot-dock': { sides: ['front'], distance: 50 },
  desk: { sides: ['front'], distance: 70 },
  storage: { sides: ['front'], distance: 60 },
  nightstand: { sides: ['front', 'left', 'right'], distance: 30 },
  tvboard: { sides: ['front'], distance: 40 },
  kitchen: { sides: ['front'], distance: 80 },
  'kitchen-island': { sides: ['front', 'back'], distance: 80 },
  // ダイニングセット：椅子を引いて座るため、椅子の後ろに少し空きが必要
  'dining-set': { sides: ['front', 'back'], distance: 30 },
  toilet: { sides: ['front'], distance: 50 },
  bath: { sides: ['front'], distance: 60 },
  washbasin: { sides: ['front'], distance: 60 },
  washer: { sides: ['front'], distance: 60 },
  wic: { sides: ['front'], distance: 60 },
  fridge: { sides: ['front'], distance: 70 },
};

// 重なってよい組み合わせ（group 同士）
const OVERLAP_PAIRS = [
  ['tv', 'tvboard'], ['tv', 'storage'], ['tv', 'desk'],
  ['chair', 'table'], ['deskchair', 'desk'],
  ['robot', 'robot-dock'], // ロボット掃除機は充電台に乗って充電する
];
// 使う側のスペースに入っていてよい組み合わせ（owner, other）
const ACCESS_EXEMPT = {
  sofa: ['coffee', 'side', 'armchair', 'plant', 'lamp'],
  armchair: ['coffee', 'side'],
  desk: ['deskchair'],
  bed: ['nightstand'],
  'robot-dock': ['robot'], // 充電台の前にはロボット掃除機本体が止まっている
  kitchen: [],
  tvboard: ['coffee'],
};

export function layerOf(item) {
  return getSpec(item.type).layer || 'normal';
}

export function groupOf(item) {
  return getSpec(item.type).group;
}

export function canOverlap(a, b) {
  if (layerOf(a) !== 'normal' || layerOf(b) !== 'normal') return true;
  const ga = groupOf(a), gb = groupOf(b);
  return OVERLAP_PAIRS.some(([x, y]) => (ga === x && gb === y) || (ga === y && gb === x));
}

export function accessExempt(owner, other) {
  if (layerOf(other) !== 'normal') return true;
  if (canOverlap(owner, other)) return true;
  return (ACCESS_EXEMPT[groupOf(owner)] || []).includes(groupOf(other));
}

export function isTall(item) {
  return (item.height || 0) >= 100;
}
