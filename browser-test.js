// Drives the real page in a headless Chrome:  node browser-test.js
// Checks clicks, hover text, persistence, the URL backup, the return replay, the same rules
// giving the same garden in the browser and in Node, and opening the file by double-click.
// Needs Chrome or Edge installed (see cdp.js). Serves this folder itself; no packages.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { launch, sleep } = require('./cdp.js');
const S = require('./sim.js');
const KEY = 'meanwhile.garden.v2';

let failures = 0;
function check(name, ok, detail) { console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !detail ? '' : ' — ' + detail)); if (!ok) failures++; }

// same geometry as the page
const edgeY = e => 168 + e * 42, edgeS = e => 0.72 + 0.28 * (e / 6), edgeX = (e, col) => 480 + (col - 7) * 68 * edgeS(e);
function plotCentre(i) { const r = (i / 14) | 0, c = i % 14, e = r + 0.5; return [(edgeX(e, c) + edgeX(e, c + 1)) / 2, edgeY(e)]; }
const mouseJS = (type, x, y) => `(() => { const c = document.getElementById('garden'), r = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent('${type}', { bubbles: true, clientX: r.left + ${x} / 960 * r.width, clientY: r.top + ${y} / 460 * r.height })); return true; })()`;
const keyJS = (k, mods = '') => `document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true ${mods} })); true`;
const skyPixelJS = `(() => { const c = document.getElementById('garden'); return Array.from(c.getContext('2d').getImageData(100, 40, 1, 1).data).slice(0, 3); })()`;

// a static server for this folder, on a free port
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'meanwhile.html';
  const p = path.join(__dirname, rel);
  if (!p.startsWith(__dirname) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': (p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'text/plain') + '; charset=utf-8' });
  fs.createReadStream(p).pipe(res);
});

setTimeout(() => { console.error('browser-test.js: gave up after 3 minutes'); process.exit(3); }, 180000).unref();

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  console.log('serving ' + __dirname + ' on port ' + server.address().port);
  const ORIGIN = `http://127.0.0.1:${server.address().port}`;
  const URL = `${ORIGIN}/meanwhile.html`;
  const NEUTRAL = `${ORIGIN}/sim.js`;   // same origin, but not the garden page (which saves itself on pagehide)
  const FILE = 'file:///' + path.resolve(__dirname, 'meanwhile.html').replace(/\\/g, '/');
  const page = await launch();
  console.log('browser: ' + page.browser);
  const stored = async () => JSON.parse(await page.eval(`localStorage.getItem('${KEY}')`));
  const text = async id => page.eval(`document.getElementById('${id}').textContent`);
  const shiftEpoch = async days => { await page.goto(NEUTRAL); await page.eval(`(() => { const s = JSON.parse(localStorage.getItem('${KEY}')); s.epoch -= ${days * S.DAY * S.TICK_MS}; localStorage.setItem('${KEY}', JSON.stringify(s)); return true; })()`); };
  try {
    await page.goto(URL);
    check('page loads without exceptions', page.errors.length === 0, page.errors.join('; '));
    const status = await text('status');
    check('status line reads late spring, eight in the morning', status === 'late spring · 08:00', status);
    let saved = await stored();
    const c0 = S.counts(saved);
    check('a found garden is there on first open', c0.oak >= 1 && c0.clover > 0 && c0.poppy > 0 && c0.fern > 0, JSON.stringify(c0));
    check('the address bar carries a backup of the garden', (await page.eval('location.hash')).startsWith('#2,'));
    check('hover line is empty when the mouse is elsewhere', (await text('hover')) === '');
    const daySky = await page.eval(skyPixelJS);
    check('the sky is light in the morning', daySky[2] > 150, JSON.stringify(daySky));

    // find three sunlit bare plots to work with
    const shade = S.shadeMap(saved.cells);
    const bare = saved.cells.map((c, i) => (!c && !shade[i]) ? i : -1).filter(i => i >= 0);
    check('there is bare soil to plant on', bare.length >= 3, `${bare.length}`);
    const [p1, p2, p3] = bare;

    // hover, then plant with the default tool (clover)
    let [x, y] = plotCentre(p1);
    await page.eval(mouseJS('mousemove', x, y));
    let hov = await text('hover');
    check('hover on bare soil offers to plant clover', hov === 'bare soil · in sun — click to plant clover', hov);
    await page.eval(mouseJS('click', x, y));
    saved = await stored();
    check('click plants clover and saves it', saved.cells[p1] && saved.cells[p1].k === 'clover');
    hov = await text('hover');
    check('hover now describes the seed and what comes next', /^clover · seed · 0 h old · in sun · sprouts (within the hour|in about \d+ hours) — click to plant clover over it$/.test(hov), hov);

    // keyboard tool selection: oak on p2, stone on p3, then pull the stone
    await page.eval(keyJS('3')); [x, y] = plotCentre(p2); await page.eval(mouseJS('click', x, y));
    await page.eval(keyJS('5')); [x, y] = plotCentre(p3); await page.eval(mouseJS('click', x, y));
    saved = await stored();
    check('key 3 selects oak, key 5 selects stone', saved.cells[p2]?.k === 'oak' && saved.cells[p3]?.k === 'stone');
    await page.eval(keyJS('2', ', ctrlKey: true'));
    check('Ctrl+digit (a browser shortcut) does not change the tool', (await page.eval(`document.querySelector('#tools button.on').dataset.id`)) === 'stone');
    await page.eval(mouseJS('mousemove', x, y));
    check('a stone cannot be planted over', (await text('hover')) === 'a stone — pull it first to plant here', await text('hover'));
    await page.eval(keyJS('6')); await page.eval(mouseJS('click', x, y));
    saved = await stored();
    check('pull clears the stone', saved.cells[p3] === null);
    await page.eval(mouseJS('click', 400, 60));
    check('clicking the sky changes nothing', JSON.stringify((await stored()).cells) === JSON.stringify(saved.cells));
    let oakIdx = -1; saved.cells.forEach((c, i) => { if (c && c.k === 'oak' && i !== p2 && (oakIdx < 0 || c.d > saved.cells[oakIdx].d)) oakIdx = i; });
    [x, y] = plotCentre(oakIdx); await page.eval(keyJS('1')); await page.eval(mouseJS('mousemove', x, y));
    hov = await text('hover');
    check('the found tree reads as a tree with an age', /^oak · tree · \d+ days old · in sun · grows old in about \d+ (days|months) — pull it first to plant here$/.test(hov), hov);

    // reload: everything still there, and the hash matches storage
    await page.reload();
    const after = await stored();
    check('after reload the garden is the same', after.cells[p1]?.k === 'clover' && after.cells[p2]?.k === 'oak' && after.seed === saved.seed);
    const hashState = S.decode(decodeURIComponent((await page.eval('location.hash')).slice(1)));
    check('the URL backup decodes to the same garden', hashState.seed === after.seed && hashState.tick === after.tick && hashState.cells[p2]?.k === 'oak');

    // storage wiped: the garden comes back from the address
    const url = await page.eval('location.href');
    await page.goto(NEUTRAL); await page.eval(`localStorage.removeItem('${KEY}'); true`);
    await page.goto(url);
    const restored = await stored();
    check('with storage cleared, the garden is restored from the URL', restored && restored.seed === after.seed && restored.cells[p2]?.k === 'oak', restored && JSON.stringify(S.counts(restored)));

    // an old address must not resurrect a garden that was started over
    await page.eval(`document.getElementById('reset').click(); document.getElementById('reset').click(); true`);
    const newer = await stored();
    check('start over gives a different garden', newer.seed !== restored.seed);
    await page.goto(NEUTRAL); await page.goto(url);   // the URL of the old garden (via another page: a hash-only change would not reload)
    check('opening the old garden\'s address keeps the new garden (most recently saved wins)', (await stored()).seed === newer.seed);

    // return after ten garden days: the page replays, then lands on the right tick
    await shiftEpoch(10);
    const before = await stored();
    await page.goto(URL);
    await sleep(500);
    const cap = [await page.eval(`document.getElementById('caption').className`), await text('caption')];
    check('replay caption appears', cap[0] === 'on' && cap[1] === 'Meanwhile', JSON.stringify(cap));
    check('hover is disabled during replay', (await text('hover')) === '');
    const replaySky = await page.eval(skyPixelJS);
    check('the light holds steady during the replay (no day/night strobe)', replaySky[2] > 150, JSON.stringify(replaySky));
    await sleep(3000);
    const after2 = await stored();
    check('replay finishes and caption hides', (await page.eval(`document.getElementById('caption').className`)) === '');
    check('garden advanced by ten days', after2.tick >= before.tick + 10 * S.DAY && after2.tick <= before.tick + 10 * S.DAY + 2, `${after2.tick - before.tick}`);
    const ref = S.load(JSON.stringify(before)); for (let k = 0; k < after2.tick - before.tick; k++) S.step(ref);
    const diffs = ref.cells.map((c, i) => JSON.stringify(c) !== JSON.stringify(after2.cells[i]) ? i : -1).filter(i => i >= 0);
    check('replay result matches the headless simulation exactly', diffs.length === 0, `${diffs.length} plots differ`);

    // a click during the replay skips it
    await shiftEpoch(200);
    await page.goto(URL); await sleep(300);
    await page.eval(mouseJS('click', 480, 300));
    await sleep(200);
    const after3 = await stored();
    check('a click skips the replay', (await page.eval(`document.getElementById('caption').className`)) === '' && after3.tick >= after2.tick + 200 * S.DAY, `${after3.tick - after2.tick}`);
    check('two hundred days later it is a different season', (await text('status')) !== 'late spring · 08:00', await text('status'));

    // start over needs two clicks, and a stale timer must not cut the second prompt short
    await page.eval(`document.getElementById('reset').click(); true`);
    check('first click on start over only arms it', (await text('reset')).startsWith('really') && (await stored()).seed === after3.seed);
    await page.eval(`document.getElementById('reset').click(); true`);
    const fresh = await stored();
    check('second click starts a new found garden', fresh.seed !== after3.seed && S.counts(fresh).oak >= 1 && fresh.tick === fresh.start);

    // the same rules must give the same garden in Chrome and in Node, from any state
    for (const [label, st] of [['found garden', S.foundGarden(0, 777)], ['current page state', await stored()]]) {
      const json = JSON.stringify(st);
      const inPage = await page.eval(`(() => { const s = Sim.load(${JSON.stringify(json)}); for (let k = 0; k < 3000; k++) Sim.step(s); return JSON.stringify(s.cells); })()`);
      const inNode = S.load(json); for (let k = 0; k < 3000; k++) S.step(inNode);
      const d = JSON.parse(inPage).map((c, i) => JSON.stringify(c) !== JSON.stringify(inNode.cells[i]) ? i : -1).filter(i => i >= 0);
      check(`3000 ticks in the browser equal 3000 ticks in Node (${label})`, d.length === 0, `${d.length} plots differ`);
    }

    // the real way in: double-clicking the file (a file:// origin, separate storage)
    await page.goto(FILE);
    check('opens from file:// without exceptions', page.errors.length === 0 && /^(early|mid|late) \w+ · \d\d:00$/.test(await text('status')), page.errors.join('; '));
    const f0 = await stored();
    const fbare = f0.cells.findIndex((c, i) => !c && !S.shadeMap(f0.cells)[i]);
    await page.eval(keyJS('5')); [x, y] = plotCentre(fbare); await page.eval(mouseJS('click', x, y));
    await page.reload();
    const f1 = await stored();
    check('file:// garden persists across reload (localStorage works there)', f1.seed === f0.seed && f1.cells[fbare]?.k === 'stone');
    check('file:// URL also carries the backup', (await page.eval('location.hash')).startsWith('#2,'));
    check('no exceptions during the whole run', page.errors.length === 0, page.errors.join('; '));
  } finally { page.close(); server.close(); }
  console.log(failures ? `\n${failures} browser checks failed` : '\nall browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(2); });
