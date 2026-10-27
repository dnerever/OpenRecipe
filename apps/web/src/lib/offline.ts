import { useSyncExternalStore } from 'react';

/**
 * The page's half of offline support; `public/sw.js` is the other half.
 *
 * Registered only in a production build: in development Vite serves modules
 * that no list could name in advance, and a worker caching them would serve
 * yesterday's code to the person editing today's. `MODE`, not `PROD`: `PROD`
 * follows `NODE_ENV`, and the repo's `.env` sets that to development for the
 * API — a local `vite build` would quietly ship without offline support.
 */
export function registerOfflineSupport(): void {
  if (import.meta.env.MODE !== 'production' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`/sw.js?build=${__BUILD_ID__}`).catch(() => {
      // No offline copies this visit; everything else works as before.
    });
  });
}

/**
 * Throws away every recipe and photo this browser kept. Called on signing out
 * and on deleting an account: a private recipe you opened is in that cache,
 * and the next person to use this browser should not find it there.
 */
export async function clearOfflineCopies(): Promise<void> {
  if (!('caches' in window)) return;
  await Promise.all(
    ['openskillet-recipes', 'openskillet-media'].map((name) => caches.delete(name)),
  );
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

/** Whether the browser believes it has a network. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
