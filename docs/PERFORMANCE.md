# Performance: what was measured and what to change

A review of where the app spends its time, and a prioritised list of changes that make it faster without
changing what it does or how it feels. Written for whoever picks this up next: every item says what is slow,
why, exactly what to change, and how to check the result. Read `CLAUDE.md` first for the workflow (every
change goes to `main`, with typecheck, tests, build and a look at the UI).

Measured on 21 October 2026 at commit `318fdb1`. Nothing here is a bug; with today's roadmap sizes the app is
fast. The point is to keep it that way as the roadmap and its history grow, and to fix the one interaction that
is already rough (zooming the timeline).

## Done so far

Items 1–10 are done, and 14, which turned up while doing them. 11–13 are for later, if ever.

Items 1–6 (commits `13f063f`, `f99c7a5`, `305a504`, `09e9893`, `2666f66`, `7dc580d`, 21 October 2026).
Before and after were measured the same way on one Mac with Apple silicon, in headless Chrome 155 (`CHROMIUM=`;
Playwright's own Chromium wasn't installed there), on the production build with the big data. That machine is
faster than the one the tables further down come from, so compare the two columns here with each other.

| | Before | After |
| --- | --- | --- |
| Leadership, ⌘/Ctrl + wheel zoom, 20 steps, 141 bars: wall / frames / p95 / longest frame | 1.8–2.5 s / 100 / 34–39 ms / 40–497 ms | 1.1 s / 66 / 25–28 ms / 26–30 ms |
| `zoom-variants.mjs`: "baseline" vs "no left/width transitions", wall | 2.0 s vs 1.36 s | 1.12 s vs 1.08 s |
| Real input, 30 ⌘/Ctrl + wheel sent at once (Chrome delivers 16): last render after the last event / preference writes | ~500 ms / 16 | ~30 ms / 1 |
| Engine, 1 031 initiatives: `stateFromEntities` / 100-op `applyOps` / `invertOps` / `applyUpdates` | 137 / 16 / 16 / 15.5 ms | 8.8 / 1.0 / 1.1 / 0.15 ms |
| Engine, 3 031 initiatives, the same four | 1 022 / 58 / 58 / 59 ms | 22 / 1.4 / 0.9 / 0.6 ms |
| `GET /api/state?at=`, ~3 100 history rows, ~2 700 after the moment, p50 | 32 ms | 8.4 ms (about 3 ms is `stateAt` bringing 331 stored values up to date) |
| `GET /api/changes?entityId=`, p50 | 2.1 ms | 1.1 ms |
| Sent with gzip: script / stylesheet / bootstrap / History page | 425 / 65 / 194 / 153 kB | 129 / 13 / 13 / 8 kB |
| `/api/changes` requests per change while History or the drawer is open | 1 | 0 |

Items 7–10 (commits `8fc19f7`, `d9ec040`, `c76366c`, `a9438d6`, 22 October 2026) were measured in a Linux cloud
container instead, in Playwright's headless Chromium
(`CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), on the production build with the big data. That is
a different machine again, so again compare only the columns with each other. `measure-ui.mjs` now also prints the
main-thread time Chrome reports per interaction (script, layout, style, number of layouts): frame gaps can't go
below 16.7 ms with vsync, so they hide most of a change like item 7.

| | Before | After |
| --- | --- | --- |
| Item 7. Drag a bar 60 steps, Leadership (141 bars): bars rendered per move / script | 141 / 495 ms | 1 / 76–99 ms |
| Item 7. The same on the Checkout board (67 bars): script | 323 ms | 60–68 ms |
| Item 7. Hover sweep over 40 bars on the board (the family highlight): script | 84 ms | 24–31 ms |
| Item 8. Drag 60 steps, Leadership: layouts / layout time | 60 / 15–16 ms | 60 / 13–17 ms |
| Item 8. Drag into the right edge and hold 1 s (autoscroll), Leadership: layout time | 20–23 ms | 17–18 ms |
| Item 9. Banner render while comparing, 1 031 initiatives | `diffStates` every render, 5 ms | only when the roadmap or the moment changes |
| Item 10. First paint with Google's font hosts hanging for 10 s, server build | 10.4 s | 0.4 s, no request to Google |
| Item 10. The same, single-file demo | the same blocking stylesheet | 0.3 s in the fallback font, the fonts swap in when they arrive |

Item 14 (22 October 2026), whole-roadmap loads (`/api/bootstrap`) counted in the same container, production build,
with a proxy in front of the server that can drop every connection like a network outage:

| | Before | After |
| --- | --- | --- |
| Opening the page | 2 (3 in the dev build, one of them React's StrictMode) | 1 (2 in the dev build) |
| Stream reconnects, nothing changed meanwhile (also: renaming yourself reconnects it) | 1 | 0 |
| Stream reconnects, someone changed something meanwhile | 1 | 1, and the change shows |
| The server restarts | 1 | 1 |
| A change by someone else while connected | 0 | 0 |

Still as before: zoom renders every bar on every step (that is what items 12–13 are about) and typing in the filter
field (p95 41–64 ms at 141 bars in that container).

Learned on the way:
- Item 2's suggested check (10 wheel events dispatched in one task, "1–2 commits, not 10") gives one commit before
  the change as well, because React already batches updates made in one task. What it does show is the preference
  writes (10 → 1). Chrome merges wheel events that arrive within a frame by itself, so the once-per-frame zoom
  matters most in browsers that don't; with real input in Chrome the gain is that the zoom settles at once.
- Compression costs the server about a millisecond per large JSON response (`/api/bootstrap` 1.7 → 2.9 ms p50 on
  localhost), much less than the transfer it saves on any real network.
- For time travel SQLite on its own reads the whole history in entity order; `firstChangesAfter` names the `ts`
  index so a recent moment only reads recent changes (see `db.ts`).
- Item 8 measured as no change, and that is expected in hindsight: Chrome delivers one pointer move per frame and
  React commits after the handler, so the layout that `getBoundingClientRect` forced in the next handler was that
  frame's own layout, done a little earlier, not extra work (the review's "15 ms of self time" was the layout itself).
  Reading `scrollLeft`/`scrollTop` forces a layout just the same, so the plan's "derive from the live scroll
  offsets" alone would not have removed it; the change keeps the offsets on the drag record instead. It stays because
  it behaves identically and leaves nothing in the drag path that can force a layout, which only matters where
  pointer events come faster than frames.
- Counting renders: a `__REACT_DEVTOOLS_GLOBAL_HOOK__` whose `onCommitFiberRoot` walks the committed tree and counts
  fibers named `Block` whose `memoizedProps` differ from their alternate's (dev build, where names survive) gives
  the bars rendered per commit. It also showed the double load at start (item 14).

## How it was measured

- **Browser**: the production build (`npm run build && PORT=3721 npm start`) driven by Playwright in Chromium at
  1440×900, on the example data (31 initiatives, 21 bars in Leadership) and on "big" data (the example plus 300
  generated initiatives: 141 bars in Leadership, 67 on the Checkout board). `scripts/perf/measure-ui.mjs` counts
  React commits (through the DevTools hook) and records frame times during each interaction;
  `scripts/perf/zoom-variants.mjs` injects CSS and event tweaks into the running app to test fixes before
  writing them; CPU profiles came from the Chrome DevTools protocol.
- **Shared maths and engine**: `scripts/perf/bench-engine.ts` runs the pure functions in Node on 331, 1 031 and
  3 031 initiatives.
- **Server**: `scripts/perf/bench-server.mjs` against a throwaway server with the big data and ~3 200 history
  rows.

The development build (`npm run dev:sync`, what the product owner runs) is 2–3× slower than production in every
browser number below, because React's development build checks and records more per element. Judge
performance on a production build; the dev numbers only say *where* the time goes, not how much a user feels.

### Browser, production build

| Interaction (Leadership view) | 21 bars | 141 bars |
| --- | --- | --- |
| Drag a bar, 60 pointer moves: p95 frame | 17 ms | 23 ms |
| ⌘/Ctrl + wheel zoom, 20 steps: p95 frame / frames over 50 ms | 30 ms / 0 | 72–88 ms / 15–19 of ~80 |
| Zoom, same, with the bar transitions turned off | – | 59–61 ms / 8 |
| Type 5 letters in the filter field: p95 frame | 22 ms | 59 ms |
| Open the details drawer: longest frame | 33 ms | 79 ms |
| Hover across 40 bars | no commits (React bails out) | no commits |
| Horizontal scroll, 60 steps: p95 frame | – | 25–33 ms (20 ms with non-sticky names) |

A CPU profile of the zoom at 141 bars: 3.2 s wall, of which 2.3 s is browser layout/style/paint ("program"),
0.7 s JavaScript, 0.2 s idle. Each wheel step re-renders every bar, header cell and grid line, and the CSS
transitions on `left`/`width`/`top` then re-lay out all 141 bars for 160 ms more. The time from a wheel event to
the next painted frame grows from 51 ms to ~140 ms over a 20-step gesture as the work piles up.

### Engine and layout maths (Node, per call)

| | 331 items | 1 031 items | 3 031 items |
| --- | --- | --- | --- |
| `stateFromEntities` (server boot, demo load) | 12 ms | 214 ms | 1 808 ms |
| `applyOps`, 100-op batch (a board's row pins) | 5.6 ms | 48 ms | 105 ms |
| `applyUpdates`, 100 entities (an incoming batch) | 5.1 ms | 25 ms | 106 ms |
| `invertOps`, 100-op batch (undo step) | 7.4 ms | 37 ms | 120 ms |
| `applyOps`, 1 op | 0.15 ms | 0.28 ms | 0.96 ms |
| `pack` (packed lanes by strategic bet) | 2.7 ms | 6.3 ms | 17 ms |
| `pack` with every umbrella open | 8.1 ms | 20 ms | 50 ms |
| `geometry` (per drag frame, too) | 2.2 ms | 5.4 ms | 9.2 ms |
| `diffStates` (compare banner, per render) | 1.7 ms | 5.2 ms | 14 ms |
| `JSON.stringify(state)` | 1.1 ms, 260 kB | 3.4 ms, 820 kB | 12 ms, 2.4 MB |

The first four rows grow with the square of the size: `setEntity` copies the whole collection for every entity
it touches. The layout maths is linear and cheap.

### Server (331 items, 3 200 history rows)

| Request | p50 | Notes |
| --- | --- | --- |
| `POST /api/ops`, 1 op | 1.6 ms | |
| `POST /api/ops`, 100-op batch | 15 ms | |
| `GET /api/bootstrap` | 3.8 ms | 194 kB; 12.6 kB if gzipped. Nothing is compressed today. |
| `GET /api/state?at=` (time travel, compare) | 57 ms | Loads and parses every change after the moment; grows with history. |
| `GET /api/changes?entityId=` (drawer activity) | 3.3 ms | Full table scan (`EXPLAIN QUERY PLAN`: `SCAN changes`); grows with history. |
| `GET /api/changes?limit=200` (History view) | 5.4 ms | 254 kB; refetched after every change while the view is open. |

### Bundle

`dist/client`: one JavaScript file of 424 kB (130 kB gzipped) and 64 kB of CSS (12.7 kB gzipped). By source:
react-dom 49 %, app code 40 % (ItemDrawer 7 %, Timeline 7 %), lucide icons 3 %, react 2 %. The example data is
not in the server build (verified), icons are tree-shaken. The server sends all of it uncompressed with a one-hour
cache, and `index.html` blocks first paint on a stylesheet from fonts.googleapis.com.

### Checked and found fine (no need to look again)

`calendarFor`, `partsIndex`, `rollUp` and `umbrellaColors` are cached per state object; `TimelineHeader` and
`TimelineGrid` are memoised and only re-render on zoom; hovering a bar causes no React commit unless it is a part
of an umbrella (the family highlight); SQLite runs in WAL mode with `synchronous = NORMAL`; the History view pages
by 200; the demo builds to one 492 kB file (147 kB gzipped) and generates its example data in 2 ms.

## The changes, in order

Ordered by what a user gains divided by the work. Sizes: XS under an hour, S a couple of hours, M half a day to
a day, L several days. Do 1–6 first; they are small and cover everything a user can feel today. 7–10 keep the app
smooth as the roadmap grows. 11–13 are for later, if ever. 14 turned up while doing 7–10 and is done.

### 1. Zoom: don't animate bars while the scale changes (client, S) — done

**Why.** `.tl-item` has `transition: left 0.16s, width 0.16s, top 0.2s …` (`src/client/styles.css`, the
`.tl-item` rule) and `.tl-block.is-dragging .tl-item` has `transition: left 0.1s, width 0.1s`. Every zoom step
gives every bar a new `left` and `width`, so the browser re-lays out all of them on every frame for 160 ms after
each step, on top of the step itself. Turning the transitions off took the 20-step zoom at 141 bars from 2.8 s to
2.0 s wall and from 19 to 8 frames over 50 ms. The 0.1 s transition on the dragged bar also makes it trail the
pointer.

**Change.**
- In `Timeline.tsx`, mark the root while the scale is changing: a `zooming` flag set in the `useLayoutEffect`
  that reacts to `scale` (where the scroll anchor is kept) whenever `prev.px !== scale.px`, cleared by a timer
  ~200 ms after the last change. Put it on the root as a class (`tl is-zooming`), via a ref and `classList` rather
  than state, so it causes no extra render.
- In `styles.css`: `.tl.is-zooming .tl-item, .tl.is-zooming .tl-seg { transition: none; }`, and change the
  `.tl-block.is-dragging .tl-item` rule to `transition: box-shadow 0.12s` (no `left`/`width`).
- Keep the transitions otherwise: a dropped bar still glides into its row, and someone else's change still
  animates into place (the owner likes calm movement; see `docs/DECISIONS.md`).

**Verify.** `scripts/perf/zoom-variants.mjs` "baseline" row should now match its "no left/width transitions"
row (frames over 50 ms during 20 zoom steps at ~140 bars: ≤ 8). Drop a bar on the board and in Leadership: it
still animates. Drag a bar: it stays under the pointer.

### 2. Zoom: one render per frame, and stop writing preferences on every wheel event (client, S) — done

**Why.** The wheel handler in `Timeline.tsx` calls `onZoom` on every event whose rounded value changed. Each
call runs `setPrefs` in `store.ts`, which synchronously reads, parses, re-stringifies and writes
`localStorage`, then re-renders the whole timeline (≈50 ms at 141 bars). Trackpads emit wheel events faster
than frames, so the work queues up and the zoom keeps going after the fingers stop. (Playwright sends one event
per frame, so `measure-ui.mjs` cannot show this; a trackpad can.) `setFilters` does the same `localStorage`
round trip on every keystroke.

**Change.**
- In the wheel handler: keep accumulating `pxRef.current`, but emit at most once per animation frame: if no
  `requestAnimationFrame` is pending, schedule one that computes `rounded` from the latest `pxRef.current`,
  sets the zoom anchor from the *latest* pointer position and calls `onZoomRef.current(rounded)`. Cancel the
  pending frame on unmount.
- In `store.ts`, make `writeSaved` trailing-debounced (≈250 ms) for `setPrefs` and `setFilters`: update the
  store at once, write the merged `SavedPrefs` later. Keep `setName`, `setTheme` and `lastTeam` immediate (they
  are rare). Losing the last 250 ms of a zoom or a filter on a hard page close is acceptable; note that in a
  comment.

**Verify.** In Playwright, dispatch 10 `WheelEvent`s with `ctrlKey` in one task without awaiting between them
and count commits through the DevTools hook (see `measure-ui.mjs` for the hook): 1–2 commits, not 10. Zoom with
a trackpad on a Mac: the timeline stops when the fingers stop. Reload: the zoom level and filters are remembered.

### 3. Server: compress responses, cache hashed assets for a year (server, S) — done

**Why.** Express serves the 424 kB script, the 64 kB stylesheet and every JSON response uncompressed; gzip takes
them to 130 kB, 13 kB and (for a 331-item roadmap) 12.6 kB. Assets have hashed names but only a one-hour cache,
so every visit after an hour re-downloads them. A company deploy behind a VPN or on a phone pays this on every
load.

**Change.** In `src/server/index.ts`:
- Add the `compression` middleware (`npm i compression` and `npm i -D @types/compression`; it must be a runtime
  dependency, the Dockerfile installs with `--omit=dev`). Mount it before the routes but **skip
  `/api/events`**: the middleware buffers responses and would stall the server-sent events. For example
  `app.use((req, res, next) => (req.path === '/api/events' ? next() : compress(req, res, next)))`.
- Serve `dist/client/assets` with `express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y' })`
  mounted at `/assets`, and keep the rest of `dist` (and the `index.html` fallback) at `maxAge: 0`. The
  filenames carry a content hash, so a year is safe; `index.html` must stay fresh so it points at the new hashes
  after a deploy.

**Verify.** `curl -sI -H 'Accept-Encoding: gzip' localhost:3000/assets/<name>.js` shows `Content-Encoding: gzip`
and `Cache-Control: public, max-age=31536000, immutable`; `curl -sI localhost:3000/` shows no long cache;
`curl -s -H 'Accept-Encoding: gzip' localhost:3000/api/bootstrap | wc -c` is about a tenth of before. Open
`/api/events` with `curl -N` in one terminal and submit an op in another: the `batch` event arrives at once.
`npm test` (the server tests use the same app). Rebuild the Docker image: the dependency is present.

### 4. Engine: make loading and batches linear (shared, M) — done

**Why.** `setEntity` in `src/shared/engine.ts` copies the whole collection (`{ ...state.items }`) on every
call. `stateFromEntities` calls it once per stored entity, so a server start or a demo load is quadratic: 214 ms
at 1 000 initiatives, 1.8 s at 3 000. `applyOps`, `applyUpdates` and `stateAt` do the same per op; `invertOps`
re-applies every op one at a time, so a 100-op batch costs 48 + 37 ms at 1 000 initiatives, and the client runs
`applyOps` twice when a new umbrella gets its colour pinned. Row pins on the team board (`rowOps` in
`Timeline.tsx`) produce exactly such batches, one op per bar, on the first change of a board.

**Change.** Keep every public signature and the immutability contract (a state object is never changed after it
exists; callers and the `WeakMap` caches in `parts.ts` and `colors.ts` depend on that, and `dispatch` relies on
`applyOps` returning the *same* state object when nothing changed).
- `stateFromEntities` and `stateFromExport`: build `teams`, `tracks` and `items` as plain mutable records and
  return one state at the end (settings first, as now).
- `applyOps`, `applyUpdates`, `stateAt`: inside one call, copy each collection the first time it is touched and
  mutate that copy afterwards. A small local helper (`put(entity, id, value)` with a `Set` of collections already
  copied) replaces the `setEntity` calls; return the original object when nothing was touched.
- `invertOps`: compute each inverse from the entity's value *before that op*, tracked in a local
  `Map<key, Entity | null>` that is updated by applying the op to that value alone (extract the per-op part of
  `applyOps`, the `normalize` of `{ ...before, ...patch }`, into a helper and use it in both places). No more
  `applyOps(cursor, [op])` per op.
- `opsToReach` is fine as it is (it only reads).

**Verify.** `npm test` (engine, history and server tests cover ops, undo and time travel).
`node --disable-warning=ExperimentalWarning scripts/perf/bench-engine.ts`: at 1 031 items `stateFromEntities`
under 10 ms, the 100-op `applyOps`/`applyUpdates`/`invertOps` under 5 ms each. In the UI: undo and redo after
a board drag, a quick add on a board that pins rows, and a strategic-bet drag in Leadership all behave as before.

### 5. Server: the two history queries that scan the table (server, S) — done

**Why.**
- `listChanges({ entityId })` in `src/server/db.ts` runs `WHERE entity_id = ?` alone; the index is
  `(entity, entity_id, seq)`, so SQLite scans the whole table (`EXPLAIN QUERY PLAN`: `SCAN changes`). The drawer
  runs this on every open and after every change anywhere while it is open.
- `changesAfter(ts)` loads and JSON-parses every change after the moment, while `stateAt` only uses the first
  change per entity. Time travel and Compare cost 57 ms at 3 200 rows and grow with the history.

**Change.**
- Add `CREATE INDEX IF NOT EXISTS changes_entity_id ON changes (entity_id, seq);` to the schema in the
  `Database` constructor (it runs on existing databases too, no migration needed).
- Add `firstChangesAfter(ts)` to `db.ts` returning `{ entity, entityId, before }` per entity, with
  `SELECT c.entity, c.entity_id, c.before FROM changes c JOIN (SELECT MIN(seq) AS seq FROM changes WHERE ts > ?
  GROUP BY entity, entity_id) m ON c.seq = m.seq ORDER BY c.seq`, and give `stateAt` in `engine.ts` an input
  type of just those three fields (its `seen` set then no longer matters; keep it or drop it). `MemoryHistory`
  (demo) can keep `changesAfter` and map it. Keep `changesAfter` on `Database` only if something else uses it.
- While there: prepare the statements once in the constructor instead of on every call (`saveEntity`,
  `insertChange`, `lastChangeFor`, `latestSnapshotTs` run several times per batch), and in `index.ts` have
  `broadcast` stringify the payload once instead of once per client.

**Verify.** `node -e` with `EXPLAIN QUERY PLAN` on both queries shows `SEARCH … USING INDEX`. `npm test`.
`scripts/perf/bench-server.mjs`: `GET /api/state?at=` well under 10 ms at 3 000 rows. Time travel, Compare and
the drawer's Activity list show the same things as before.

### 6. History and Activity: use the batch you already have instead of refetching (client, S–M) — done

**Why.** Every applied batch, own or someone else's, bumps `historyVersion`; `HistoryView` then refetches the
newest 200 changes (254 kB uncompressed) and `ItemActivity` in the drawer refetches 50, so dragging on the board
with the drawer open costs a request per drop. The `AppliedBatch` the client receives (from `submit` and from
the `batch` SSE event) already carries the new `ChangeRecord`s in `changes` and the coalesced-away rows in
`removedSeqs`.

**Change.** In `store.ts`, keep the last applied batch (`lastBatch`) next to `historyVersion`. In
`HistoryView` and `ItemActivity`, when the version changes and `lastBatch` is set: drop the records whose `seq`
is in `removedSeqs`, add `lastBatch.changes` (newest first; for Activity only those with the item's `entityId`),
and keep the list sorted by `seq`. Refetch only when `lastBatch` is null (first load, reconnect: `reloadLive`
bumps the version without a batch, keep it that way).

**Verify.** Open History in one tab and edit in another: the feed updates with no `/api/changes` request in the
network panel; a second edit of the same initiative within ten minutes replaces the entry (coalescing) instead
of adding one. Reconnect (stop and start the server): the feed refetches.

### 7. Timeline: memoise the bar so a drag or hover re-renders only the bars involved (client, M) — done

**Why.** `renderBlock` in `Timeline.tsx` runs for every bar on every render, and a drag renders on every pointer
move (61 commits per drag). At 141 bars that is a p95 of 23 ms per frame in production and 34 ms (58 ms max) in
the dev build; it grows linearly, so past ~300 bars drags drop frames. The dragged bar is the only one whose
geometry changes, but `layout` is recomputed with `overrides` on every move, giving every block a new object.

**Change.**
- Compute `layout` from `packing` *without* the drag override (its memo then only changes on data, zoom, phase
  mode or collapsing). Keep a separate `dragGeom` for the dragged bar (`spanGeoms(preview.item, …)` at its
  `rowTop`) and use the override-aware geometry only where it is needed during a drag: the dragged bar itself,
  the family boxes and `DependencyLayer` (both can take `overrides` as a prop and compute from `layout` plus the
  override; or simply recompute a second layout for them, which is cheap JavaScript, as long as the `Block`s
  below read the stable one).
- Move `renderBlock` into a `const Block = memo(function Block(...) {...})` at module level, together with the
  helpers it uses (`linksOf`, `hostOf`, `compareInfo` taking `compare`, `scale`, `metrics`, `phaseMode` and
  `cal` as parameters, `PhaseStrip`, `LinkChip`). Props: the block geometry, `state`, `cal`, `scale`,
  `metrics`, `colorBy`, `phaseMode`, `groupBy`, `mode`, `compact`, `readOnly`, `compare`, and booleans
  `selected`, `dragging`, `family`, `open`, `canExpandHere`, plus the drag offset `dy` (only for the dragged
  bar). Callbacks (`onBegin`, `onClick`, `onEnter`, `onLeave`, `onToggleExpand`, `onLinkMenu`) must be stable:
  `useCallback` with refs for what they read (`begin` already reads `live.current`; add `readOnly` to it).
- The umbrella-family highlight becomes `family={familyId !== null && umbrellaId === familyId}`, so only the
  bars whose value flips re-render.

**Done as described**, with one difference: instead of a second `geometry` pass, `withOverride` (`geometry.ts`)
swaps the dragged item's bars into the stable layout and keeps every other bar's object (a test checks it equals
`geometry` with an override). The family boxes and `DependencyLayer` read that layout; rows, lanes and drop
targets read the stable one. Leadership's impact line under a bar's name (added the same day) is a `Block` prop.

**Verify.** React Profiler (or a render counter in `Block` behind `import.meta.env.DEV`) shows one or two
`Block` renders per pointer move, not 141. `measure-ui.mjs --big`: the drag row's p95 under 10 ms. Every gesture
still works: move, resize either end, two-row height, move between lanes and rows, quick add by drawing and by
double-click, drop from the backlog, open an umbrella from its chevron, the link chip and menu, keyboard
open/enter. Compare mode still draws ghosts and badges.

### 8. Drag: stop forcing layout on every pointer move (client, S) — done, no measurable gain (see above)

**Why.** `computePreview` calls `body.getBoundingClientRect()` on every pointer move, right after React changed
styles for the previous move, so each call forces a synchronous layout (`getBoundingClientRect` shows 15 ms of
self time in a 30-move board drag). `autoScroll` does the same once per frame.

**Change.** Measure the scroller's rect once in `begin()` and keep it on the `DragRec`; derive body coordinates
from it plus the live `scrollLeft`/`scrollTop` (the body sits `labelWidth` to the right and `headH` below the
scroller's content origin; check against `bodyRef` once in development). `slotAt`, `onBackgroundDoubleClick`
and `dropTarget` run once per gesture and can keep measuring.

**Done** with the scroll offsets kept on the `DragRec` (`scrolled`, written by autoscroll, which clamps with the
`maxScroll` measured at the start, and by a passive scroll listener for anything else, e.g. the wheel) rather than
read from the scroller on each move. `view`, `originX`/`originY` are measured once in `begin()`.

**Verify.** A 200 px drag lands on the same sprint and row as before (compare the toast text before and after
the change for the same gesture); autoscroll near the edges still works; the board insert line appears in the
same places.

### 9. Compare banner: memoise the diff (client, XS) — done

**Why.** `Banners` in `App.tsx` calls `diffStates(compare.state, live, cal)` on every render while comparing
(5 ms at 1 000 items, per render, and it renders on every change).

**Change.** `const diff = useMemo(() => compare ? diffStates(compare.state, live, calendarFor(live.settings.sprints)) : null, [compare, live])`
above the early returns (hooks must not sit after a conditional return), and pass it on to `CompareSummary`.

**Verify.** Compare still reports the same counts; `npm run typecheck`.

### 10. Fonts: don't block the first paint on Google Fonts (client, S) — done

**Why.** `index.html` loads a stylesheet from fonts.googleapis.com before anything renders. On a company network
without internet access, or over a slow VPN, the page stays blank until that request fails or times out.

**Change.** Self-host the two families for the server build: put the woff2 files under `src/client/fonts/`
(latin subsets of Instrument Sans 400–700 and IBM Plex Mono 400/500 are about 100 kB together), declare them
with `@font-face { … font-display: swap }` at the top of `styles.css` (Vite copies and hashes the files), and
remove the three Google `<link>`s from `index.html`. The demo (`scripts/inline-demo.mjs`) must stay one file, so
keep Google Fonts there, but load them without blocking:
`<link rel="preload" as="style" href="…" onload="this.rel='stylesheet'">` with a `<noscript>` fallback. (If the
owner prefers one mechanism, the async `preload` pattern alone is acceptable for both builds; self-hosting is the
one that works offline.)

**Done** with Google's own files (latin and latin-ext, upright only; nothing is set in italics) and the OFL
licences in `src/client/fonts/`. In the demo the stylesheet is added by a one-line script rather than the
`preload` + `onload` pattern: a host's content policy may allow inline scripts but not inline event handlers.

**Verify.** `curl -s localhost:3000/` contains no `fonts.googleapis.com`. In Playwright, `page.route` the Google
font domains to hang for 10 s: the server build renders at once with the right fonts, the demo renders at once
with the fallback font and swaps when the stylesheet arrives. `npm run build:demo` still writes one file.

### 11. Lazy-load what the first paint doesn't need (client, S, small gain)

**Why.** react-dom is half the bundle and cannot be split; the app's own code is 170 kB raw (~45 kB gzipped).
Loading `AdminView`, `HistoryView`, `ImpactView`, `CommandPalette`, `ShortcutsModal` and `ItemDrawer` on first
use would take ~70 kB raw (~20 kB gzipped) off the first load. After item 3 the whole bundle is 130 kB gzipped,
so this is a modest win; do it only if first load on slow networks still matters afterwards.

**Change.** `React.lazy` for those components in `App.tsx` with `<Suspense fallback={null}>`. The demo must
stay a single file: in `vite.config.ts` set `build.rollupOptions.output.inlineDynamicImports = true` when
`mode === 'demo'` (`scripts/inline-demo.mjs` only inlines the scripts referenced from `index.html`).

**Verify.** `npm run build` lists several chunks; `npm run build:demo` writes one HTML file that opens from
disk with every view working; `npm run typecheck`.

### 12. Virtualise bars outside the viewport (client, L, only past ~300 bars)

**Why.** Zoom and scroll cost grow with the number of bars in the DOM (each bar is 8–14 elements). At today's
sizes the earlier items are enough; if a roadmap ever reaches several hundred bars in one view, render only the
bars that intersect the scroll viewport plus one screen on each side. Keep `pack` and `geometry` over everything
(dependency arrows, drop targets and the scroll height need them); window only the `Block`s rendered. Always
render the dragged, selected and draft bars. Track `scrollLeft`/`scrollTop`/`clientWidth`/`clientHeight` in
state, updated at most once per frame. Sticky names and the family boxes keep working because the geometry is
unchanged. Risk: blank bars during very fast scrolling; test on a trackpad.

### 13. Fewer elements per bar (client, M, optional)

Only if 12 is not done. Each phase segment carries two resize handle elements (six per bar in Phases mode), always
in the DOM. Hit-testing the segment's own `pointerdown` within 8 px of either edge would remove them (set the
cursor on `pointermove` instead of with CSS). Also: the names inside bars are `position: sticky` so they stay
readable when a bar starts off-screen; that costs about 10 ms per frame of horizontal scroll at 141 bars (33 → 20
ms p95). It is a feature the owner has, so keep it unless scrolling is measured to be a problem.

### 14. Load the roadmap once at start, not twice (client, S) — done

**Why.** `connected` starts `false` in the store, so the event stream's first `open` looks like a reconnect and
`connection(true)` calls `reloadLive()`: every page load fetches `/api/bootstrap` a second time right after the
first (194 kB before compression for 331 initiatives) and replaces the whole roadmap, so every memo recomputes and
every bar renders again about a second after the page appears. In the dev build it is three fetches, because
React's StrictMode runs `boot()` twice; that part is dev-only. The reload is there for a real reason: changes
made between the bootstrap response and the stream connecting would otherwise be missed.

**Change.** Both ends already carry the server's sequence number: `GET /api/bootstrap` returns `seq` and the
stream's first event is `hello` with `{ seq }`. Keep the seq of the roadmap the client holds (bootstrap's, then
the highest `seq` among each applied batch's `changes`, and the new bootstrap's after a reload). Give the live
handlers the `hello` seq (e.g. `connection(true, seq)` from the `hello` listener, and no reload from `open`
itself), and reload only when it differs from the one held. A reconnect after being offline then reloads exactly
when something happened meanwhile. The demo's `local.ts` calls `connection(true)` once; it can pass its own seq or
keep today's behaviour there.

**Done, with a version counter instead of the sequence number.** The newest `seq` is not a version: an edit made
back to where it was within the merge window deletes the earlier history row and writes none (`RoadmapCore.submit`,
"no trace left"), so the roadmap changes while the newest `seq` stays put or even goes down, and a tab that missed
it would see the same number. `RoadmapCore.version` counts the batches that changed the state; the server's
version is `<run>.<count>`, with a random id per server run, so a restart always reads as a change. It is in the
bootstrap, in `hello`, and on every batch sent over the stream (not on the reply to `POST /api/ops`). The store
keeps the version of what it shows (`liveVersion`) from the bootstrap and from stream batches only: they arrive in
order, while the reply to its own submit can overtake someone else's earlier batch. `hello` with another version
(or none) reloads; the `open` event only lights the connection dot. The demo's `LocalApi` reports its own count,
so it doesn't reload at start either. Tests: the counter, including the no-trace case, in `shared.test.ts`; the
handshake over a real stream in `server.test.ts`.

**Verify.** Network panel on load: one `/api/bootstrap` (two in dev). Take a tab offline (DevTools), change
something from another tab, bring it back: its reconnect reloads and shows the change. Restart the server with
nothing changed: no reload. The render counter above: no commit re-renders every bar after the page has loaded.

## Not worth doing now

- `pack`, `geometry`, `umbrellaItems`, `groupsFor`, `headerImpact`: linear and a few ms at 1 000 items.
- `describeChange` for 200 history rows per keystroke: 17 ms frames with 200 rows; cache per `seq` only if
  History is paged much larger.
- The demo's `persist()` writes the whole history to `localStorage` on every edit (debounced); fine at demo size.
  If a long demo session ever hits the 5 MB limit, cap the saved history to the newest few hundred changes.
- Starting the SSE connection in parallel with `/api/bootstrap` would save one round trip at start but needs
  `seq` reconciliation to be safe; not worth the risk.
- `express.json({ limit: '10mb' })`, the keep-alive interval, presence broadcasts, `isEmpty()` at boot: fine.

## Not measured

Phases mode (`pm-separate`) masks every bar's name layer with `mask-image` and draws it twice. The team board
measured here had 67 bars and was smooth; a Leadership view in Phases mode with 140+ bars was not measured. If
it is slow, the mask is the first suspect.
