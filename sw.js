/* 从夯到拉 —— Service Worker
 *
 * 目标：部署版（https）离线可用；「添加到主屏幕」后像原生 App。
 *
 * 策略：
 *   - 页面导航：network-first，失败回落缓存（保证更新能拿到，断网也能开）
 *   - 静态资源（css/js/数据/图标）：stale-while-revalidate（秒开，后台静默更新）
 *
 * 注意：localStorage 里的用户数据不在 SW 管辖范围，永远不会被这里动到。
 */

const VERSION = 'v1';
const CACHE = `hangdaola-${VERSION}`;

// 预缓存：应用外壳 + 地图数据（这两块占体积的大头，必须离线可用）
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './src/app.js',
  './src/tiers.js',
  './src/store.js',
  './src/search.js',
  './src/table.js',
  './src/map.js',
  './src/detail.js',
  './src/export-image.js',
  './data/city-index.json',
  './data/china-cities.geo.json',
  './data/china-provinces.geo.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 逐个 add，单个失败不拖垮整个安装（比如某个图标缺失）
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('hangdaola-') && k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理同源 GET
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：先走网络，失败回落缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE);
          const hit =
            (await cache.match(req)) ||
            (await cache.match('./index.html')) ||
            (await cache.match('./'));
          if (hit) return hit;
          throw e;
        }
      })()
    );
    return;
  }

  // 其余同源静态资源：stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);

      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        network.catch(() => {});  // 后台更新，不阻塞
        return cached;
      }

      const res = await network;
      if (res) return res;
      return new Response('离线且无缓存', { status: 504, statusText: 'Offline' });
    })()
  );
});
