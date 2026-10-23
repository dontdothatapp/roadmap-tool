# Roadmap Anywhere: notes for Claude

An internal roadmap tool, meant to be a company's single source of truth for what is planned, by whom, when, and
what it should move. One shared roadmap, several views for different audiences. `README.md` is the product
documentation (what each view does, for users); this file is how to work on the code. Deeper material:

- `docs/ARCHITECTURE.md`: how the code fits together (data, engine, store, timeline layout), file by file.
- `docs/DECISIONS.md`: product decisions already made with the user, and why. Read it before changing behaviour,
  so you don't undo something they asked for.
- `docs/PERFORMANCE.md`: measured hot spots and a prioritised list of performance changes, each with exact
  instructions and how to verify it (`scripts/perf/` has the measuring scripts).
- `BACKLOG.md`: ideas and planned features, newest at the top. When the user shares an idea, add it there; when
  one ships, remove it and describe it in the README.

## How the user works (read this first)

- The user is the product owner. They send short requests, often several numbered items at once, usually with a
  screenshot or a screen recording (extract frames with `ffmpeg -i video.mp4 -vf fps=1 frame%02d.png`). Make
  sensible decisions yourself and say what you chose; ask only when a choice really changes what gets built.
- They test on their Mac with `npm run dev:sync` on **`main`**: it follows `origin/main` every 15 s and the
  browser reloads by itself. So work isn't "delivered" until it is on `main`.
- **After every change:**
  1. `npm run typecheck && npm test && npm run build`, and check the UI in a browser (see *Verifying* below).
  2. Commit on your working branch (so far `claude/roadmap-tool`; use the one your session is given): a
     descriptive subject, a body explaining what and why, then the attribution trailers your harness asks for.
  3. Push the branch and fast-forward main from it, e.g. `git push -u origin claude/roadmap-tool` and
     `git push origin claude/roadmap-tool:main`. If main has moved on, merge it in first; never force-push main.
  4. `npm run build:demo` and, if you can publish artifacts, republish `dist/demo/roadmap-demo.html` to the
     existing demo (https://claude.ai/artifact/WXfq375LyGAkj26fWhZfQM), updating it in place so the URL stays.
  5. Reply per numbered request: what changed, what you verified, any trade-off or follow-up worth knowing.
- Their real data lives in their local `data/roadmap.db`, which you never see. Anything that changes stored data
  must upgrade old data on load (see *Adding a field*); never assume a fresh database.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server with the Vite dev middleware on `PORT` (default 3000), seeded with example data on first run |
| `npm run dev:sync` | `dev`, plus pulls new commits on the current branch every 15 s (what the user runs) |
| `npm test` | Vitest, all of `tests/` (~60 tests, a couple of seconds) |
| `npm run typecheck` | `tsc --noEmit` over client, server and tests |
| `npm run build` | Production client bundle into `dist/client` |
| `npm run build:demo` | Single-file, server-less demo: `dist/demo/roadmap-demo.html` (in-browser API, localStorage) |
| `npm start` | Production server (serves `dist/client`) |

Server environment: `PORT`, `HOST`, `DATA_DIR` (SQLite file `roadmap.db` in it, default `./data`), `SEED`
(`demo` or `empty`, used only when the database is empty), `AUTH_HEADER` (identity from an SSO proxy header).
For a throwaway instance: `PORT=3720 DATA_DIR=/tmp/rm-data npm run dev` (delete the folder for fresh demo data).

## Stack

Node ≥ 22.18 running TypeScript natively (no server build): imports always carry explicit `.ts`/`.tsx`
extensions. Express 5, `node:sqlite`, server-sent events for live updates. Client: React 19, zustand, Vite,
lucide-react icons, one hand-written stylesheet (`src/client/styles.css`, design tokens as CSS variables, dark
mode through the same tokens), fonts served from `src/client/fonts/` (the single-file demo loads them from Google
instead). Vitest for tests; Playwright (dev dependency) for driving the UI.

## Where things are

```
src/shared/   Everything both server and browser run: types, the op engine and history, normalisation,
              sprint calendar, parts (umbrellas), impact maths, history wording, board colours, demo seed.
src/server/   Express app (index.ts), SQLite storage (db.ts), one-off data migrations (migrations.ts).
src/client/   React app: store.ts (state, routing, prefs), App.tsx (shell, sidebar, shortcuts),
              views/ (one file per view), timeline/ (the shared timeline), components/ (drawer, toolbar,
              search, ui primitives), lib/model.ts (grouping, filters, colours), api/ (HTTP and in-browser).
tests/        Vitest: shared logic, geometry, model helpers, parts, colours, server API.
scripts/      dev-sync.mjs (follow GitHub), inline-demo.mjs (make the demo a single HTML file).
docs/         ARCHITECTURE.md, DECISIONS.md, screenshots/ used by the README.
```

The two big files are `src/client/timeline/Timeline.tsx` (rendering and the drag state machine) and
`src/client/components/ItemDrawer.tsx` (initiative details). Layout maths is in `src/client/timeline/geometry.ts`.

## Words that mean something specific here

- **Initiative** = `Item`. **Team**, **strategic bet** and **settings** are the other entities.
- **Strategic bet** is called **track** in the code and the stored data (`trackId`, `state.tracks`, entity
  `'track'`, `GroupBy 'track'`). The UI says "strategic bet" everywhere. Don't rename the code or data; do use
  "strategic bet" in anything a user reads.
- **Umbrella / parts**: an item whose `parentId` points at another is a *part* of that *umbrella* (one level
  only). The umbrella holds the shared title, outcomes, one-pager and strategic bet; its dates are the union of its
  parts' (`rollUp`). Leadership, Alignment, Impact and the bet view show umbrellas; the team view shows parts.
- **Phases**: `discovery`, `ux`, `implementation`, each an optional `{ start, end }` ISO-date span aligned to
  sprint edges (`end` exclusive). Phase modes: *Phases* (`separate`), *Combined*, *Implementation*.
- **Sprints**: a repeating cadence from an anchor (`DEFAULT_SPRINTS`: Thursday 2026-10-01, 2 weeks "W",
  2 weeks "W", 1 week "BB" Brilliant Basics, named after the ISO week they start in: W40, W42, BB44).
- **Status**: `planned | at_risk`. The only flag is *at risk* (an icon in the details' header); "On track" is
  never shown as a label. Older statuses (idea, in progress, done) read as `planned` on load.
- **Connection**: a `Dependency` in the code and data ("this item needs …"). The details list both directions
  together (*Needs* / *Needed by*). Its `status` (agreed, delivered) is kept but no longer shown or used.
- **Tags** were taken out of the product: `Item.tags` is kept for old data but not shown, filtered or edited.
- **Outcome**: funnel stage + expected impact (`%`, `pp` or absolute) + landing month (`landsBy`, null = month
  implementation ends) + optional ramp-up (share of the impact per month after landing).
- **Board** (team view): rows are stored per item (`row`, `tall` for two-row bars). **Board colour**: every bar
  is the same pastel; an umbrella's `color` shows as the tag on its parts (name and dot in its deeper `ink`
  shade, see `src/shared/colors.ts`). A standalone item's own `color` is kept but no longer shown.
- **Own view**: a strategic bet with `ownView: true` gets its own sidebar entry and view (`#bet.<id>`).

## Conventions

- Match the surrounding code: comments explain *why* in full sentences and product language, names are plain
  words, small pure helpers in `src/shared` with tests, UI state in the zustand store.
- UI copy: plain, short, sentence case, British spelling in labels ("Colour"), product words from the glossary.
- Every change to the roadmap goes through ops (`dispatch(ops, label)` in the client), never by mutating state:
  that's what gives undo, history, live updates and the demo for free. The label is the undo toast / history text.
- Layout-only fields (`order`, `row`, `tall`, `color`) are minor in History and ignored by Compare.
- Add or update tests for shared logic and layout maths (`tests/`); the UI is checked by driving it.
- Keep the README in sync when a user-visible behaviour changes; refresh `docs/screenshots/` only when a view's
  look changes a lot.

## Adding a field to an item, team or strategic bet

1. Add it to the type in `src/shared/types.ts` (with a comment saying what it means).
2. Give it a default in `normalizeItem` / `normalizeTeam` / `normalizeTrack` (`src/shared/engine.ts`). Stored
   entities pass through `upToDate()` on load and in time travel, so old data gets the default automatically.
3. Describe changes to it in `src/shared/describe.ts` (History wording); if it's layout-only, mark it minor there
   and add it to `IGNORED` in `src/shared/diff.ts`; if it's plan data, add it to `FIELD_LABELS` in
   `src/client/components/CompareSummary.tsx`.
4. If the example data should show it, update `src/shared/seed.ts` and bump `STORAGE_KEY` in
   `src/client/api/local.ts` so saved demos start over.
5. Settings changes that need converting old values go in `src/server/migrations.ts` (run at server start).

## Verifying UI changes

Start a throwaway server, then drive it with Playwright from `node_modules` and look at screenshots:

```js
import { chromium } from '/path/to/repo/node_modules/playwright/index.mjs';
const browser = await chromium.launch(); // in the cloud container: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem('roadmap-anywhere-prefs-v1', JSON.stringify({ name: 'Test', prefsVersion: 2 })));
const page = await ctx.newPage();
await page.goto('http://localhost:3720/#leadership');
```

Setting a name in the prefs skips the "who are you" prompt. Check light and dark (`colorScheme: 'dark'`), the
zoom levels that matter, and measure positions (`boundingBox`) when the request is about layout. Writes through
`POST /api/ops` (`{ ops: [...] }`) are handy for setting up data.

## Gotchas that have cost time before

- `position: sticky` inside an element with `overflow: hidden` sticks to that element, not the timeline. Timeline
  cells and bars use `overflow: clip` for this reason.
- Packed lanes keep an 8 px gap between bars in a row; list rows and compact rows use 0 and inset the bar ends
  (`endInset`) instead, so back-to-back initiatives share a row with a visible gap.
- Opening an umbrella must not move it: lanes are packed as if closed, then rows are inserted under it (`openUp`).
- The leadership header height depends on the expected-impact lines (`headH` in Timeline.tsx: `topTierH(impact)`
  plus `LOWER_TIER_H`), so never assume a fixed header height.
- The bet view does its own grouping (section header rows) and passes `groupBy="none"` to the Timeline: a real
  `groupBy` there would turn vertical drags into "move to that lane" edits.
- `ColorBy 'board'` (one bar colour, umbrella tags) is only for the team view; `GroupBy 'umbrella'` only for the team view.
- New umbrellas get a pinned board colour inside the client `dispatch` (`pinUmbrellaColors`); umbrellas without
  one get a computed colour in id order. Server-side imports don't pin.
- In the cloud container, background dev servers can be reaped between turns: start them with the harness's
  background option and check `curl localhost:PORT` before driving the UI. `pkill -f` can kill your own shell.
- Old stored items may lack newer fields (`row`, `tall`, `color`...). Never read them raw from storage; go
  through `stateFromEntities` / `stateAt`, which normalise.
