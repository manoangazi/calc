/**
 * Guards the one bug the other suites structurally cannot catch: a new module
 * that never reaches the service worker's precache list. Everything passes, the
 * app works in the browser, and it breaks only once the device is offline —
 * which is the one place a PWA is supposed to be reliable.
 */
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0;
const failures = [];

const sw = readFileSync('sw.js', 'utf8');
const precache = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);

for (const file of readdirSync('src')) {
  if (!file.endsWith('.js')) continue;
  if (precache.includes(`src/${file}`)) pass++;
  else failures.push(`src/${file} is not in the sw.js precache list — it will 404 offline`);
}

// The shell itself, which is just as fatal to miss.
for (const asset of ['index.html', 'app.css', 'manifest.webmanifest']) {
  if (precache.includes(asset)) pass++;
  else failures.push(`${asset} is not in the sw.js precache list`);
}

// A stale version means iOS keeps serving the previous app from its cache.
const version = sw.match(/CACHE_VERSION = '([^']+)'/);
if (version) pass++;
else failures.push('sw.js has no CACHE_VERSION');

/*
 * Two more failures that are invisible to every other suite because they only
 * happen in a browser.
 */
const html = readFileSync('index.html', 'utf8');

// ui.js resolves all its element handles at module top level. One typo in an id
// yields null, and the whole app is a blank screen plus one console line.
const ui = readFileSync('src/ui.js', 'utf8');
const selectors = [
  ...[...ui.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => `id="${m[1]}"`),
  ...[...ui.matchAll(/querySelector(?:All)?\('\.([a-z-]+)'\)/g)].map((m) => `class="${m[1]}`),
];
for (const needle of new Set(selectors)) {
  if (html.includes(needle)) pass++;
  else failures.push(`ui.js looks for ${needle}, which is not in index.html`);
}

// The CSP has no 'unsafe-inline', so either of these is blocked in the browser
// while every Node suite still passes.
if (!/\sstyle="/.test(html)) pass++;
else failures.push('index.html has a style="" attribute — the CSP will block it');
if (!/\son[a-z]+="/.test(html)) pass++;
else failures.push('index.html has an inline event handler — the CSP will block it');

if (failures.length) {
  console.error(`${failures.length} failed, ${pass} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`${pass} passed (precache covers every module, ${version[1]})`);
