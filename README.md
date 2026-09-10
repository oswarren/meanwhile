# Meanwhile

A small garden bed that keeps growing on real time while you are away. It is fine without you.

## Open it

Online: https://oswarren.github.io/meanwhile/

Or download the folder and double-click `meanwhile.html`. No install, no server, no account. On a phone, tap a plot once to read it and again to act on it.

- One garden hour passes every 75 seconds, so a garden day is half an hour and a garden year is about a week.
- Pick something from the row under the picture and click a plot. Hover over a plot to read what is there, how old it is, whether it is in sun or shade, and what it will do next.
- Come back whenever you like. Missed time plays back as a short time-lapse; click to skip it.

Where the garden lives: in this browser's local storage, and as a backup in the page's address (the part after `#`). If you want to keep a copy or move it to another browser, copy the address from the address bar. Opening a copied address in a browser that has no garden yet restores it; if that browser already has a garden, the one that is further along wins. "Start over" in the footer asks twice and then gives you a different garden.

## What is in it

Four plants, one stone, and a handful of rules. The footer gives the hints that matter; the rest is there to be noticed. If you would rather read the rules than discover them, they are all in `sim.js`, in the table at the top, with comments.

## Files

- `meanwhile.html` — the page: drawing, interaction, storage.
- `sim.js` — the rules. Pure simulation, no clock, no randomness of its own (everything random is a hash of the garden's seed, the hour, and the plot). The page and the tests share this file.
- `test.js` — `node test.js`: 91 checks of the rules, the clock, and the storage format.
- `tune.js` — `node tune.js [years] [seeds]`: runs the garden for years under four starting conditions and reports what happens (extinctions, turnover, who dominates).
- `browser-test.js` and `cdp.js` — `node browser-test.js`: drives the real page in a headless Chrome or Edge (36 checks: clicking, hover, persistence, the URL backup, the return replay, opening as a local file). Needs Node 22 or later and Chrome or Edge installed; no packages.
- `BRIEF.md` — the original brief, verbatim.
- `DESIGN.md` — the concept as written before building.
- `RECORD.md` — what was decided, what changed, and how it was tested.

Tested in Chrome on Windows (opened by double-click, and served over HTTP). Other browsers should work; they have not been checked.
