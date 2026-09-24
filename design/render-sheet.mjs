// render-sheet.mjs — engine: fonts + browser + capture. All visual truth lives in plate.mjs.
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { SHEET, PALETTE, FONT_STACK, FONTS_SRC, LAYOUT, TEXTS, draw } from './plate.mjs';

const { chromium } = createRequire('E:/My work/Project Sovereign Origin/sovereign-frontend/package.json')('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const fontURL = (file) => pathToFileURL(path.join(here, '.fonts', file)).href;

const loads = FONTS_SRC.map((f) => [f.family, f.weight, fontURL(f.file)]);
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${PALETTE.paper};}
  #sheet{width:${SHEET.W}px;height:${SHEET.H}px;}
</style></head><body><canvas id="sheet" width="${SHEET.W}" height="${SHEET.H}"></canvas>
<script>
const loads = ${JSON.stringify(loads)};
window.__fontsReady = Promise.all(loads.map(([fam, w, url]) =>
  new Promise((res, rej) => {
    const ff = new FontFace(fam, 'url(' + url + ')', { weight: String(w) });
    ff.load().then((f) => { document.fonts.add(f); res(); }, rej);
  })
));
window.__render = () => {
  const ctx = document.getElementById('sheet').getContext('2d');
  (${draw})(ctx, ${JSON.stringify(SHEET)}, ${JSON.stringify(PALETTE)}, ${JSON.stringify(LAYOUT)}, ${JSON.stringify(TEXTS)}, ${JSON.stringify(FONT_STACK)});
};
</script></body></html>`;

fs.writeFileSync(path.join(here, '.sheet.html'), html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 3400, height: 1300 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, '.sheet.html')).href);
await page.evaluate(() => window.__fontsReady);
await page.evaluate(() => window.__render());

const fonts = await page.evaluate(() => [...document.fonts].map((f) => f.family + ' ' + f.weight + ' ' + f.status));
const out = path.join(here, 'quiescent-signal.png');
await page.locator('#sheet').screenshot({ path: out });
await browser.close();

console.log('fonts:', fonts.join(' · '));
console.log('WROTE', out, fs.statSync(out).size, 'bytes');
