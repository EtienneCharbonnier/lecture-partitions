/* Hors connexion pour les navigateurs récents (Mac, téléphone). L'iPad 2 utilise lecteur.appcache. */
var CACHE = 'partitions-v1';
var CORE = ['./', 'index.html', 'app.js', 'notation.js', 'icone.png', 'bibliotheque/index.json'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (/atelier|musicxml\.js/.test(req.url)) return;
  /* réseau d'abord (pour recevoir les nouveaux morceaux), cache si hors ligne */
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req, { ignoreSearch: true }); }));
});
