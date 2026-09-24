// behavior-check.mjs — proves the plate/engine/verifier pipeline BEHAVES, not just renders.
// 1) negative path: damaging the PNG must fail the probe with exit != 0
// 2) plate ownership: moving a stratum in plate.mjs must move the pixels (hash) and the verifier follows
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { LAYOUT, SHEET } from './plate.mjs';

const { PNG } = createRequire('E:/My work/Project Sovereign Origin/sovereign-os/core-api/package.json')('pngjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const PNG_PATH = path.join(here, 'quiescent-signal.png');
const RENDER_ENV = { cwd: here, encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: 'E:/My work/Project Sovereign Origin/.playwright-browsers' } };

// baseline: always rebuild from the untouched plate so a poisoned/crashed previous run
// can never define what "correct" is
execFileSync(process.execPath, ['render-sheet.mjs'], RENDER_ENV);
const GOOD = fs.readFileSync(PNG_PATH);

const run = (args, opt = {}) => {
  try {
    const out = execFileSync(process.execPath, ['probe.mjs'], { cwd: here, encoding: 'utf8', ...opt });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout + (e.stderr ?? '') };
  }
};

let bad = 0;
const expect = (name, cond, detail = '') => {
  console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' — ' + detail));
  if (!cond) bad++;
};

// ---- test 1: tampering must break the probe (negative path) ----
{
  const { width: W, height: H, data } = PNG.sync.read(GOOD);
  // paint over the deviation + echo with paper color (destroy the ember)
  const setPx = (x, y, [r, g, b]) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
  const paper = [16, 19, 21];
  const ex = LAYOUT.trace.x0 + LAYOUT.trace.deviationDx;
  for (let y = LAYOUT.trace.y - 200; y < LAYOUT.trace.y; y++)
    for (let x = ex - 40; x < ex + 40; x++) setPx(x, y, paper);
  for (let y = LAYOUT.trace.y - 170; y < LAYOUT.trace.y - 130; y++)
    for (let x = SHEET.W - SHEET.M - 20; x < SHEET.W - SHEET.M; x++) setPx(x, y, paper);
  const damaged = PNG.sync.write({ width: W, height: H, data });
  fs.writeFileSync(PNG_PATH, damaged);

  const r = run([]);
  expect('damaged PNG → probe exits non-zero', r.code !== 0, 'exit=' + r.code);
  expect('damaged PNG → names the failing probe', /✗ the deviation \(ember\)/.test(r.out), r.out.split('\n').filter((l) => l.startsWith('✗')).join(' | '));
}

// ---- test 2: plate owns the pixels — move a stratum in plate.mjs, image must move ----
{
  fs.writeFileSync(PNG_PATH, GOOD); // restore
  const platePath = path.join(here, 'plate.mjs');
  const original = fs.readFileSync(platePath, 'utf8');
  const goodPng = PNG.sync.read(GOOD);
  const sample = (buf, x, y) => { const i = (y * goodPng.width + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
  const nearPx = (a, b, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const EMBER = [255, 90, 43], PAPER = [16, 19, 21];
  const echoX = SHEET.W - SHEET.M - 4;          // center of the echo tick
  const echoYOld = LAYOUT.trace.y - 146;        // inside the tick at the canonical y
  const echoYNew = echoYOld - 100;              // where the tick must land after y: 3180 → 3080
  try {
    const moved = original.replace(
      'trace: { y: 3180,',
      'trace: { y: 3080,'
    );
    if (moved === original) throw new Error('plate patch did not apply');
    fs.writeFileSync(platePath, moved);
    execFileSync(process.execPath, ['render-sheet.mjs'], RENDER_ENV);
    const after = fs.readFileSync(PNG_PATH);
    const p = PNG.sync.read(after);
    expect('moving trace stratum in plate.mjs changes the image', !after.equals(GOOD));
    expect('echo tick LEFT the old y', nearPx(sample(p.data, echoX, echoYOld), PAPER), JSON.stringify(sample(p.data, echoX, echoYOld)));
    expect('echo tick ARRIVED at the new y', nearPx(sample(p.data, echoX, echoYNew), EMBER), JSON.stringify(sample(p.data, echoX, echoYNew)));

    // verifier follows the plate (trace moved to 3080 → probes at new coords pass; old ember region fails)
    const r = run([]);
    // with the stratum moved, 'the deviation (ember)' probe still checks the plate's OWN coords → passes
    expect('verifier follows moved plate coords', r.code === 0 && /ALL 15 PROBES PASS/.test(r.out), r.out);
  } finally {
    fs.writeFileSync(platePath, original); // restore plate
  }
}

// ---- test 3: canonical rebuild from restored plate is byte-identical ----
{
  execFileSync(process.execPath, ['render-sheet.mjs'], RENDER_ENV);
  const restored = fs.readFileSync(PNG_PATH);
  expect('restored plate → byte-identical PNG', restored.equals(GOOD));
  const r = run([]);
  expect('restored plate → all probes pass', r.code === 0 && /ALL 15 PROBES PASS/.test(r.out));
}

console.log(bad === 0 ? 'BEHAVIOR-CHECK: ALL PASS' : 'BEHAVIOR-CHECK: ' + bad + ' FAILURES');
process.exit(bad === 0 ? 0 : 1);
