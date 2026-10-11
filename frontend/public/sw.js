/*
 * Service worker do app. Guarda as respostas do proprio site para a casca e as telas ja visitadas
 * abrirem sem sinal. A API fica de fora, porque e outra origem e os dados dela sao guardados pela
 * aplicacao em IndexedDB, onde da para limpar ao sair da conta.
 */

const CACHE = "controle-financas-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((chave) => chave !== CACHE).map((chave) => caches.delete(chave))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Arquivos com hash no nome nunca mudam, entao o cache responde sem ir a rede
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheDepoisRede(request));
    return;
  }

  event.respondWith(redeDepoisCache(request));
});

async function cacheDepoisRede(request) {
  const cache = await caches.open(CACHE);
  const salva = await cache.match(request);
  if (salva) return salva;
  const resposta = await fetch(request);
  if (resposta.ok) cache.put(request, resposta.clone());
  return resposta;
}

async function redeDepoisCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const resposta = await fetch(request);
    if (resposta.ok) cache.put(request, resposta.clone());
    return resposta;
  } catch (err) {
    const salva = await cache.match(request);
    if (salva) return salva;
    // Sem a tela exata guardada, a navegacao cai na pagina inicial do app, que ja foi visitada antes
    if (request.mode === "navigate") {
      const app = await cache.match("/app");
      if (app) return app;
    }
    throw err;
  }
}
