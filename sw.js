/*
  Service Worker do Fechou! - PWA Cache & Instalabilidade
  Cache v35 - Compatibilidade total com GitHub Pages /Fechou/
*/

const CACHE_NAME = "fechou-cache-v46";
const ASSETS = [
  "/Fechou/",
  "/Fechou/index.html",
  "/Fechou/style.css",
  "/Fechou/app.js",
  "/Fechou/manifest.json",
  "/Fechou/icon-512.png",
  "/Fechou/pix-qr.png",
  "/Fechou/sw.js",
  "/Fechou/404.html"
];

// Instalação: Cacheia todos os arquivos estáticos
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Cacheando assets principais");
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Ativação: Limpa caches antigos e assume controle imediato
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removendo cache antigo:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-First: tenta buscar da rede, cai no cache se offline
self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Ignora origens externas (APIs, CDNs, ImgBB, Upstash, etc.)
  if (!url.startsWith(self.location.origin)) return;

  // Ignora requisições de método não-GET
  if (e.request.method !== "GET") return;

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Cache somente respostas válidas do próprio origin
        if (response && response.status === 200 && response.type === "basic") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: busca no cache. Se não achar, serve a página principal
        return caches.match(e.request).then((cached) => {
          return cached || caches.match("/Fechou/index.html");
        });
      })
  );
});
