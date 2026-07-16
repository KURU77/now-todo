// オフラインでも開けるようにするための Service Worker。
// アプリ本体（HTML/CSS/JS）はインストール時にまとめてキャッシュし、
// 更新があったら次の起動から新しいものに差し替える。
// タスクのデータは localStorage にあるので、ここでは扱わない。

const VERSION = 'v1.1.0';
const CACHE = `now-todo-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/store.js',
  './js/suggest.js',
  './js/calendar.js',
  './js/scheduler.js',
  './js/ai.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 1つでも失敗すると全部入らないので、個別に入れて失敗は握りつぶす。
      .then((c) => Promise.allSettled(SHELL.map((url) => c.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // ページ遷移はネットワーク優先（更新をすぐ拾う）、繋がらなければキャッシュ。
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  // それ以外はキャッシュ優先。裏で取り直して次回に備える。
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
