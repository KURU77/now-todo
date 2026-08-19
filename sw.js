// オフラインでも開けるようにするための Service Worker。
// タスクのデータは localStorage にあるので、ここでは扱わない。
//
// 方針: 1つの版のファイル一式を、インストール時にまとめてキャッシュし、
// **あとから個別に書き換えない**。配信中に一部だけ新しくすると、
// 新しいHTMLと古いCSSのように世代が混ざって表示が壊れる。
// 更新は VERSION を上げることでのみ起こり、次の起動から一式が入れ替わる。

const VERSION = 'v1.5.0';
const CACHE = `now-todo-${VERSION}`;

// これが無いとオフラインで起動できない。1つでも欠けたらインストールを失敗させる。
// （中途半端に入って「オフラインだと白い画面」になるより、失敗させて次回やり直すほうがよい）
const CORE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/store.js',
  './js/suggest.js',
  './js/scheduler.js',
  './js/ai.js',
  './js/notify.js',
  './js/calendar.js',
];

// 無くても起動はできるもの（アイコン類）。失敗しても止めない。
const EXTRA = [
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 本体は addAll。1つでもコケたら例外が飛び、インストールは失敗する（＝古い版が残る）。
      await cache.addAll(CORE);
      // アイコンは個別に。落ちても本体の動作には関係ない。
      await Promise.allSettled(EXTRA.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
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
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // AIの呼び出しなどは素通し

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // ページ遷移。?v=... のような問い合わせが付いていても index.html を返す。
      if (request.mode === 'navigate') {
        return (await cache.match('./index.html')) || fetch(request);
      }

      // アプリ本体はこの版のキャッシュから返す。混ざらないよう書き戻さない。
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;

      // キャッシュに無いもの（将来追加したファイルなど）はネットワークへ。
      try {
        return await fetch(request);
      } catch {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })(),
  );
});
