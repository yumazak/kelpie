// Web Push from the browser side: register the service worker, ask for
// permission, and hand the subscription to the bridge.

import { fetchPushKey, subscribePush } from "../api";

export type PushState = "unsupported" | "off" | "on" | "denied";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** The VAPID public key is base64url; `subscribe` wants bytes. */function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export async function currentPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;
  if (subscription) return "on";
  return Notification.permission === "denied" ? "denied" : "off";
}

/**
 * The session a notification tap asked to open, if any. The service worker
 * writes it to Cache Storage because some platforms drop the URL query when
 * launching the installed PWA.
 */
export async function consumePendingSession(): Promise<string | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open("kelpie-nav");
    const response = await cache.match("/pending-session");
    if (!response) return null;
    const id = (await response.text()).trim();
    await cache.delete("/pending-session");
    return id || null;
  } catch {
    return null;
  }
}

export async function enablePush(): Promise<PushState> {
  const registration = await registerServiceWorker();
  if (!registration || !("PushManager" in window)) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const { publicKey } = await fetchPushKey();
  if (!publicKey) return "off";

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "off";

  await subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return "on";
}
