// Service worker for TAEYEON's Music Archive.
// 1. Lets the site open as an app, and open without internet. Always tries the internet
//    first, so edits to songs.js show up right away.
// 2. Plays downloaded songs without internet: songs saved with the Download button are
//    requested as "...mp3?dl=1" and answered from the device's storage. All other songs
//    stream from the internet exactly as before (this file doesn't touch them).
const CACHE = "tma-shell-v2";
const OFFLINE = "tma-offline-v1";          // must match OFFLINE_CACHE in index.html
const SHELL = ["./", "index.html", "songs.js", "translations.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith("tma-") && k !== CACHE && k !== OFFLINE)
        .map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Downloaded songs
  if (url.searchParams.get("dl") === "1" && /\.mp3$/i.test(url.pathname)) {
    e.respondWith(fromOffline(req, url));
    return;
  }

  // The player's own files: internet first, saved copy when offline
  if (url.origin !== location.origin || /\.mp3$/i.test(url.pathname) || req.headers.has("range")) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("./")))
  );
});

async function fromOffline(req, url) {
  url.searchParams.delete("dl");
  const key = url.toString();
  const hit = await (await caches.open(OFFLINE)).match(key);
  if (!hit) return fetch(key, { mode: "cors" });   // not saved (anymore): stream it as usual

  const range = req.headers.get("range");
  const type = hit.headers.get("Content-Type") || "audio/mpeg";
  const blob = await hit.blob();
  const size = blob.size;
  if (!range) {
    return new Response(blob, { status: 200, headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
  }
  // Audio players ask for pieces of the file ("bytes=START-END"): answer with just that piece
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = 0, end = size - 1;
  if (m) {
    if (m[1] === "" && m[2] !== "") { start = Math.max(0, size - +m[2]); }       // last N bytes
    else { start = +m[1] || 0; if (m[2] !== "") end = Math.min(+m[2], size - 1); }
  }
  if (start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": type,
      "Content-Length": String(end - start + 1),
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Accept-Ranges": "bytes"
    }
  });
}
