// plate.mjs — QUIESCENT SIGNAL composition
// Single owner of visual truth: palette, geometry, typography, the draw routine,
// and the probe spec that verifies it. No I/O, no browser — render-sheet.mjs
// (engine) executes draw() on a canvas; probe.mjs reads PROBES to verify pixels.

export const SHEET = { W: 3200, H: 4000, M: 160 };

export const PALETTE = {
  paper: '#101315',
  g1: '#23282c', g2: '#394146', g3: '#59616a', g4: '#8a959e',
  bone: '#dfe5e2', teal: '#39b7a8', ember: '#ff5a2b',
  tealTint: 'rgba(57,183,168,0.13)', graphiteTint: 'rgba(89,97,106,0.16)',
};

export const FONT_STACK = {
  title: '300 150px Jura',
  maxim: '300 46px Jura',
  footer: '300 72px Jura',
  mono: '300 27px "DM Mono"',
};

// Only the faces the composition actually sets (files live in design/.fonts/).
export const FONTS_SRC = [
  { family: 'Jura', weight: 300, file: 'Jura-300.ttf' },
  { family: 'DM Mono', weight: 300, file: 'DMMono-300.ttf' },
];

export const LAYOUT = (() => {
  const { W, M } = SHEET;
  const plotL = M + 120, plotR = W - M - 120;
  return {
    plotL, plotR,
    footerRule: 3560,
    log: { ox: M, oy: 620, rows: 6, cols: 13, gx: 68, gy: 74, r: 6.5, warm: [4, 9] },
    meridian: { x: W - M - 260, y: 1560, r: 120 },
    channels: { datum: 2520, xs: [300, 800, 1300, 1800, 2300].map((dx) => plotL + dx), labelDy: 84 },
    wave: { top: 2760, amp: 80 },
    trace: { y: 3180, x0: plotL + 420, deviationDx: 1920, echoW: 8 },
  };
})();

export const TEXTS = [
  { text: 'QUIESCENT SIGNAL', x: SHEET.M, y: SHEET.M + 232, font: 'title', color: 'bone', align: 'left' },
  { text: 'FIELD SHEET — SYSTEMS AT REST', x: SHEET.M, y: SHEET.M + 360, font: 'mono', color: 'g4', align: 'left' },
  { text: 'PLATE 01 · QS·2026', x: SHEET.W - SHEET.M, y: SHEET.M + 360, font: 'mono', color: 'g4', align: 'right' },
  { text: 'STILLNESS IS A MEASUREMENT.', x: SHEET.W - SHEET.M, y: 1000, font: 'maxim', color: 'g4', align: 'right' },
  { text: 'LOG · 00–78', x: LAYOUT.log.ox, y: LAYOUT.log.oy + (LAYOUT.log.rows - 1) * LAYOUT.log.gy + 96, font: 'mono', color: 'g3', align: 'left' },
  { text: 'MERIDIAN 04', x: LAYOUT.meridian.x, y: LAYOUT.meridian.y + 196, font: 'mono', color: 'g4', align: 'center' },
  ...LAYOUT.channels.xs.map((x, i) => ({ text: 'CH·0' + (i + 1), x, y: LAYOUT.channels.datum + LAYOUT.channels.labelDy, font: 'mono', color: 'g4', align: 'center' })),
  { text: 'RESIDUAL WAVE — 24H', x: LAYOUT.plotR, y: LAYOUT.wave.top + 180, font: 'mono', color: 'g3', align: 'right' },
  { text: 'EVENT TRACE — 30D', x: LAYOUT.trace.x0 - 150, y: LAYOUT.trace.y - 320, font: 'mono', color: 'g3', align: 'left' },
  { text: 'DEVIATION · 03:14', x: LAYOUT.trace.x0 + LAYOUT.trace.deviationDx + 60, y: LAYOUT.trace.y + 96, font: 'mono', color: 'g3', align: 'left' },
  { text: 'SHEET 01 — CALM · GRID · ONE EMBER', x: SHEET.M, y: SHEET.H - 320, font: 'mono', color: 'g4', align: 'left' },
  { text: 'THE QUIET SYSTEM HOLDS.', x: SHEET.M, y: SHEET.H - 200, font: 'footer', color: 'bone', align: 'left' },
  { text: 'OBS · 0314 / QUIESCENT', x: SHEET.W - SHEET.M, y: SHEET.H - 320, font: 'mono', color: 'g4', align: 'right' },
  { text: 'Δ 04 · Q.S.', x: SHEET.W - SHEET.M, y: SHEET.H - 200, font: 'mono', color: 'g4', align: 'right' },
];

// draw(ctx, …) — graphics first, then all typography in one pass. Regions are
// exclusive by design, so the two phases never interact over the same pixel.
export function draw(ctx, SHEET, P, L, TEXTS, F) {
  const { W, H, M } = SHEET;
  ctx.textBaseline = 'alphabetic';

  // ground: paper + edge registration ticks + corner plates
  ctx.fillStyle = P.paper; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = P.g1; ctx.lineWidth = 2;
  for (let x = M; x <= W - M; x += 200) {
    ctx.beginPath(); ctx.moveTo(x, M - 26); ctx.lineTo(x, M); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, H - M); ctx.lineTo(x, H - M + 26); ctx.stroke();
  }
  for (let y = M; y <= H - M; y += 200) {
    ctx.beginPath(); ctx.moveTo(M - 26, y); ctx.lineTo(M, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W - M, y); ctx.lineTo(W - M + 26, y); ctx.stroke();
  }
  ctx.strokeStyle = P.g2; ctx.lineWidth = 3;
  const plate = 56;
  for (const [cx, cy, sx, sy] of [[M, M, 1, 1], [W - M, M, -1, 1], [M, H - M, 1, -1], [W - M, H - M, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(cx + sx * plate, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * plate); ctx.stroke();
  }

  // header teal rule
  ctx.fillStyle = P.teal; ctx.fillRect(M, M + 290, 320, 4);

  // dot-matrix log — one recorded event among graphite (teal; ember is reserved)
  const { log } = L;
  for (let r = 0; r < log.rows; r++) {
    for (let c = 0; c < log.cols; c++) {
      ctx.fillStyle = (r === log.warm[0] && c === log.warm[1]) ? P.teal : P.g2;
      ctx.beginPath(); ctx.arc(log.ox + c * log.gx, log.oy + r * log.gy, log.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // index ring (meridian)
  const { x: rx, y: ry, r: rr } = L.meridian;
  ctx.strokeStyle = P.g2; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = P.g3;
  ctx.beginPath(); ctx.arc(rx, ry, 86, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = P.g1;
  ctx.beginPath(); ctx.moveTo(rx, ry - 86); ctx.lineTo(rx, ry - rr); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx + 86, ry); ctx.lineTo(rx + rr, ry); ctx.stroke();
  ctx.fillStyle = P.bone; ctx.beginPath(); ctx.arc(rx, ry, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = P.teal;
  ctx.beginPath(); ctx.arc(rx + rr * Math.cos(-Math.PI / 3), ry + rr * Math.sin(-Math.PI / 3), 11, 0, Math.PI * 2); ctx.fill();

  // channel array: five vertical registers on one datum
  const { datum, xs } = L.channels;
  ctx.strokeStyle = P.g2; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(L.plotL, datum); ctx.lineTo(L.plotR, datum); ctx.stroke();
  ctx.strokeStyle = P.bone; ctx.lineWidth = 4; // CH·01 — bone hairline
  ctx.beginPath(); ctx.moveTo(xs[0], datum); ctx.lineTo(xs[0], 1800); ctx.stroke();
  const crest = (x, pts) => { // filled stepped register
    ctx.beginPath(); ctx.moveTo(x, datum);
    for (const [dx, y] of pts) ctx.lineTo(x + dx, y);
    ctx.lineTo(x + pts[pts.length - 1][0], datum); ctx.closePath();
  };
  crest(xs[1], [[-300, 2130], [-220, 1960], [-110, 2050], [0, 1870], [110, 2020], [220, 1920], [300, 2070]]);
  ctx.fillStyle = P.tealTint; ctx.fill();
  ctx.strokeStyle = P.teal; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = P.g2; ctx.lineWidth = 4; // CH·03 — graphite hairline
  ctx.beginPath(); ctx.moveTo(xs[2], datum); ctx.lineTo(xs[2], 1980); ctx.stroke();
  crest(xs[3], [[-300, 2200], [-150, 2310], [0, 2160], [150, 2290], [300, 2230]]);
  ctx.fillStyle = P.graphiteTint; ctx.fill(); ctx.stroke();
  ctx.strokeStyle = P.teal; ctx.lineWidth = 5; // CH·05 — the register that reaches
  ctx.beginPath(); ctx.moveTo(xs[4], datum); ctx.lineTo(xs[4], 1640); ctx.stroke();

  // residual wave (own stratum)
  ctx.strokeStyle = P.g4; ctx.lineWidth = 5;
  ctx.beginPath();
  for (let x = L.plotL; x <= L.plotR; x += 4) {
    const t = (x - L.plotL) / (L.plotR - L.plotL);
    const y = L.wave.top + L.wave.amp * Math.sin(t * Math.PI * 2.2 + 0.6) * Math.sin(t * Math.PI);
    x === L.plotL ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // event trace + thresholds + the single ember deviation
  const eY = L.trace.y, eL = L.trace.x0, ex = eL + L.trace.deviationDx;
  ctx.strokeStyle = P.g2; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(eL, eY); ctx.lineTo(L.plotR, eY); ctx.stroke();
  ctx.strokeStyle = P.teal; ctx.lineWidth = 6;
  for (const [y, len] of [[eY - 240, 56], [eY - 120, 34]]) { ctx.beginPath(); ctx.moveTo(eL - 150, y); ctx.lineTo(eL - 150 + len, y); ctx.stroke(); }
  ctx.lineWidth = 5;
  for (const x of [eL + 260, eL + 640, eL + 1180, eL + 1560]) { ctx.beginPath(); ctx.moveTo(x, eY - 20); ctx.lineTo(x, eY - 96); ctx.stroke(); }
  ctx.strokeStyle = P.ember; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(ex, eY - 20); ctx.lineTo(ex, eY - 150); ctx.stroke();
  ctx.beginPath(); ctx.arc(ex, eY - 178, 15, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = P.ember; ctx.fillRect(W - M - L.trace.echoW, eY - 150, L.trace.echoW, 8); // echo tick on the margin

  // footer rule
  ctx.strokeStyle = P.g1; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(M, L.footerRule); ctx.lineTo(W - M, L.footerRule); ctx.stroke();

  // typography — annotations only
  for (const t of TEXTS) {
    ctx.fillStyle = P[t.color]; ctx.font = F[t.font]; ctx.textAlign = t.align;
    ctx.fillText(t.text, t.x, t.y);
  }
}

// PROBES — pixel checks in composition coordinates, so verification follows the
// layout instead of guessing. box: some pixel inside must match · px: exact match ·
// clean: no pixel inside brighter than max.
export const PROBES = (() => {
  const { W, H, M } = SHEET;
  const { datum, xs } = LAYOUT.channels;
  const eY = LAYOUT.trace.y, eL = LAYOUT.trace.x0, ex = eL + LAYOUT.trace.deviationDx;
  const [ch2, ch5] = [xs[1], xs[4]];
  const box = (name, color, b) => ({ kind: 'box', name, color, box: b });
  const px = (name, color, p) => ({ kind: 'px', name, color, px: p });
  const clean = (name, max, b) => ({ kind: 'clean', name, max, box: b });
  return [
    box('title glyphs', 'bone', [M, M + 90, 1500, M + 300]),
    box('header meta row', 'g4', [M, M + 310, 700, M + 400]),
    px('log recorded-event dot', 'teal', [LAYOUT.log.ox + LAYOUT.log.warm[1] * LAYOUT.log.gx, LAYOUT.log.oy + LAYOUT.log.warm[0] * LAYOUT.log.gy]),
    px('meridian dot', 'teal', [Math.round(LAYOUT.meridian.x + LAYOUT.meridian.r * Math.cos(-Math.PI / 3)), Math.round(LAYOUT.meridian.y + LAYOUT.meridian.r * Math.sin(-Math.PI / 3))]),
    box('CH·05 reaching line', 'teal', [ch5 - 40, 1700, ch5 + 40, datum - 40]),
    box('datum rule', 'g2', [eL + 900, datum - 12, eL + 1100, datum + 12]),
    box('CH labels', 'g4', [ch2 - 100, datum + 40, ch2 + 100, datum + 120]),
    box('residual wave', 'g4', [LAYOUT.plotL + 200, LAYOUT.wave.top - 90, LAYOUT.plotR - 200, LAYOUT.wave.top + 90]),
    box('the deviation (ember)', 'ember', [ex - 50, eY - 190, ex + 50, eY - 10]),
    box('footer mono row', 'g4', [M, H - 350, 1100, H - 290]),
    box('footer maxim', 'bone', [M, H - 280, 1200, H - 160]),
    clean('left margin purity', 200, [0, 0, M - 30, H]),
    clean('right margin purity', 200, [W - M + 30, 0, W, H]),
    clean('top band purity', 200, [0, 0, W, 60]),
    clean('bottom band purity', 200, [0, H - 60, W, H]),
  ];
})();
