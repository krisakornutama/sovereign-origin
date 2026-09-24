// probe.mjs — verifier: checks the captured PNG against PROBES declared in plate.mjs.
// Composition coordinates come from the plate module, never from hardcoded guesses.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { PALETTE, PROBES } from './plate.mjs';

const require = createRequire('E:/My work/Project Sovereign Origin/sovereign-os/core-api/package.json');
const { PNG } = require('pngjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const { width: W, height: H, data } = PNG.sync.read(fs.readFileSync(path.join(here, 'quiescent-signal.png')));

const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (a, b, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

let failed = 0;
for (const p of PROBES) {
  let ok, where = '';
  if (p.kind === 'px') {
    ok = near(px(...p.px), rgb(PALETTE[p.color]));
    where = `@ ${p.px}`;
  } else {
    const [x0, y0, x1, y1] = p.box;
    where = `@ box ${p.box}`;
    if (p.kind === 'box') {
      ok = false;
      for (let y = y0; y < y1 && !ok; y++)
        for (let x = x0; x < x1; x++)
          if (near(px(x, y), rgb(PALETTE[p.color]))) { ok = true; break; }
    } else { // clean: nothing brighter than max
      ok = true;
      for (let y = y0; y < y1 && ok; y++)
        for (let x = x0; x < x1; x++)
          if (px(x, y).some((v) => v > p.max)) { ok = false; break; }
    }
  }
  if (!ok) failed++;
  console.log((ok ? '✓' : '✗') + ' ' + p.name + (ok ? '' : ' ' + where));
}
console.log(failed === 0 ? `ALL ${PROBES.length} PROBES PASS` : failed + ' OF ' + PROBES.length + ' PROBES FAILED');
process.exit(failed === 0 ? 0 : 1);
