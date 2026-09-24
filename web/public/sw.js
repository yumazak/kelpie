// kelpie's service worker: receive a push and show it, and open the right
// session when it is tapped.
//
// The bridge sends `{ title, body, tag, session_id }`. A missing field degrades
// to a plain notification rather than a dropped one.
//
// The tapped session is written to Cache Storage as well as the URL: some
// platforms (notably iOS) open the installed PWA at its start_url and drop the
// query, so the app reads this on launch.

const NAV_CACHE = "kelpie-nav";
const PENDING_KEY = "/pending-session";

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "kelpie";
  const options = {
    body: data.body || "",
    tag: data.tag || "kelpie",
    renotify: true,
    data: { sessionId: data.session_id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const sessionId = event.notification.data && event.notification.data.sessionId;
  const url = sessionId ? `/?session=${encodeURIComponent(sessionId)}` : "/";
  event.waitUntil(
    (async () => {
      if (sessionId) {
        try {
          const cache = await caches.open(NAV_CACHE);
          await cache.put(PENDING_KEY, new Response(sessionId));
        } catch {
          /* the URL below is the fallback */
        }
      }
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
