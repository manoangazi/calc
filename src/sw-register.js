/* Resolved against this module's URL, not the document's, so registration works
   unchanged from a domain root or a GitHub Pages project subpath. */

const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const isDev = DEV_HOSTS.includes(location.hostname);
const wantsSW = new URLSearchParams(location.search).has('sw');

if ('serviceWorker' in navigator) {
  if (isDev && !wantsSW) {
    /*
     * Local development: stay unregistered and drop any cache left behind.
     *
     * A cache-first worker serves the copy of app.css or index.html it captured
     * on a previous load, so an edit made after that load is invisible in the
     * browser while looking like the edit silently failed. Clearing the cache by
     * hand does not fix it — the next reload re-registers and re-caches, and the
     * trap resets. Not registering at all is the only version that stays fixed.
     *
     * To exercise the worker deliberately (offline behaviour, precache list),
     * load the page with ?sw=1.
     */
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => { /* nothing registered, nothing to undo */ });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(new URL('../sw.js', import.meta.url))
        .catch(() => { /* offline support is optional; the app still runs */ });
    });
  }
}
