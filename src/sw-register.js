/* Resolved against this module's URL, not the document's, so registration works
   unchanged from a domain root or a GitHub Pages project subpath. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url))
      .catch(() => { /* offline support is optional; the app still runs */ });
  });
}
