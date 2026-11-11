/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

// Take control of open pages as soon as this service worker activates.
clientsClaim();

// Drop caches from previous app versions on activation.
cleanupOutdatedCaches();

// Precache the app shell: index.html, JS/CSS bundles, the pdf.js worker and icons.
// This is what makes the app open and generate documents while offline.
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback: serve the precached shell for every in-app route.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Apps Script database + Google API calls are deliberately NOT cached —
// unmatched requests fall through to the network, so authed POSTs are never stored.

// Update flow: vite-plugin-pwa's registerSW asks the waiting worker to activate.
self.addEventListener('message', (event) => {
  const data = (event as ExtendableMessageEvent).data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// Background Sync relay (where the platform supports it): ask open windows to
// flush the offline outbox. The app-side flush engine works without this too.
self.addEventListener('sync', (event) => {
  const syncEvent = event as ExtendableEvent & { tag?: string };
  if (syncEvent.tag !== 'hays-outbox') return;
  syncEvent.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({ type: 'HAYS_FLUSH_OUTBOX' });
      }
    })
  );
});
