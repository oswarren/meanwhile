// Headless checks for the garden's rules.  Run:  node test.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./sim.js');

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  ok   ' + name); }
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function days(s, n) { for (let i = 0; i < n * S.DAY; i++) S.step(s); }
function fresh(seed) { return S.newState(0, seed == null ? 7 : seed); }
const D = S.DAY;
const mid = 2 * S.W + 6; // a plot in the middle of the bed

console.log('rules file');
{
  const src = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
  check('sim.js never calls Math.random', !/Math\.random\s*\(/.test(src));
  check('sim.js never reads the clock', !/new Date|Date\.now|performance\./.test(src));
  check('sim.js touches no DOM', !/document\.|window\.|localStorage/.test(src));
}

console.log('determinism');
{
  const a = fresh(), b = fresh();
  for (const s of [a, b]) { S.plant(s, 30, 'oak'); S.plant(s, 10, 'clover'); S.plant(s, 50, 'poppy'); S.plant(s, 31, 'fern'); }
  days(a, 400); days(b, 400);
  check('two identical gardens stay identical over 400 days', S.save(a) === S.save(b));
  const c = fresh(11); S.plant(c, 30, 'oak'); days(c, 400);
  check('a different seed gives a different garden', S.save(a) !== S.save(c));
  const p = fresh(), q = fresh();
  for (const s of [p, q]) { S.plant(s, 30, 'oak'); S.plant(s, 10, 'clover'); S.plant(s, 50, 'poppy'); }
  const total = 3000;
  S.advance(p, total * S.TICK_MS);
  let t = 0; while (t < total) { t += 7; S.advance(q, Math.min(t, total) * S.TICK_MS); }
  check('one burst of 3000 ticks equals 3000 ticks in dribs and drabs', S.save(p) === S.save(q));
  const r = fresh(); S.plant(r, 30, 'oak'); days(r, 3);
  const r2 = S.load(S.save(r)); days(r, 200); days(r2, 200);
  check('save/load round trip continues identically', S.save(r) === S.save(r2));
  const f1 = S.foundGarden(1000, 99), f2 = S.foundGarden(1000, 99);
  check('the found garden is deterministic per seed', S.save(f1) === S.save(f2));
}

console.log('clock');
{
  const s = fresh();
  check('at the epoch the target tick is 0', S.targetTick(s, 0) === 0);
  check('one tick after TICK_MS', S.targetTick(s, S.TICK_MS) === 1);
  check('advance steps to the target', (S.advance(s, 10 * S.TICK_MS), s.tick === 10));
  check('advance with a cap returns the remainder', S.advance(s, 20 * S.TICK_MS, 3) === 7 && s.tick === 13);
  const before = s.tick;
  S.advance(s, 2 * S.TICK_MS); // clock went backwards
  check('a backwards clock holds the garden instead of rewinding', s.tick === before);
  check('...and time resumes from there', (S.advance(s, 2 * S.TICK_MS + S.TICK_MS), s.tick === before + 1));
  check('phase is 0 at the tick boundary', S.phase(s, s.epoch + s.tick * S.TICK_MS) === 0);
  check('phase is 0.5 halfway through', Math.abs(S.phase(s, s.epoch + s.tick * S.TICK_MS + S.TICK_MS / 2) - 0.5) < 1e-9);
  const g = S.foundGarden(5_000_000, 3);
  check('a found garden opens at its own tick with nothing pending', S.targetTick(g, 5_000_000) === g.tick && g.tick === g.start);
}

console.log('planting and pulling');
{
  const s = fresh();
  check('plant on bare soil', S.plant(s, 5, 'poppy') && s.cells[5].k === 'poppy');
  check('cannot plant on a poppy', !S.plant(s, 5, 'clover') && s.cells[5].k === 'poppy');
  check('unknown kind rejected', !S.plant(s, 6, 'cactus'));
  check('out of range rejected', !S.plant(s, S.N, 'clover') && !S.plant(s, -1, 'clover'));
  check('stone placed', S.plant(s, 7, 'stone') && s.cells[7].k === 'stone');
  check('cannot plant on a stone', !S.plant(s, 7, 'clover'));
  check('describe reads bare soil', S.describe(s, 8).startsWith('bare soil'));
  check('pull clears', S.pull(s, 5) && s.cells[5] === null);
  check('pull on bare soil is a no-op', !S.pull(s, 5));
  S.plant(s, 9, 'clover');
  check('planting over clover replaces it (clover is ground)', S.plant(s, 9, 'oak') && s.cells[9].k === 'oak');
  check('each plant gets a fixed vigour between 0.8 and 1.2', s.cells[9].j >= 0.8 && s.cells[9].j <= 1.2);
  days(s, 30);
  check('a stone is still there after 30 days', s.cells[7] && s.cells[7].k === 'stone');
  check('describe reads a stone', S.describe(s, 7) === 'a stone');
}

console.log('life cycles (each alone)');
{
  for (const k of S.KINDS) {
    const sp = S.SPECIES[k];
    const s = fresh();
    if (sp.needsShade) { S.plant(s, mid - S.W, 'oak'); s.cells[mid - S.W].d = S.SPECIES.oak.mature; s.cells[mid - S.W].b = -1; }
    S.plant(s, mid, k);
    const j = s.cells[mid].j;
    let sprouted = -1, matured = -1, died = -1;
    for (let h = 0; h < sp.life * 1.3 + 5 * D; h++) {
      const c = s.cells[mid];
      if (c && c.k === k) {
        if (sprouted < 0 && c.d >= sp.sprout) sprouted = h;
        if (matured < 0 && c.d >= sp.mature) matured = h;
      } else if (died < 0) { died = h; break; }
      S.step(s);
    }
    check(`${k} sprouts (hour ${sprouted})`, sprouted > 0);
    check(`${k} matures (hour ${matured})`, matured > sprouted);
    check(`${k} dies of old age at lifespan × vigour (hour ${died} vs ${Math.round(sp.life * j)})`, Math.abs(died - sp.life * j) <= 1);
    const dead = s.cells[mid];
    check(`${k} leaves a visible dead plant that says why`, dead && dead.k === 'dead' && dead.of === k && dead.why === 'age' && /old age/.test(S.describe(s, mid)));
    days(s, 2);
    check(`${k}'s remains clear within two days`, !s.cells[mid] || s.cells[mid].k !== 'dead');
  }
}

console.log('shade falls forward');
{
  const s = fresh();
  S.plant(s, mid, 'oak');
  check('a young oak casts no shade', S.shadeMap(s.cells).every(v => v === 0));
  s.cells[mid].d = S.SPECIES.oak.mature;
  let sh = S.shadeMap(s.cells);
  const front = i => i + S.W;
  check('a mature oak shades its two row neighbours and three plots in front', sh[mid - 1] === 1 && sh[mid + 1] === 1 && sh[front(mid) - 1] === 1 && sh[front(mid)] === 1 && sh[front(mid) + 1] === 1);
  check('...and nothing behind it', sh[mid - S.W] === 0 && sh[mid - S.W - 1] === 0 && sh[mid - S.W + 1] === 0);
  check('...five plots in all', sh.reduce((a, b) => a + b, 0) === 5);
  s.cells[mid].d = S.SPECIES.oak.old;
  sh = S.shadeMap(s.cells);
  check('an old oak shades fourteen plots, two rows forward', sh.reduce((a, b) => a + b, 0) === 14 && sh[mid + 2 * S.W + 2] === 1 && sh[mid - 2] === 1);
  const frontRow = fresh(); S.plant(frontRow, 5 * S.W + 6, 'oak'); frontRow.cells[5 * S.W + 6].d = S.SPECIES.oak.old;
  check('an old oak in the front row shades only four plots beside it', S.shadeMap(frontRow.cells).reduce((a, b) => a + b, 0) === 4);
  const g = fresh(); S.plant(g, mid, 'oak'); g.cells[mid].d = S.SPECIES.oak.mature; g.cells[mid].b = -1;
  S.plant(g, mid + 1, 'clover'); S.plant(g, mid + S.W, 'fern'); S.plant(g, mid + 5, 'fern');
  days(g, 10);
  const gone = (i, k) => !g.cells[i] || g.cells[i].k !== k;
  check('clover in shade is gone within 10 days', gone(mid + 1, 'clover'));
  check('fern in shade is alive after 10 days', g.cells[mid + S.W] && g.cells[mid + S.W].k === 'fern');
  check('fern in the open is gone within 10 days', gone(mid + 5, 'fern'));
  const o = fresh(); S.plant(o, mid, 'oak'); o.cells[mid].d = S.SPECIES.oak.mature; o.cells[mid].b = -1; S.plant(o, mid - S.W, 'oak'); o.cells[mid - S.W].d = S.SPECIES.oak.mature; o.cells[mid - S.W].b = -1;
  days(o, 30);
  check('a mature oak survives in another oak\'s shade', o.cells[mid] && o.cells[mid].k === 'oak');
}

console.log('spreading and what blows in');
{
  const s = fresh(); S.plant(s, mid, 'clover'); days(s, 20);
  check('clover spreads on its own', S.counts(s).clover > 5);
  const e = fresh(); days(e, 120);
  check('wild clover arrives in an empty garden', S.counts(e).clover > 0);
  const e2 = fresh(); let sawPoppy = false;
  for (let d = 0; d < 360 && !sawPoppy; d++) { days(e2, 1); if (S.counts(e2).poppy) sawPoppy = true; }
  check('a wild poppy turns up within a year', sawPoppy);
  const f = fresh(); S.plant(f, mid, 'oak'); f.cells[mid].d = S.SPECIES.oak.old; f.cells[mid].b = -1; days(f, 40);
  check('fern spores find the shade under an oak by themselves', S.counts(f).fern > 0);
  check('nothing but fern lives in that shade', f.cells.every((c, i) => !(S.shadeMap(f.cells)[i] && c && (c.k === 'clover' || c.k === 'poppy'))));
  const st = fresh(); for (let i = 0; i < S.N; i += 2) S.plant(st, i, 'stone'); S.plant(st, 1, 'clover'); days(st, 200);
  check('stones are never overgrown', st.cells.filter((c, i) => i % 2 === 0).every(c => c && c.k === 'stone'));
  const pp = fresh(); S.plant(pp, mid, 'poppy'); pp.cells[mid].d = S.SPECIES.poppy.mature + S.SPECIES.poppy.bloom + 1; pp.cells[mid].b = -1;
  for (let i = 0; i < S.N; i++) if (i !== mid) S.plant(pp, i, 'stone');
  S.pull(pp, mid + 1); days(pp, 5);
  check('a poppy gone to seed no longer sets seed', !pp.cells[mid + 1] || pp.cells[mid + 1].k !== 'poppy');
  check('stage reads "gone to seed"', S.stageOf(pp.cells[mid]) === 'gone to seed');
  // acorns need bare soil: keep the ring around an oak in fresh clover and no acorn ever takes
  const acorns = ground => {
    const ac = fresh(); S.plant(ac, mid, 'oak'); ac.cells[mid].d = S.SPECIES.oak.mature; ac.cells[mid].b = -1;
    for (let i = 0; i < S.N; i++) if (!ac.cells[i]) S.plant(ac, i, 'stone');
    const ring = S.neighbours(mid, 2).filter(j => !S.shadeMap(ac.cells)[j]);
    for (let h = 0; h < 200 * D; h++) {
      for (const j of ring) if (!ac.cells[j] || ac.cells[j].k !== 'oak') ac.cells[j] = ground ? { k: 'clover', d: 40, b: ac.tick, j: 1 } : null;
      S.step(ac);
    }
    return S.counts(ac).oak;
  };
  check('acorns do not take on clover', acorns(true) === 1);
  check('...but they do on bare soil', acorns(false) > 1);
  check('canTake: clover can overgrow a poppy seed but not a sprouted poppy', S.canTake('clover', { k: 'poppy', d: 1 }) && !S.canTake('clover', { k: 'poppy', d: 20 }));
  check('canTake: poppy and fern seeds take clover, oak does not', S.canTake('poppy', { k: 'clover', d: 40 }) && S.canTake('fern', { k: 'clover', d: 40 }) && !S.canTake('oak', { k: 'clover', d: 40 }));
  check('canTake: nothing takes a stone, a fern, an oak or a grown poppy', ['stone', 'fern', 'oak'].every(k => S.KINDS.every(s => !S.canTake(s, { k, d: 999 }))) && !S.canTake('poppy', { k: 'poppy', d: 999 }));
  // a poppy that bloomed can leave a seed where it dies
  let reseeded = 0, trials = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const pp = fresh(seed); for (let i = 0; i < S.N; i++) if (i !== mid) S.plant(pp, i, 'stone');
    S.plant(pp, mid, 'poppy'); const lifeH = Math.round(S.SPECIES.poppy.life * pp.cells[mid].j);
    for (let h = 0; h < lifeH + 1; h++) S.step(pp);
    trials++; if (pp.cells[mid] && pp.cells[mid].k === 'poppy' && pp.cells[mid].d < 2) reseeded++;
  }
  check(`poppies reseed in place about half the time (${reseeded}/${trials})`, reseeded >= 8 && reseeded <= 22);
}

console.log('hover text');
{
  const s = fresh(); S.plant(s, mid, 'poppy'); days(s, 3);
  const txt = S.describe(s, mid, S.shadeMap(s.cells));
  check('describes species, stage, age, light and what comes next', /^poppy · (sprout|in bud) · 3 days old · in sun · blooms in about \d+ days$/.test(txt), txt);
  S.plant(s, mid + 1, 'oak');
  check('an acorn says when it sprouts', /^oak · acorn · 0 h old · in sun · sprouts in about (\d+ hours|a day|\d+ days)$/.test(S.describe(s, mid + 1, S.shadeMap(s.cells))), S.describe(s, mid + 1, S.shadeMap(s.cells)));
}

console.log('calendar');
{
  check('seasons cycle spring→summer→autumn→winter', ['spring','summer','autumn','winter'].every((n, i) => S.seasonOf(i * 90 + 10) === n));
  check('growth peaks in summer and slows in winter', S.seasonGrowth(135) > 0.99 && Math.abs(S.seasonGrowth(315) - S.WINTER) < 1e-9);
  check('growth factors are three-decimal values (exact across engines)', Array.from({ length: 360 }, (_, d) => S.seasonGrowth(d)).every(g => Math.abs(g * 1000 - Math.round(g * 1000)) < 1e-9));
  const f = S.foundGarden(0, 1), inf = S.info(f);
  check('a new garden opens in late spring at eight in the morning', inf.season === 'spring' && inf.part === 'late' && inf.hour === 8, JSON.stringify(inf));
}

console.log('found garden');
{
  let ok = 0, seeds = 400; const bad = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const g = S.foundGarden(0, seed), c = S.counts(g);
    if (c.oak >= 1 && c.clover >= 5 && c.poppy >= 3 && c.fern >= 1) ok++; else bad.push(`${seed}:${JSON.stringify(c)}`);
  }
  check(`every seed opens with an oak, clover, at least three poppies and a fern (${ok}/${seeds})`, ok === seeds, bad.slice(0, 3).join(' '));
  const g = S.foundGarden(0, 5);
  let oak = -1; g.cells.forEach((c, i) => { if (c && c.k === 'oak' && (oak < 0 || c.d > g.cells[oak].d)) oak = i; });
  check('the tree is already casting shade', S.shadeMap(g.cells).some(v => v > 0));
  check('the tree\'s age matches its size', g.tick - g.cells[oak].b >= S.SPECIES.oak.mature);
  check('poppies are in bloom on the first visit', g.cells.some(c => c && c.k === 'poppy' && S.stageOf(c) === 'in bloom'));
}

console.log('compact encoding');
{
  const g = S.foundGarden(1_700_000_000_000, 12345); S.plant(g, 0, 'stone'); days(g, 30);
  const text = S.encode(g);
  check('encoded garden fits in a URL', text.length < 2000 && !/[^0-9a-z.,-]/.test(text), `${text.length} chars: ${text.slice(0, 80)}`);
  const back = S.decode(text);
  const same = back.seed === g.seed && back.epoch === g.epoch && back.tick === g.tick && back.start === g.start &&
    back.cells.every((c, i) => { const o = g.cells[i]; if (!o) return c === null; if (o.k === 'stone') return c.k === 'stone';
      if (o.k === 'dead') return c.k === 'dead' && c.of === o.of && c.why === o.why && c.b === o.b;
      return c.k === o.k && c.b === o.b && Math.abs(c.d - o.d) <= 0.5 && Math.abs(c.j - o.j) <= 0.01; });
  check('decodes back to the same garden (to the hour)', same);
  let threw = false; try { S.decode('nonsense'); } catch (e) { threw = true; }
  check('garbage is rejected', threw);
  const parts = text.split(',');
  const rejects = mutate => { const p = parts.slice(); mutate(p); try { S.decode(p.join(',')); return false; } catch (e) { return true; } };
  check('a blank epoch or tick is rejected', rejects(p => { p[2] = ''; }) && rejects(p => { p[3] = ''; }));
  check('a corrupt dead-plant token is rejected', rejects(p => { p[5] = 'xzz'; }) && rejects(p => { p[5] = 'xca'; }));
  check('a corrupt plant token is rejected', rejects(p => { p[6] = 'q1.2.3'; }) && rejects(p => { p[6] = 'c1.2'; }));
  threw = false; try { S.load('{"v":1,"cells":[]}'); } catch (e) { threw = true; }
  check('old formats are rejected', threw);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
