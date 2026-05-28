/*
  Service Worker do Fechou! - PWA Cache & Instalabilidade
  Criado com amor para permitir a instalação nativa rápida.
*/

const CACHE_NAME = "fechou-cache-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-512.png",
  "./pix-qr.png"
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

// Ativação: Limpa caches antigos
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

// Interceptador de Requisições: Network-First (com fallback de Cache)
self.addEventListener("fetch", (e) => {
  // Ignora requisições de APIs ou origens externas (ex: Upstash API, Google Fonts)
  if (!e.request.url.startsWith(self.location.origin)) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Se a resposta for válida e bem-sucedida, atualiza o cache local
        if (response && response.status === 200 && response.type === "basic") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Em caso de offline ou falha de rede, busca no cache local
        return caches.match(e.request);
      })
  );
});
