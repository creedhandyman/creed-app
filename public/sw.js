/* Creed service worker — web push + a pass-through fetch handler so the app is
 * installable. Offline caching is added in the offline phase; until then fetch
 * is untouched, so this can't pin users to a stale app version. */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Creed";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || undefined, // collapse duplicates when a tag is given
    data: { url: payload.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        // Focus an already-open app window if there is one; else open fresh.
        for (const w of wins) {
          if ("focus" in w) {
            w.focus();
            if ("navigate" in w && url !== "/") w.navigate(url).catch(() => {});
            return;
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

// Take control immediately on update so a new SW version doesn't sit waiting.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A registered fetch handler is what makes the app installable (and is where
// offline caching will live in the next phase). Pass-through for now — requests
// hit the network as usual; no caching yet.
self.addEventListener("fetch", () => {});
