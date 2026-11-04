/* ======================================================================
   Service Worker de Mi Viaje
   - Diseñado para convivir con otras apps del mismo portal
     (p. ej. https://angelmicelti.github.io): este SW solo actúa dentro de
     su propia carpeta, solo lee y escribe SU caché y solo purga cachés
     suyas. Nunca intercepta ni borra nada de otros proyectos del origen.
   - Network-first para el documento HTML (versiones frescas al instante).
   - Cache-first para assets estáticos propios (icons, manifest).
   - Las APIs externas (Firebase, Open-Meteo, OSRM, Nominatim, Wikipedia)
     pasan siempre a la red: el SW solo intercepta el mismo origen.
   - Versión de la app expuesta al cliente vía postMessage.
   ====================================================================== */

// La versión de la app: cambia este valor con cada release. Se envía al
// cliente (index.html) para mostrarla en el chip de versión dinámico.
const APP_VERSION = '1.33.3';

// Prefijo propio de caché: permite distinguir las cachés de esta app de las
// de otros proyectos alojados en el mismo origen. Las ajenas no se borran.
const CACHE_PREFIX = 'miviaje-v';
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;

// Carpeta de la app dentro del origen (p. ej. https://host/Viajes/). Todo lo
// que quede fuera de ella pertenece a otros proyectos del portal: este SW no
// lo intercepta, no lo cachea y no toca sus cachés.
const BASE = new URL('./', self.location.href).href;

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

// ---- Activación: purgar SOLO las cachés antiguas de esta app -----------
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            // Solo las cachés con nuestro prefijo y de versiones anteriores.
            // Las de otras apps del portal (mismo origen) se respetan.
            return Promise.all(
                keys.filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME; })
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
    const url = new URL(req.url);
    // Ni otros orígenes ni otras apps del portal: fuera de la carpeta de la
    // app este SW no responde, no cachea y no interfiere.
    if (url.origin !== self.location.origin) return;
    if (url.href.indexOf(BASE) !== 0) return;

    // 1) Navegaciones y documentos HTML: NETWORK-FIRST.
    //    Así, tras un despliegue, el usuario recibe la versión fresca del
    //    index.html sin tener que esperar a un cambio de APP_VERSION.
    //    La caché propia solo se usa como fallback offline.
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
                return caches.open(CACHE_NAME).then(function (c) {
                    return c.match(req).then(function (hit) {
                        return hit || c.match('./index.html');
                    });
                });
            })
        );
        return;
    }

    // 2) Resto de recursos propios: CACHE-FIRST con fallback a red,
    //    leyendo y escribiendo solo en la caché de esta app.
    event.respondWith(
        caches.open(CACHE_NAME).then(function (c) {
            return c.match(req).then(function (cached) {
                if (cached) return cached;
                return fetch(req).then(function (resp) {
                    if (resp && resp.status === 200 && resp.type === 'basic') {
                        const copy = resp.clone();
                        c.put(req, copy);
                    }
                    return resp;
                });
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
});
