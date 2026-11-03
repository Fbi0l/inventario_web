/* Service worker do Inventário instalável (1.6.0).
   - Guarda SÓ arquivos do próprio site e das bibliotecas fixas dos CDNs, para o app abrir rápido.
   - NUNCA guarda nada do Supabase (login, equipamentos, movimentações, termos em PDF): esses pedidos passam direto.
   - Rede primeiro: com internet, sempre usa a versão publicada mais nova; a cópia só é usada sem conexão. */
'use strict';
const CACHE = 'inventario-app-v1';
const PERMITIDOS = [self.location.origin, 'https://cdn.jsdelivr.net', 'https://cdn.sheetjs.com'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './assets/icone-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(nomes => Promise.all(nomes.filter(n => n.startsWith('inventario-app-') && n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  const url = new URL(req.url);
  // Só GET de arquivos do próprio site (dentro da pasta do app) e dos CDNs fixos; todo o resto passa direto, sem cópia.
  if (req.method !== 'GET' || !PERMITIDOS.includes(url.origin)) return;
  if (url.origin === self.location.origin && !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resp = await fetch(req);
      if (resp.ok && (resp.type === 'basic' || resp.type === 'cors')) cache.put(req, resp.clone());
      return resp;
    } catch (_) {
      const salvo = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./') : undefined);
      return salvo || new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
