/* Meanwhile — the garden's rules.
   Pure simulation: no DOM, no clock, no Math.random. Everything random is a
   hash of (garden seed, tick, plot, purpose), so replaying missed time gives
   exactly the garden that live ticking would have produced.

   Time: 1 tick = 1 garden hour = 75 real seconds.
         1 garden day = 30 real minutes. 1 garden year (360 days) = 7.5 real days.

   The bed is 14 plots wide and 6 deep. Row 0 is the back, row 5 is the front,
   nearest the path. Light comes from behind the bed, so shade falls forward. */
(function (root) {
  'use strict';

  const W = 14, H = 6, N = W * H;
  const TICK_MS = 75 * 1000;
  const DAY = 24;
  const YEAR = 360;
  const KINDS = ['clover', 'poppy', 'oak', 'fern'];

  // Times in garden hours. Chances are per garden hour; seeding and arrivals are
  // scaled by the season, deaths are not (winter thins the bed, it does not pause it).
  //   sprout / mature / old : development thresholds (development runs at the seasonal rate)
  //   bloom                 : poppies only — how long after maturing they keep setting seed
  //   life                  : lifespan in garden hours (ageing ignores the season)
  //   spread, reach         : chance per hour, when mature, of dropping a seed within `reach` plots
  //   shadeDeath / sunDeath : chance per hour of dying while shaded / while in the open
  //   reseed                : poppies only — chance that a poppy which bloomed leaves a seed where it dies
  //   tender                : poppies only — clover can overgrow a poppy younger than this (development hours)
  const SPECIES = {
    clover: { sprout: 4,  mature: 36,       life: 20 * DAY,   spread: 1 / 24,  reach: 1, shadeDeath: 1 / 24, sunDeath: 0 },
    poppy:  { sprout: 12, mature: 6 * DAY,  bloom: 12 * DAY,  life: 30 * DAY,   spread: 1 / 96,  reach: 1, shadeDeath: 1 / 48, sunDeath: 0, reseed: 0.4, tender: 12 },
    oak:    { sprout: 48, mature: 45 * DAY, old: 200 * DAY,   life: 2400 * DAY, spread: 1 / (30 * DAY), reach: 2, shadeDeath: 1 / 72, sunDeath: 0 },
    fern:   { sprout: 24, mature: 8 * DAY,  life: 120 * DAY,  spread: 1 / 72,  reach: 1, shadeDeath: 0, sunDeath: 1 / 48, needsShade: true },
  };
  // Where a seed can take. Bare soil (or a plot where something died) takes anything.
  // Clover is ground cover: any other seed can take it. A young poppy can be overgrown
  // by clover. Nothing takes a grown poppy, a fern, an oak or a stone.
  function canTake(kind, tgt) {
    if (!tgt || tgt.k === 'dead') return true;
    if (kind === 'oak') return false;                           // acorns want bare soil
    if (tgt.k === 'clover') return kind !== 'clover';
    if (tgt.k === 'poppy' && tgt.d < SPECIES.poppy.tender) return kind === 'clover';
    return false;
  }
  // Things that arrive on their own (chance per hour, scaled by the season).
  const WILD = {
    clover: 1 / (3 * DAY),    // onto an open plot in the sun
    poppy:  1 / (30 * DAY),   // onto an open plot in the sun
    fern:   1 / (5 * DAY),    // spores, onto an open plot in the shade
  };
  const DEAD_FOR = DAY;       // a dead plant stays visible this many hours after the hour it died
  const JITTER = 0.2;         // each plant's vigour is 1 ± this, fixed at birth
  const WINTER = 0.25;        // growth at midwinter (1.0 at midsummer)

  // ---- deterministic randomness ----------------------------------------------
  function mix(h) {
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D);
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B);
    return (h ^ (h >>> 16)) | 0;
  }
  // Uniform in [0, 1) for a given (seed, tick, plot, purpose).
  function rnd(seed, t, i, salt) {
    let h = mix(seed ^ 0x2545F491);
    h = mix(h ^ Math.imul(t + 1, 0x9E3779B1));
    h = mix(h ^ Math.imul(i + 1, 0x85EBCA77));
    h = mix(h ^ Math.imul(salt + 1, 0xC2B2AE3D));
    return (h >>> 0) / 4294967296;
  }

  // ---- calendar -----------------------------------------------------------------
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  function dayOfYear(day) { return ((day % YEAR) + YEAR) % YEAR; }
  function seasonOf(day) { return SEASONS[Math.floor(dayOfYear(day) / (YEAR / 4))]; }
  // 1.0 at midsummer (day 135), WINTER at midwinter (day 315). Rounded to three
  // decimals: Math.cos can differ in its last bit between JavaScript engines, and
  // everything else the rules do is exact arithmetic, so this keeps a garden
  // identical whichever browser it is opened in.
  function seasonGrowth(day) {
    const x = (dayOfYear(day) - 135) / YEAR * 2 * Math.PI;
    return Math.round((WINTER + (1 - WINTER) * (0.5 + 0.5 * Math.cos(x))) * 1000) / 1000;
  }
  function growthAt(tick) { return seasonGrowth(Math.floor(tick / DAY)); }

  // ---- geometry -------------------------------------------------------------------
  function neighbours(i, reach) {
    const x = i % W, y = (i / W) | 0, out = [];
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      out.push(ny * W + nx);
    }
    return out;
  }
  // Plots an oak of shade radius r darkens: its own row and the r rows in front, r plots either side.
  function shadePlots(i, r) {
    const x = i % W, y = (i / W) | 0, out = [];
    for (let dy = 0; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny >= H) continue;
      out.push(ny * W + nx);
    }
    return out;
  }
  function pick(list, r) { return list.length ? list[Math.min(list.length - 1, (r * list.length) | 0)] : -1; }

  // Number of oaks shading each plot (0 = full sun).
  function shadeMap(cells) {
    const shade = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const c = cells[i];
      if (!c || c.k !== 'oak' || c.d < SPECIES.oak.mature) continue;
      for (const j of shadePlots(i, c.d >= SPECIES.oak.old ? 2 : 1)) shade[j]++;
    }
    return shade;
  }

  // ---- one garden hour ---------------------------------------------------------------
  const isGround = c => !c || c.k === 'dead' || c.k === 'clover';       // what a gardener can plant on
  const free = (c, t) => !(c && c.b === t + 1 && c.k !== 'dead');       // not already claimed by a seed this hour
  function vigour(seed, t, i) { return 1 - JITTER + 2 * JITTER * rnd(seed, t, i, 6); }
  function sow(s, next, i, kind, t) { next[i] = { k: kind, d: 0, b: t, j: +vigour(s.seed, t, i).toFixed(2) }; }
  function seeding(sp) { return sp.bloom == null ? Infinity : sp.mature + sp.bloom; }

  function step(s) {
    const t = s.tick, seed = s.seed;
    const g = growthAt(t);
    const shade = shadeMap(s.cells);
    const cur = s.cells, next = cur.slice();

    // 1. ageing, death, development (decided from the state at the start of the hour)
    for (let i = 0; i < N; i++) {
      const c = cur[i];
      if (!c || c.k === 'stone') continue;
      if (c.k === 'dead') { if (t - c.b >= DEAD_FOR) next[i] = null; continue; }
      const sp = SPECIES[c.k];
      const shaded = shade[i] > 0;
      let why = null;
      if (t - c.b >= sp.life * c.j) why = 'age';
      else if (shaded && sp.shadeDeath && !(c.k === 'oak' && c.d >= sp.mature) && rnd(seed, t, i, 1) < sp.shadeDeath) why = 'shade';
      else if (!shaded && sp.sunDeath && rnd(seed, t, i, 1) < sp.sunDeath) why = 'sun';
      if (why) {
        if (why === 'age' && sp.reseed && c.d >= sp.mature && rnd(seed, t, i, 7) < sp.reseed) sow(s, next, i, c.k, t + 1);
        else next[i] = { k: 'dead', of: c.k, why, b: t + 1 };
        continue;
      }
      next[i] = { k: c.k, d: c.d + g * c.j, b: c.b, j: c.j };
    }

    // 2. seeding, by plants that were mature at the start of the hour and are still alive.
    //    Plots are visited in row-major order; the first seed to reach a plot in an hour keeps it.
    for (let i = 0; i < N; i++) {
      const c = cur[i];
      if (!c || c.k === 'stone' || c.k === 'dead' || !next[i] || next[i].k === 'dead' || next[i].b === t + 1) continue;
      const sp = SPECIES[c.k];
      if (c.d < sp.mature || c.d >= seeding(sp)) continue;
      if (rnd(seed, t, i, 2) >= sp.spread * g) continue;
      const j = pick(neighbours(i, sp.reach), rnd(seed, t, i, 3));
      if (j < 0) continue;
      if (!free(next[j], t) || !canTake(c.k, next[j])) continue;
      if (!!shade[j] !== !!sp.needsShade) continue;                       // a seed only takes where the light suits it
      sow(s, next, j, c.k, t + 1);
    }

    // 3. what blows in, onto a random open plot with the right light
    const r = rnd(seed, t, N, 4);
    const kind = r < WILD.clover * g ? 'clover' : r >= 0.5 && r < 0.5 + WILD.poppy * g ? 'poppy' : rnd(seed, t, N + 1, 4) < WILD.fern * g ? 'fern' : null;
    if (kind) {
      const wantShade = kind === 'fern', spots = [];
      for (let i = 0; i < N; i++) if (!!shade[i] === wantShade && free(next[i], t) && canTake(kind, next[i]) && (!next[i] || next[i].k === 'dead')) spots.push(i);
      const e = pick(spots, rnd(seed, t, N, 5));
      if (e >= 0) sow(s, next, e, kind, t + 1);
    }

    s.cells = next;
    s.tick = t + 1;
  }

  // ---- state & clock -----------------------------------------------------------------
  function newState(nowMs, seed) {
    return { v: 2, seed: seed | 0, epoch: nowMs, tick: 0, start: 0, cells: new Array(N).fill(null) };
  }
  // The tick the garden should be at for this wall-clock time. If the clock went
  // backwards, the garden holds where it is rather than freezing or rewinding.
  function targetTick(s, nowMs) {
    let t = Math.floor((nowMs - s.epoch) / TICK_MS);
    if (t < s.tick) { s.epoch = nowMs - s.tick * TICK_MS; t = s.tick; }
    return t;
  }
  // Step toward the current time, at most maxSteps ticks. Returns ticks still pending.
  function advance(s, nowMs, maxSteps) {
    const target = targetTick(s, nowMs);
    let n = target - s.tick;
    if (maxSteps != null) n = Math.min(n, maxSteps);
    for (let k = 0; k < n; k++) step(s);
    return target - s.tick;
  }
  // Fraction of the current tick already elapsed (for smooth drawing).
  function phase(s, nowMs) {
    return Math.max(0, Math.min(1, (nowMs - s.epoch - s.tick * TICK_MS) / TICK_MS));
  }

  // A plot can be planted if it is bare, or dead, or clover (which gets pulled up).
  function plant(s, i, kind) {
    if (i < 0 || i >= N || !isGround(s.cells[i])) return false;
    if (kind === 'stone') { s.cells[i] = { k: 'stone' }; return true; }
    if (!SPECIES[kind]) return false;
    sow(s, s.cells, i, kind, s.tick);
    return true;
  }
  function pull(s, i) {
    if (i < 0 || i >= N || !s.cells[i]) return false;
    s.cells[i] = null;
    return true;
  }

  // A garden that has already been going for a while: one tree, some clover,
  // ferns in its shade, poppies coming into bloom. Different for every seed.
  function foundGarden(nowMs, seed) {
    const s = newState(nowMs, seed);
    const WARM = 20 * DAY, START = 80 * DAY + 8;    // twenty days of history; first visit in late spring, 8 am
    s.tick = START - WARM;
    const r = k => rnd(seed, 0, k, 50);
    const oak = (1 + Math.floor(r(1) * 2)) * W + 3 + Math.floor(r(2) * 8);
    plant(s, oak, 'oak');
    const treeAge = SPECIES.oak.mature + 30 * DAY;    // a tree already; grows old in a hundred-odd days
    s.cells[oak].d = treeAge; s.cells[oak].b = s.tick - treeAge; s.cells[oak].j = 1;
    for (const j of shadePlots(oak, 1)) if (r(100 + j) < 0.6) plant(s, j, 'fern');
    if (!s.cells.some(c => c && c.k === 'fern')) plant(s, shadePlots(oak, 1)[0], 'fern');
    for (let k = 0; k < 6 * DAY; k++) step(s);
    for (let k = 0; k < 4; k++) plant(s, Math.floor(r(10 + k) * N), 'clover');
    for (let k = 0; k < 6 * DAY; k++) step(s);
    for (let c = 0; c < 2; c++) {   // two clumps of poppy seedlings in the sun, one each side (rows 3 to 5 are never in the tree's shade)
      const cx = c * (W / 2) + 1 + Math.floor(r(20 + c) * (W / 2 - 2)), cy = 4 + Math.floor(r(30 + c) * 2);
      for (const j of [cy * W + cx, cy * W + cx + 1, (cy - 1) * W + cx]) if (!shadeMap(s.cells)[j] && plant(s, j, 'poppy')) s.cells[j].d = SPECIES.poppy.sprout;
    }
    for (let k = 0; k < 8 * DAY; k++) step(s);
    s.start = s.tick;
    s.epoch = nowMs - s.tick * TICK_MS;
    return s;
  }

  // ---- reading the garden --------------------------------------------------------------
  function info(s) {
    const day = Math.floor(s.tick / DAY), doy = dayOfYear(day), dos = doy % (YEAR / 4);
    return { tick: s.tick, day, hour: s.tick % DAY, dayOfYear: doy, dayOfSeason: dos + 1,
             season: seasonOf(day), part: ['early', 'mid', 'late'][Math.floor(dos / 30)], growth: growthAt(s.tick) };
  }
  function counts(s) {
    const c = { empty: 0, stone: 0, dead: 0 };
    for (const k of KINDS) c[k] = 0;
    for (const cell of s.cells) c[cell ? cell.k : 'empty']++;
    return c;
  }
  function stageOf(c) {
    if (!c) return 'empty';
    if (c.k === 'stone') return 'stone';
    if (c.k === 'dead') return 'dead';
    const sp = SPECIES[c.k];
    switch (c.k) {
      case 'clover': return c.d < sp.sprout ? 'seed' : c.d < sp.mature ? 'sprout' : 'in flower';
      case 'poppy':  return c.d < sp.sprout ? 'seed' : c.d < sp.mature * 0.7 ? 'sprout' : c.d < sp.mature ? 'in bud' : c.d < sp.mature + sp.bloom ? 'in bloom' : 'gone to seed';
      case 'oak':    return c.d < sp.sprout ? 'acorn' : c.d < sp.mature * 0.25 ? 'seedling' : c.d < sp.mature ? 'sapling' : c.d < sp.old ? 'tree' : 'old tree';
      case 'fern':   return c.d < sp.sprout ? 'spore' : c.d < sp.mature ? 'sprout' : 'fronds';
    }
    return '?';
  }
  // What happens to this plant next, and roughly when, at the current seasonal rate.
  function nextStage(c, g) {
    const sp = SPECIES[c.k];
    const steps = { clover: [['sprout', 'sprouts'], ['mature', 'flowers']],
                    poppy:  [['sprout', 'sprouts'], ['mature', 'blooms'], ['seedEnd', 'goes to seed']],
                    oak:    [['sprout', 'sprouts'], ['mature', 'casts shade'], ['old', 'grows old']],
                    fern:   [['sprout', 'sprouts'], ['mature', 'spreads']] }[c.k];
    for (const [key, label] of steps) {
      const at = key === 'seedEnd' ? sp.mature + sp.bloom : sp[key];
      if (c.d < at) return { label, hours: (at - c.d) / (g * c.j) };
    }
    return null;
  }
  function spanText(h) {
    const d = h / DAY;
    if (h < 1.5) return 'within the hour';
    if (d < 1) return `in about ${Math.round(h)} hours`;
    if (d < 1.5) return 'in about a day';
    if (d < 60) return `in about ${Math.round(d)} days`;
    return `in about ${Math.round(d / 30)} months`;
  }
  function describe(s, i, shade) {
    const c = s.cells[i];
    const sun = shade ? (shade[i] ? 'in shade' : 'in sun') : null;
    if (!c) return 'bare soil' + (sun ? ' · ' + sun : '');
    if (c.k === 'stone') return 'a stone';
    const ageH = s.tick - c.b, ageD = Math.floor(ageH / DAY);
    const ago = ageD < 1 ? (ageH <= 1 ? 'just now' : `${ageH} hours ago`) : ageD === 1 ? 'a day ago' : `${ageD} days ago`;
    if (c.k === 'dead') return `${c.of} · died ${ago} · ` + { age: 'old age', shade: 'too much shade', sun: 'too much sun' }[c.why];
    const sp = SPECIES[c.k];
    const parts = [c.k, stageOf(c), ageD < 1 ? `${ageH} h old` : ageD === 1 ? '1 day old' : `${ageD} days old`];
    if (sun) parts.push(sun);
    if (ageH >= sp.life * c.j * 0.85) parts.push('withering');
    else { const nx = nextStage(c, growthAt(s.tick)); if (nx) parts.push(`${nx.label} ${spanText(nx.hours)}`); }
    return parts.join(' · ');
  }

  // ---- saving ------------------------------------------------------------------------------
  function save(s) { return JSON.stringify(s); }
  function load(json) {
    const s = JSON.parse(json);
    if (!s || s.v !== 2 || !Array.isArray(s.cells) || s.cells.length !== N) throw new Error('not a garden');
    return s;
  }
  // Compact text form, small enough to live in a URL: header then one token per plot.
  const K2L = { clover: 'c', poppy: 'p', oak: 'o', fern: 'f' }, L2K = { c: 'clover', p: 'poppy', o: 'oak', f: 'fern' };
  const WHY = { age: 'a', shade: 'h', sun: 'u' }, YHW = { a: 'age', h: 'shade', u: 'sun' };
  const b36 = n => Math.round(n).toString(36), from36 = t => parseInt(t, 36);
  function encode(s) {
    const cells = s.cells.map(c => {
      if (!c) return '';
      if (c.k === 'stone') return 's';
      if (c.k === 'dead') return 'x' + K2L[c.of] + WHY[c.why] + b36(c.b);
      return K2L[c.k] + b36(c.d) + '.' + b36(c.b) + '.' + b36(Math.round((c.j - 1 + JITTER) * 100));
    });
    return ['2', b36(s.seed >>> 0), b36(s.epoch), b36(s.tick), b36(s.start || 0), ...cells].join(',');
  }
  function decode(text) {
    const p = text.split(',');
    if (p[0] !== '2' || p.length !== 5 + N) throw new Error('not a garden');
    const s = { v: 2, seed: from36(p[1]) | 0, epoch: from36(p[2]), tick: from36(p[3]), start: from36(p[4]), cells: [] };
    if (![from36(p[1]), s.epoch, s.tick, s.start].every(Number.isFinite)) throw new Error('not a garden');
    for (let i = 0; i < N; i++) {
      const tkn = p[5 + i];
      if (!tkn) { s.cells.push(null); continue; }
      if (tkn === 's') { s.cells.push({ k: 'stone' }); continue; }
      if (tkn[0] === 'x') {
        const b = from36(tkn.slice(3));
        if (!L2K[tkn[1]] || !YHW[tkn[2]] || !Number.isFinite(b)) throw new Error('not a garden');
        s.cells.push({ k: 'dead', of: L2K[tkn[1]], why: YHW[tkn[2]], b }); continue;
      }
      const [d, b, j] = tkn.slice(1).split('.');
      if (!L2K[tkn[0]] || [d, b, j].some(v => v === undefined || Number.isNaN(from36(v)))) throw new Error('not a garden');
      s.cells.push({ k: L2K[tkn[0]], d: from36(d), b: from36(b), j: +(1 - JITTER + from36(j) / 100).toFixed(2) });
    }
    return s;
  }

  const api = { W, H, N, TICK_MS, DAY, YEAR, KINDS, SPECIES, WILD, DEAD_FOR, JITTER, WINTER,
    rnd, seasonOf, seasonGrowth, growthAt, dayOfYear, shadeMap, shadePlots, neighbours, canTake,
    step, newState, foundGarden, targetTick, advance, phase, plant, pull,
    info, counts, stageOf, nextStage, describe, save, load, encode, decode };
  root.Sim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
