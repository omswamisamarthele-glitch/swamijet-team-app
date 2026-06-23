const APP_VERSION = '5.9.40';
const CACHE = 'swamijet-v5940';
const ASSETS = ['./','./index.html','./manifest.json','./version.json','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS).catch(function(){}); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    var keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
    var clients = await self.clients.matchAll();
    clients.forEach(function(c){ c.postMessage({ type:'NEW_VERSION', version: APP_VERSION }); });
  })());
});

self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);

  // v5.6.2: HTML + version.json are NETWORK-FIRST so new deploys appear
  // immediately (no more stale cached builds). Cache is used only when offline.
  var isHTML = e.request.mode === 'navigate'
            || url.pathname.endsWith('/')
            || url.pathname.endsWith('index.html')
            || url.pathname.endsWith('version.json');

  if (isHTML) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(function(resp){
        if (resp && resp.ok && resp.type === 'basic') {
          var cl = resp.clone();
          caches.open(CACHE).then(function(c){ c.put('./index.html', cl); });
        }
        return resp;
      }).catch(function(){
        return caches.match(e.request).then(function(r){ return r || caches.match('./index.html'); });
      })
    );
    return;
  }

  // Other assets: cache-first (fast + offline friendly).
  e.respondWith(
    caches.match(e.request).then(function(r){
      if (r) return r;
      return fetch(e.request).then(function(resp){
        if (resp && resp.ok && resp.type === 'basic') {
          var cl = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, cl); });
        }
        return resp;
      }).catch(function(){ return caches.match('./index.html'); });
    })
  );
});

self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
