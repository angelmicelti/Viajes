/* ======================================================================
   Service Worker de Mi Viaje
   - Network-first para el documento HTML (versiones frescas al instante).
   - Cache-first para assets estáticos (icons, manifest).
   - Las APIs externas (Firebase, Open-Meteo, OSRM, Nominatim, Wikipedia)
     pasan siempre a la red: el SW solo intercepta el mismo origen.
   - Versión de la app expuesta al cliente vía postMessage.
   ====================================================================== */

// La versión de la app: cambia este valor con cada release. Se envía al
// cliente (index.html) para mostrarla en el chip de versión dinámico.
const APP_VERSION = '1.33.0';

// El nombre del caché lleva la versión: al cambiar APP_VERSION, el SW
// considera obsoleto el caché anterior y lo purga en 'activate'.
const CACHE_NAME = 'miviaje-v' + APP_VERSION;

// Shell de la app (recursos del mismo origen que index.html).
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icons/favicon-32.png',
    './icons/favicon-16.png',
    './icons/apple-touch-icon.png'
];

// ---- Instalación: precachear el shell ----------------------------------
self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            // addAll falla si algún recurso no existe; lo toleramos
            return cache.addAll(APP_SHELL).catch(function () {});
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

// ---- Activación: purgar cachés antiguas y tomar el control -------------
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) { return k !== CACHE_NAME; })
                    .map(function (k) { return caches.delete(k); })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

// ---- Fetch -------------------------------------------------------------
self.addEventListener('fetch', function (event) {
    const req = event.request;
    if (req.method !== 'GET') return;
    // Solo gestionamos peticiones del mismo origen (recursos de la app);
    // las APIs externas (Firebase, Open-Meteo, OSRM, Nominatim, Wikipedia,
    // gstatic, Google Maps, Tailwind CDN, fuentes de Google...) pasan
    // siempre a la red para no romper la edición ni mostrar datos viejos.
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // 1) Navegaciones y documentos HTML: NETWORK-FIRST.
    //    Así, tras un despliegue, el usuario recibe la versión fresca del
    //    index.html sin tener que esperar a un cambio de APP_VERSION.
    //    El caché solo se usa como fallback offline.
    if (req.mode === 'navigate' || req.destination === 'document') {
        event.respondWith(
            fetch(req).then(function (resp) {
                if (resp && resp.status === 200) {
                    const copy = resp.clone();
                    caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
                }
                return resp;
            }).catch(function () {
                // Sin red: servir el index.html cacheado (offline).
                return caches.match(req).then(function (c) {
                    return c || caches.match('./index.html');
                });
            })
        );
        return;
    }

    // 2) Resto de recursos del mismo origen: CACHE-FIRST con fallback a red.
    //    Adecuado para icons, manifest y otros assets estables.
    event.respondWith(
        caches.match(req).then(function (cached) {
            if (cached) return cached;
            return fetch(req).then(function (resp) {
                if (resp && resp.status === 200 && resp.type === 'basic') {
                    const copy = resp.clone();
                    caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
                }
                return resp;
            });
        })
    );
});

// ---- Mensajes del cliente: responder con la versión --------------------
self.addEventListener('message', function (event) {
    const data = event.data || {};
    if (data.type === 'GET_VERSION') {
        event.source && event.source.postMessage({
            type: 'APP_VERSION',
            version: APP_VERSION,
            cacheName: CACHE_NAME
        });
    }
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
