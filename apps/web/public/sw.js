/**
 * Bale Drop service worker — the browser half of push notifications.
 *
 * `push_subscriptions` (migration 0029) stores the endpoints and the
 * `push-send` Edge Function fans a `notifications` row out to them. Without a
 * service worker none of that reaches a closed tab, which is exactly when an
 * escrow release or a refund matters most.
 *
 * Deliberately minimal: no precaching, no offline shell. A stale worker that
 * serves cached HTML is worse than no worker on a commerce site where prices
 * change, and the app is already fast on a low-end Android (UX research §7).
 */
self.addEventListener("install", () => {
  // Activate immediately; there is no cache to warm.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Bale Drop", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Bale Drop";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      // Same tag per destination collapses repeat notices for one order.
      tag: payload.tag || "bale-drop",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/" },
      renotify: Boolean(payload.tag),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an open tab instead of stacking duplicates.
      for (const client of clients) {
        if ("focus" in client) {
          try {
            client.navigate(url);
          } catch {
            /* cross-origin or closed — fall through to a new window */
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
