// Client-side Web Push helpers. Push-only (the service worker does no caching).
//
// Flow: register /sw.js → request Notification permission → subscribe via the
// PushManager with our VAPID public key → POST the subscription to the server
// (/api/push/subscribe), which stores it for dispatchNotifications() to send to.
//
// iOS note: PushManager only exists inside an INSTALLED PWA (Add to Home Screen,
// iOS 16.4+), not a plain Safari tab — so isPushSupported() is false there and
// the Settings UI nudges the user to install first.
import { apiFetch } from "./api";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!VAPID_PUBLIC
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Back it with an explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer>
  // (a valid BufferSource for pushManager.subscribe), not <ArrayBufferLike>.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  const reg = existing || (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  return reg;
}

/** True if this browser currently holds an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
  try {
    if (!isPushSupported()) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/** Register the SW, ask permission, subscribe, and persist server-side. */
export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { ok: false, error: "Push isn't available on this browser." };
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, error: "Notification permission wasn't granted." };
    }
    const reg = await getRegistration();
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      }));
    const res = await apiFetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }),
    });
    if (!res.ok) return { ok: false, error: "Couldn't save the subscription." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Push setup failed." };
  }
}

/** Unsubscribe this device and forget it server-side. Best-effort. */
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await apiFetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch {
    /* ignore */
  }
}
