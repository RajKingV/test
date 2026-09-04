// Mala / Japa Tracker — service worker
// Caches the app shell so it works fully offline once installed.

const CACHE_NAME = "mala-japa-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Cache same-origin successful responses for future offline use
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

// Best-effort local notification trigger (fires only while the SW is active,
// e.g. app open or recently used — PWAs without a push server cannot wake
// the device the way a native app can).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SHOW_REMINDER") {
    self.registration.showNotification(event.data.title || "\ud83d\udd49\ufe0f Time for your Japa", {
      body: event.data.body || "",
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag: "japa-reminder"
    });
  }
});
