// オフライン対応のサービスワーカー。
// 方針：ネットワーク優先（常に最新のアプリを使う）→ つながらないときはキャッシュで起動する。
// アプリのファイルを追加・削除したら SHELL を更新し、CACHE の番号を上げる。

const CACHE = 'floor-planner-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './src/styles.css',
  './src/actions.js',
  './src/ai-demo.js',
  './src/ai-layout.js',
  './src/ai-panel.js',
  './src/area-draw.js',
  './src/calibrate-plan.js',
  './src/canvas.js',
  './src/carry-check.js',
  './src/custom-furniture.js',
  './src/data/furniture-library.js',
  './src/data/sample-project.js',
  './src/floorplan.js',
  './src/furniture-list.js',
  './src/furniture.js',
  './src/geometry.js',
  './src/layout-validator.js',
  './src/main.js',
  './src/mobile.js',
  './src/panels.js',
  './src/plan-detect.js',
  './src/plan-fixtures.js',
  './src/plan-import.js',
  './src/plan-review.js',
  './src/print-plan.js',
  './src/render.js',
  './src/state.js',
  './src/storage.js',
  './src/table-chairs.js',
  './src/ui.js',
  './src/view3d.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('floor-planner-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // 外部（PDF 読み込み用の pdf.js など）・GET 以外・AI の API には関与しない
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetchWithTimeout(request);
      if (res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') return cache.match('./index.html');
      return Response.error();
    }
  })());
});
