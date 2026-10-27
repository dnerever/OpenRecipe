/**
 * Offline copies, for the kitchen.
 *
 * A recipe is read where the Wi-Fi is worst, and losing the connection
 * halfway through a method should not lose the method. So this keeps:
 *
 *   - the app itself: every built script and stylesheet, listed by the build
 *     in `precache.json`, fetched when this worker installs — cook mode's
 *     code is there offline even if cook mode was never opened online;
 *   - each recipe you open, and its photo, as of the last time you opened it;
 *   - the page shell, so any address still starts the app.
 *
 * Network first for everything that can change, so online nothing is ever
 * stale; the copy is only what you get when there is no network to ask.
 * Writes (saving, starring, proposing) are never cached or queued: offline,
 * they fail the way they always did, and say so.
 *
 * The build id arrives on this file's own URL (`/sw.js?build=…`), so every
 * deploy is a new worker: it installs the new app, and on activating throws
 * away the previous build's caches.
 */
const BUILD = new URL(self.location.href).searchParams.get('build') || 'dev';
const APP = `openskillet-app-${BUILD}`;
// Unversioned: a recipe saved last week is still worth having after a deploy.
const RECIPES = 'openskillet-recipes';
const MEDIA = 'openskillet-media';
const SHELL = '/__shell';
/** Enough for every recipe a person is actually cooking from, not a mirror of the site. */
const MAX_RECIPES = 60;
const MAX_MEDIA = 60;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP);
      const manifest = await fetch('/precache.json', { cache: 'no-cache' }).then((r) => r.json());
      await cache.addAll(manifest.files);
      const shell = await fetch('/', { cache: 'no-cache' });
      if (shell.ok) await cache.put(SHELL, shell);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('openskillet-app-') && name !== APP)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** `/api/recipes/:handle/:slug` — the recipe itself, not its history or forks. */
const RECIPE_API = /^\/api\/recipes\/[^/]+\/[^/]+$/;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, APP));
  } else if (request.mode === 'navigate') {
    event.respondWith(page(request));
  } else if (RECIPE_API.test(url.pathname)) {
    event.respondWith(networkFirst(request, RECIPES, MAX_RECIPES));
  } else if (url.pathname.startsWith('/api/media/')) {
    event.respondWith(networkFirst(request, MEDIA, MAX_MEDIA));
  }
});

/** Hashed files never change under the same name, so a cached one is always right. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(cacheName)).put(request, response.clone());
  return response;
}

/**
 * Pages: the network's answer when there is one — it carries the page's own
 * title and status — and otherwise the shell, which the app turns into the
 * right page from the address and whatever recipes it has saved.
 */
async function page(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(APP)).put(SHELL, response.clone());
    return response;
  } catch {
    return (await caches.match(SHELL)) ?? Response.error();
  }
}

async function networkFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Deleted first so the fresh copy goes to the back of the line `trim` reads.
      await cache.delete(request);
      await cache.put(request, response.clone());
      void trim(cache, max);
    } else if (response.status === 404) {
      // Deleted, or no longer yours to see: the saved copy goes too.
      await cache.delete(request);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

/** Oldest first: `keys()` is in insertion order. */
async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}
