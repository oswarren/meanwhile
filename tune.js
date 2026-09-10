// Long-run behaviour of the garden's rules.  Run:  node tune.js [years=2] [seeds=12]
// Prints what happens over years under three starts, and flags boring end states.
'use strict';
const S = require('./sim.js');
const YEARS = +process.argv[2] || 2, SEEDS = +process.argv[3] || 12;
const D = S.DAY;

function snapshot(s) {
  const c = S.counts(s), sh = S.shadeMap(s.cells);
  let shaded = 0; for (let i = 0; i < S.N; i++) if (sh[i]) shaded++;
  const sunlit = S.N - shaded;
  let sunPoppy = 0, sunClover = 0; for (let i = 0; i < S.N; i++) if (!sh[i] && s.cells[i]) { if (s.cells[i].k === 'poppy') sunPoppy++; if (s.cells[i].k === 'clover') sunClover++; }
  return { ...c, shaded, poppyShare: sunlit ? sunPoppy / sunlit : 0, cloverShare: sunlit ? sunClover / sunlit : 0 };
}
function kinds(s) { return s.cells.map(c => c ? c.k : '.'); }

function run(label, start, seed) {
  const s = start(seed);
  const days = YEARS * 360;
  const rows = [];
  let prev = kinds(s), turnover = [], extinct = {}, seen = {}, maxShare = {}, staticDays = 0, worstStatic = 0;
  for (let d = 1; d <= days; d++) {
    for (let h = 0; h < D; h++) S.step(s);
    const snap = snapshot(s);
    if (d % 7 === 0) { const now = kinds(s); let ch = 0; for (let i = 0; i < S.N; i++) if (now[i] !== prev[i]) ch++; turnover.push(ch / S.N); prev = now; if (ch / S.N < 0.03) staticDays += 7; else staticDays = 0; worstStatic = Math.max(worstStatic, staticDays); }
    if (d >= 60) for (const k of S.KINDS) { if (snap[k] > 0) seen[k] = true; if (snap[k] === 0 && seen[k] && !extinct[k]) extinct[k] = d; maxShare[k] = Math.max(maxShare[k] || 0, snap[k] / (S.N - snap.stone)); }
    if (d % 90 === 0) rows.push(`${String(d).padStart(4)} ${S.seasonOf(d).padEnd(6)} clover=${String(snap.clover).padStart(2)} poppy=${String(snap.poppy).padStart(2)} oak=${String(snap.oak).padStart(2)} fern=${String(snap.fern).padStart(2)} dead=${String(snap.dead).padStart(2)} bare=${String(snap.empty).padStart(2)} shaded=${String(snap.shaded).padStart(2)} poppy/sun=${snap.poppyShare.toFixed(2)}`);
  }
  const avgTurn = turnover.reduce((a, b) => a + b, 0) / turnover.length;
  return { label, seed, rows, extinct, maxShare, avgTurn, worstStatic, final: snapshot(s) };
}

const STARTS = {
  'found garden, never touched': seed => S.foundGarden(0, seed),
  'few of each on bare soil': seed => { const s = S.newState(0, seed); S.plant(s, 1 * S.W + 4, 'oak'); S.plant(s, 2 * S.W + 10, 'oak'); for (const i of [10, 40, 60]) S.plant(s, i, 'clover'); for (const i of [50, 51, 70, 71, 72]) S.plant(s, i, 'poppy'); return s; },
  'only clover': seed => { const s = S.newState(0, seed); S.plant(s, 40, 'clover'); return s; },
  'nothing': seed => S.newState(0, seed),
};

for (const [label, start] of Object.entries(STARTS)) {
  console.log(`\n=== ${label} (${YEARS} years, ${SEEDS} seeds)`);
  const results = []; for (let seed = 1; seed <= SEEDS; seed++) results.push(run(label, start, seed));
  console.log('seed 1:\n' + results[0].rows.join('\n'));
  const ext = {}; for (const k of S.KINDS) ext[k] = results.filter(r => r.extinct[k]).length;
  const avgFinal = {}; for (const k of [...S.KINDS, 'empty', 'shaded']) avgFinal[k] = (results.reduce((a, r) => a + r.final[k], 0) / SEEDS).toFixed(1);
  console.log(`extinctions after day 60 (of ${SEEDS} seeds): ${JSON.stringify(ext)}`);
  console.log(`average final counts: ${JSON.stringify(avgFinal)}`);
  console.log(`weekly turnover (share of plots that changed): avg ${(results.reduce((a, r) => a + r.avgTurn, 0) / SEEDS).toFixed(3)}; longest static stretch ${Math.max(...results.map(r => r.worstStatic))} days`);
  const dom = {}; for (const k of S.KINDS) dom[k] = Math.max(...results.map(r => r.maxShare[k] || 0)).toFixed(2);
  console.log(`max share of the bed held by one species after day 60: ${JSON.stringify(dom)}`);
}
