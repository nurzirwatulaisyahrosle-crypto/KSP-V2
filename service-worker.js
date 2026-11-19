const CACHE_NAME = 'ksp-pwa-shell-v1';
const SHELL = ['./', './index.html', './style.css', './script.js', './manifest.webmanifest', './app-icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => { const request = event.request; if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return; event.respondWith(fetch(request).catch(() => caches.match(request))); });
