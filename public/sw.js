/* Creed service worker — web push + a conservative offline fetch handler.
 *
 * SAFETY POSTURE (read before touching this file):
 *   This SW ships straight to every user via deploy-to-main and CANNOT be
 *   tested locally first. Two failure modes are UNACCEPTABLE:
 *     (a) pinning users to stale app code, and
 *     (b) breaking page loads.
 *   Every rule below is chosen so that safety beats caching aggressiveness:
 *     - Navigations (top-level HTML) are NETWORK-FIRST; the cache is only a
 *       last-resort offline fallback, and only for the SAME route (never the
 *       '/' shell substituted for /portal, /status, …).
 *     - Next.js dynamic payloads — RSC flight fetches (soft navigations /
 *       <Link> prefetches), /_next/data JSON, and /_next/image — are passed
 *       STRAIGHT THROUGH (network-first, never cached), so a deploy is never
 *       masked by a stale cached copy.
 *     - Only content-hashed /_next/static assets are cache-first (new builds
 *       mint new URLs, so this can never serve stale code).
 *     - Stale-while-revalidate is limited to an explicit static ALLOWLIST
 *       (icons, manifest, fonts, images) — not a catch-all — so no dynamic
 *       same-origin route can slip into the cache.
 *     - Everything else same-origin, /api, non-GET, and cross-origin is passed
 *       straight through, untouched.
 *     - ALL cache logic is wrapped so any thrown error / rejected promise
 *       degrades to a plain fetch(request) — a bug must never fail a request.
 *     - The cache is size-capped (FIFO) and CACHE_NAME is bumped on behaviour
 *       changes so activate() purges the previous version.
 */

const CACHE_NAME = "creed-cache-v2";
const APP_SHELL = "/";
// Hard ceiling on cached entries. Prevents unbounded growth from accumulated
// build chunks across many deploys (FIFO-evicted oldest-first, which naturally
// drops previous builds' hashed assets before the current one's).
const MAX_CACHE_ENTRIES = 200;

/* ------------------------------------------------------------------ *
 * Push / notification handlers — DO NOT MODIFY (kept verbatim).
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Lifecycle — skipWaiting + clients.claim kept as-is; activate also
 * prunes any old-versioned caches so a bumped CACHE_NAME cleans up.
 * ------------------------------------------------------------------ */

// Take control immediately on update so a new SW version doesn't sit waiting.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Defensive cleanup: drop every cache that isn't the current version so
      // a future CACHE_NAME bump evicts stale assets. Best-effort — a failure
      // here must not block activation.
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key))),
        );
      } catch (_e) {
        /* ignore — cleanup is best-effort */
      }
      try {
        await self.clients.claim();
      } catch (_e) {
        /* ignore */
      }
    })(),
  );
});

/* ------------------------------------------------------------------ *
 * Fetch — conservative offline handler.
 * ------------------------------------------------------------------ */

// True only for a response we are allowed to persist: a real, complete,
// same-origin 200 that isn't opaque/partial/redirected. Anything else is
// served but never written to the cache.
function isCacheableResponse(response) {
  return (
    !!response &&
    response.status === 200 &&
    response.type !== "opaque" &&
    response.type !== "opaqueredirect" &&
    response.type !== "error" &&
    !response.redirected
  );
}

// A GET Request with no Range header — the only kind Cache.put accepts
// cleanly (206 Partial Content / ranged requests must never be stored).
function isCacheableRequest(request) {
  return request.method === "GET" && !request.headers.has("range");
}

// caches.match can reject in rare conditions (storage pressure / private mode).
// Never let that reject into a handler — a missing cache entry is just undefined.
async function safeMatch(request) {
  try {
    return await caches.match(request);
  } catch (_e) {
    return undefined;
  }
}

// Bound the single cache so it can't grow forever across deploys. FIFO: the
// oldest inserted entries (previous builds' hashed chunks) are dropped first.
// Best-effort — a failure here must never surface to the caller.
async function trimCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const overflow = keys.length - MAX_CACHE_ENTRIES;
    if (overflow <= 0) return;
    for (let i = 0; i < overflow; i++) await cache.delete(keys[i]);
  } catch (_e) {
    /* ignore — trimming is best-effort */
  }
}

// Fire-and-forget cache write. Clones the response, guards every failure
// mode, trims afterward, and never rejects into the caller.
function putInCache(request, response) {
  if (!isCacheableRequest(request) || !isCacheableResponse(response)) return;
  let clone;
  try {
    clone = response.clone();
  } catch (_e) {
    return;
  }
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, clone))
    .then(() => trimCache())
    .catch(() => {
      /* ignore — caching is best-effort, must never surface an error */
    });
}

// NETWORK-FIRST — navigations (top-level HTML). Online users always get the
// freshest deploy; the cache is a pure offline fallback. On network failure we
// try THIS route's own cached copy, then (only for a root navigation) the
// cached app shell, then a minimal inline offline page — so a load never
// hard-fails and we never serve one route's HTML for a different route.
async function handleNavigate(request, url) {
  try {
    const network = await fetch(request);
    if (isCacheableResponse(network)) putInCache(request, network);
    return network;
  } catch (_e) {
    // Offline. Guard every cache lookup so a caches.match rejection still
    // yields the inline offline page rather than failing the navigation.
    let cached;
    try {
      cached = await caches.match(request);
      if (!cached && (url.pathname === "/" || url.pathname === "")) {
        // Only reuse the '/' shell for an actual root navigation — never for
        // /portal, /status, /s/[slug], … (cross-route content contamination).
        cached = await caches.match(APP_SHELL);
      }
    } catch (_e2) {
      cached = undefined;
    }
    if (cached) return cached;
    return new Response(
      "<!doctype html><meta charset=utf-8>" +
        '<meta name=viewport content="width=device-width,initial-scale=1">' +
        "<title>Offline</title>" +
        "<body style=\"font-family:system-ui,-apple-system,sans-serif;" +
        "background:#040406;color:#e5e7eb;display:flex;align-items:center;" +
        'justify-content:center;height:100vh;margin:0;text-align:center">' +
        "<div><h1 style=\"font-size:20px;margin:0 0 8px\">You're offline</h1>" +
        '<p style="opacity:.7;margin:0">Reconnect and try again.</p></div>',
      {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}

// CACHE-FIRST — content-hashed immutable assets (/_next/static/*). A new build
// mints new hashed URLs, so a cache hit here is always safe/current.
async function handleImmutable(request) {
  const cached = await safeMatch(request);
  if (cached) return cached;
  const network = await fetch(request);
  if (isCacheableResponse(network)) putInCache(request, network);
  return network;
}

// STALE-WHILE-REVALIDATE — a tight allowlist of same-origin static assets
// (icons, manifest, fonts, images). Serve cache immediately when present while
// refreshing in the background (kept alive via waitUntil); otherwise wait on
// the network.
async function handleStaleWhileRevalidate(request, event) {
  const cached = await safeMatch(request);
  const networkPromise = fetch(request)
    .then((network) => {
      if (isCacheableResponse(network)) putInCache(request, network);
      return network;
    })
    .catch(() => undefined);
  if (cached) {
    // Keep the revalidation alive past respondWith so the SW isn't terminated
    // before the cache is refreshed — but return the cached copy now.
    try {
      event.waitUntil(networkPromise);
    } catch (_e) {
      /* ignore — waitUntil may be unavailable in some contexts */
    }
    return cached;
  }
  const network = await networkPromise;
  if (network) return network;
  // Nothing cached and the network failed: propagate a real fetch rejection
  // to the top-level handler, which degrades to a plain fetch(request).
  return fetch(request);
}

// Same-origin static assets we're willing to persist (outside /_next/static/,
// which is handled cache-first above). Deliberately NARROW: fonts + images by
// extension, plus the PWA icon/manifest paths. Note it excludes .js/.css so
// /sw.js and any dynamically-served script never get cached and pinned.
const STATIC_ASSET_EXT =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot)$/i;
function isStaticAsset(url) {
  return (
    url.pathname === "/manifest.json" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/screenshots/") ||
    STATIC_ASSET_EXT.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever intercept same-origin GET. Non-GET (POST/PATCH/PUT/DELETE) and
  // cross-origin (supabase.co, OpenAI, Stripe, fonts CDNs, …) are left fully
  // untouched — no respondWith, so the browser handles them normally.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_e) {
    return; // unparseable URL — let the browser deal with it
  }
  if (url.origin !== self.location.origin) return;

  // Never cache API calls — always pass straight through to the network.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations (top-level HTML documents) → network-first.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(request, url).catch(() => fetch(request)));
    return;
  }

  // Content-hashed build output → cache-first (safe: hashed URLs).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleImmutable(request).catch(() => fetch(request)));
    return;
  }

  // Next.js DYNAMIC payloads must stay network-first (never cached), or a
  // deploy gets masked by a stale copy: RSC flight fetches (soft navigations /
  // <Link> prefetches), the /_next/data JSON, and the /_next/image optimizer.
  // Detect RSC by header / query / Accept; detect the others by path. We do
  // NOT respondWith — passing straight through means the browser hits the
  // network directly (freshest wins) and nothing is stored.
  const accept = request.headers.get("accept") || "";
  const isRsc =
    request.headers.has("rsc") ||
    request.headers.has("next-router-prefetch") ||
    url.searchParams.has("_rsc") ||
    accept.includes("text/x-component");
  if (
    isRsc ||
    url.pathname.startsWith("/_next/data/") ||
    url.pathname.startsWith("/_next/image")
  ) {
    return;
  }

  // Known-static assets (icons, manifest, fonts, images) → stale-while-
  // revalidate. This is an explicit allowlist, not a catch-all.
  if (isStaticAsset(url)) {
    event.respondWith(
      handleStaleWhileRevalidate(request, event).catch(() => fetch(request)),
    );
    return;
  }

  // Anything else same-origin (dynamic HTML/JSON routes, /sw.js, sitemap/OG
  // routes, future endpoints outside /api/, …) is left untouched — the browser
  // hits the network directly. Conservative default: cache only the proven-safe.
});
