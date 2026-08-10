/** Runs every suite. `node test/run.mjs` */
import { spawnSync } from 'node:child_process';

const suites = [
  'test/engine.test.mjs',
  'test/hex.test.mjs',
  'test/assets.test.mjs',
  'test/fuzz.test.mjs',
];
let failed = false;

for (const suite of suites) {
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
