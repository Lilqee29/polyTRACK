const CACHE = "polytrack-v2";
const CORE = [
  "/",
  "/index.html",
  "/css/style.css",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/js/main.js",
  "/js/track.js",
  "/js/presets.js",
  "/js/library.js",
  "/js/editor.js",
  "/js/scene.js",
  "/js/car.js",
  "/js/ai.js",
  "/js/hud.js",
  "/js/race.js",
  "/js/net.js",
  "/js/vendor/three.module.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("polytrack-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      let hit = await cache.match(req, { ignoreSearch: true });
      if (!hit && req.mode === "navigate") hit = await cache.match("/index.html");
      const update = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        update.then(() => {});
        return hit;
      }
      const res = await update;
      return res || Response.error();
    })
  );
});
