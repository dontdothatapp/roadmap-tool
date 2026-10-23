# Architecture

How Roadmap Anywhere fits together, for whoever changes it next. Start with `CLAUDE.md` for the workflow and
the glossary; this goes one level deeper.

## The big picture

```
 browser                                              server (Node, no build step)
 ┌───────────────────────────────────────────┐        ┌──────────────────────────────────────┐
 │ views/*  ──>  timeline/Timeline (layout,  │        │ index.ts  Express: /api/*, SSE,      │
 │               drag & drop, rendering)     │        │           Vite middleware in dev     │
 │    │                                      │  ops   │    │                                 │
 │ store.ts (zustand): live state, dispatch ─┼──────> │ RoadmapCore.submit (shared/engine)   │
 │    │   optimistic apply, undo/redo        │ <──────┼─ batches over SSE to every client    │
 │ api/http.ts  or  api/local.ts (demo)      │        │ db.ts  SQLite: entities, changes,    │
 └───────────────────────────────────────────┘        │        snapshots                     │
                 shared/  (both sides run the same engine, types and maths)                 │
                                                       └──────────────────────────────────────┘
```

The state is small (all items, teams, strategic bets and settings) and lives whole in every client. Every edit
is a list of **ops**; both the server and the in-browser demo apply them with the same engine, so behaviour is
identical with or without a server.

## Data model (`src/shared/types.ts`)

`RoadmapState = { settings, teams, tracks, items }`, keyed by id.

- `Item` (an initiative): title, `teamId`, `trackId` (strategic bet), `tags` (kept, not shown), `status`, description, `phases`
  (`discovery` / `ux` / `implementation`, each `{ start, end }` ISO dates, end exclusive), `onePagerUrl`,
  `links`, `outcomes`, `dependencies` (connections in the UI: on an item or on a team), `order`, `row` and `tall` (team board),
  `parentId` (umbrella), `color` (board colour id). `key` and `owner` are kept for old data but no longer shown.
- `Team`: name, colour, order, `archived`, and its owners `pm` / `em` / `ux`.
- `Track` (strategic bet): name, colour, order, description, `ownView`.
- `Settings`: roadmap name, fiscal year start, `funnelStages` (the stages outcomes move), `sprints` (anchor date,
  repeating pattern of sprint kinds, naming).
- `Op`: `{ kind: 'create' | 'update' | 'delete', entity: 'item' | 'team' | 'track' | 'settings', id, data | patch }`.
- `ChangeRecord`: one entity's change with full `before` / `after`, actor, time, `batchId` (ops sent together).

## The engine (`src/shared/engine.ts`)

- `normalizeItem` / `normalizeTeam` / `normalizeTrack` / `normalizeSettings`: every entity entering the state
  passes through these. They clamp, default and sanitise (e.g. `safeUrl` drops `javascript:` links), so the rest
  of the app can trust the shape. New fields get their default here.
- `applyOps(state, ops)` returns the new state and what each op did; `invertOps` builds the undo. A state object
  never changes once it exists (undo, the `WeakMap` caches in `parts.ts` and `colors.ts`, and React rely on it),
  and `applyOps` returns the very same object when nothing changed (`dispatch` relies on that). Functions that
  change many entities at once (`applyOps`, `applyUpdates`, `stateAt`, `stateFromEntities`) go through a `Draft`
  that copies each collection once per call, so a batch or a load costs time in proportion to its size.
- `validateOps` checks ops coming over the wire.
- `RoadmapCore.submit(ops, { actor })` applies a batch, saves entities, and records history. Consecutive edits
  to one entity by the same person within 10 minutes are merged into one change (`COALESCE_WINDOW_MS`), never
  across a snapshot, and an edit back to where it started leaves no trace.
- `stateFromEntities` (loading) and `stateAt` (time travel: current state with later changes rolled back) pass
  stored values through `upToDate()`, which runs the normalisers. That's how data saved by older versions gains
  newer fields without migrations. `stateAt` only needs each entity's first change after the moment
  (`ValueBefore`: entity, id, value before); the server asks the database for just those.
- `opsToReach(from, to)` turns an imported roadmap into ops, so an import is undoable and in History.

Other shared modules:

| File | What's in it |
| --- | --- |
| `sprints.ts` | `SprintCalendar` (turns the cadence into concrete sprints both ways from the anchor; `between`, `at`, `indexOf`, `spanFromIndexes`, codes like W42), `DEFAULT_SPRINTS`, span helpers (`overallDays`, `deliveryEndDay`, `needStartDay`) |
| `dates.ts` | Day numbers (days since epoch), ISO dates, ISO weeks, quarters with a fiscal-year start, formatting |
| `parts.ts` | Umbrellas: `partsIndex`, `partsOf`, `umbrellaOf`, `rollUp` (umbrella dates = union of its parts', cached per state), `linkOps`, `onePagerOf`, `linkedOutcomes`, `partLabel` |
| `impact.ts` | Outcome maths: landing month, ramp-up share per month, impact gained per period (`driversIn`, `totalsOf`, `impactMatrix`), `landingText` / `landingSteps`; comparing two versions: `figuresOf` ("+3% → +5%"), `stageFigures` (an initiative's outcomes per stage, for its bar), `driverChanges` |
| `colors.ts` | Umbrella colours for the team board (`BOARD_COLORS`: a pastel `hex` and a deeper `ink` for tags), `boardColorOf`, `umbrellaColors`, `pinUmbrellaColors` |
| `describe.ts` | Turns a `ChangeRecord` into History text ("Rescheduled… W42 → W44 (+1 sprint)"), marks layout-only changes minor; `epdLine` for team owners |
| `diff.ts` | `diffStates` for Compare: added / removed / slipped / changed fields, ignoring layout-only fields |
| `seed.ts` | `generateDemo()`: the example roadmap with history and snapshots |
| `util.ts` | `uid`, `safeUrl`, `str`, `stableEqual` |

## Server (`src/server`)

- `index.ts`: Express 5. Identity comes from the `AUTH_HEADER` header when set (an SSO proxy in front), else from
  the name people type in, sent as `x-user-name`. Endpoints: `GET /api/bootstrap` (state, seq, version, me,
  snapshots), `POST /api/ops`, `GET /api/state?at=` (time travel), `GET /api/changes`, `GET`/`POST /api/snapshots`,
  `DELETE /api/snapshots/:id`, `GET /api/export`, `POST /api/import`, `GET /api/events` (SSE: `hello` with the
  version, batches with the version after each, presence, snapshots, `reload` after an import) and
  `GET /api/health`. The version is this run of the server plus `RoadmapCore.version` (batches applied). In `--dev`
  it mounts Vite as middleware; otherwise it serves `dist/client`. Responses are compressed (`compression`), except
  the SSE stream, which it would hold back. Hashed files under `/assets` are cached for a year (`immutable`);
  `index.html` is checked on every load so a deploy shows at once.
- `db.ts`: `node:sqlite`. Tables `entities` (entity, id, JSON value), `changes` (the history), `snapshots`.
  Implements the engine's `HistoryStore`. Fixed statements are prepared once. Indexes on `changes`:
  `(entity, entity_id, seq)` for coalescing, `(entity_id, seq)` for an initiative's activity, `(ts)` for time
  travel (`firstChangesAfter`, which reads only the changes after the moment).
- `migrations.ts`: one-off conversions of stored settings, run at start and recorded in History (so far: moving
  roadmaps off the two earlier built-in sprint calendars, shifting dates to keep their sprints).

## Client (`src/client`)

### Store (`store.ts`)

One zustand store: `live` (the roadmap), `me`, `route`, `prefs`, `filters`, `travel` / `compare` (a past state
being viewed or compared against), undo/redo stacks, toasts, overlays.

- `useVersions()`: while time travelling or comparing, the older version (`before`) and today's (`after`); the
  Leadership and Impact views use it to show expected impact then → now.
- `dispatch(ops, label)`: applies ops locally at once, pins colours for newly formed umbrellas, pushes an undo
  step, sends the ops, and settles with the server's answer. Edits from others arrive as SSE batches and are
  applied with `applyUpdates`, except entities with own edits still in flight. Helpers on top: `updateItem`,
  `createItem`, `createScheduledItem`, `deleteItem` (detaches parts), `duplicateItem`, `nudgeItem`, `setPhase`.
- Routing is in the hash: `#view[.teamId | .betId][~itemId]`, e.g. `#team.growth~payments-api`,
  `#bet.conversion`. Views: `leadership`, `alignment`, `team`, `bet`, `impact`, `history`, `admin`.
- Per-person preferences per timeline view (`ViewPrefs`: phase mode, zoom `pxPerDay`, `groupBy`, `colorBy`,
  dependency arrows, collapsed lanes, `expanded` umbrellas) are kept in localStorage under
  `roadmap-anywhere-prefs-v1` and sanitised on load (`mergePrefs`). Zoom and filters change many times a second,
  so `setPrefs` and `setFilters` save 250 ms after the last change (and when the page is left). Small UI
  conveniences (open panels, chosen period) use `usePersistentState` (`lib/persist.ts`).
- Live stream: the store keeps the server version its `live` roadmap reflects (`liveVersion`: from the bootstrap,
  then from each batch on the stream, never from the reply to its own submit, which can overtake someone else's
  earlier batch). When the stream (re)connects, `hello` says the server's version; only if it differs (changes
  between loading and connecting, while offline, or a server restart) is the whole roadmap fetched again.
- `historyVersion` goes up with every applied batch, `lastBatch` holds that batch (null after a reload of the
  whole roadmap). Open history lists (History view, the drawer's activity) use `useHistoryRows`
  (`lib/historyRows.ts`): fetched once, then each batch's rows merged in (`mergeBatch` in `lib/history.ts`), so
  they cost no request per change; a null `lastBatch` (reconnect, import) makes them fetch again.
- `api` is `HttpApi` normally, `LocalApi` in the demo build (`__DEMO__`): a `RoadmapCore` with in-memory
  history saved to localStorage under `STORAGE_KEY`.

### Views (`views/`)

| View | File | How it's built |
| --- | --- | --- |
| Leadership | `LeadershipView.tsx` | `rollUp` state, `umbrellaItems` (umbrellas and standalone items that pass filters), lanes from `groupsFor` (strategic bet by default, or team / stage / tag / none), packed timeline with expected impact in the header (`outcomes` prop, with `was` drivers when comparing) and under each bar's name (`impactLines`) |
| Alignment | `AlignmentView.tsx` | Same as leadership, lanes by team, no impact header; or, with `showParts`, parts and standalone items (`partItems`), each part tagged with its umbrella |
| Team | `TeamView.tsx` | One team's parts and standalone items; list mode (the free board, names in bars, stored rows), one bar colour with each part's umbrella as a coloured tag (`colorBy 'board'`), optional grouping (umbrella, bet, stage, tag); Sprint overview and Backlog side panels |
| Strategic bet | `BetView.tsx` | One bet: compact timeline, a row per umbrella or standalone item named in the label column, umbrellas open into one named line per part, optional team / tag sections |
| Impact | `ImpactView.tsx` | Funnel stage × period matrix of impact gained, with a drivers panel |
| History | `HistoryView.tsx` | Change feed, snapshots, time travel, compare with today |
| Settings | `AdminView.tsx` | Roadmap name, teams (owners, archive), strategic bets (own view), sprint calendar, funnel stages, import/export |

Shell (`App.tsx`): sidebar (an icon rail that opens on hover, or pinned), item drawer, search (`CommandPalette`),
shortcuts help, global keys (N, 1–5, T, +/−, arrows), presence, toasts.

`components/ItemDrawer.tsx` is the initiative details panel: the at-risk flag in its header, title, strategic bet
and umbrella ("Part of") side by side, umbrella colour (umbrellas and parts only), schedule (phase chips + sprint
range picker) or parts, description, one-pager and links, expected outcomes (with ramp-up), connections (both
directions, `ConnectionsEditor`), activity (last two, then the rest on request).

`components/ui.tsx` has the shared bits, among them `Popover`, which
keeps a stack of open popovers so one can open inside another (a click in the inner one doesn't close the
outer, Escape closes only the top one).

`lib/model.ts`: sorting, filters (`applyFilters`, `matchesQuery`), `groupsFor` (lanes and which lanes an item is
in), `regroupPatch` / `newItemPatch` (what dragging into a lane, or drawing in it, sets), `colorOf`, `inkOn`,
`pickableInitiatives` (the umbrella picker's list: own team, umbrellas first),
dependency checks (`dependencyInfo`: does the work land before it's needed).

### The timeline (`timeline/`)

`Timeline.tsx` is shared by every timeline view. Each render goes:

1. `pack()` (`geometry.ts`) puts items into lanes and rows.
   - *packed* mode (leadership, alignment, bet): first fit, top to bottom, 8 px between bars.
   - *list* mode (team view): the row each item asks for (`wantedRows`: stored `row`, unplaced ones below),
     clashes move the one being changed (`giveWay`) down.
   - Open umbrellas: lanes are packed as if closed, then `openUp` inserts rows under each open umbrella for its
     parts and pushes the rows below down, so nothing above moves.
   - `compact` (bet view): thin bars, no gap between bars in a row, open parts one per line (`oneEach`), section
     header lanes (`GroupDef.header`).
2. `geometry()` turns rows into pixels (`metricsFor(mode, compact)`), per phase span (`spanGeoms`), with bar
   ends inset in list and compact modes.
3. Rendering: lane backgrounds, grid (`TimelineGrid`), header (`TimelineHeader`: months/quarters over
   sprint/month blocks with code and days, plus impact lines when `outcomes` is set; `topTierH` + `LOWER_TIER_H`), bars (`Block`, memoised: plain props and one
   stable `BlockActions` object, so only the bars whose props change render again), family boxes around open
   umbrellas, dependency arrows (`DependencyLayer`), hover card (`HoverCard`), the left label column (`GroupLabel`, or
   `RowLabel` in compact mode).

Interaction is one pointer state machine (`DragRec`, kinds `move` / `start` / `end` / `create` / `height` /
`pan`): moves snap to sprints, vertical moves change lane (only for groupings `canRegroup` allows) or board row,
`create` is the quick add (draw across sprints, type a name), `height` toggles two-row bars. While dragging, the
preview's item replaces the dragged one in the layout (`withOverride`: only its bars get new geometry, so the
other `Block`s skip rendering on each move), and positions come from the boxes and scroll offsets measured when
the drag began, kept current by autoscroll and a scroll listener, so a move never reads layout from the page.
The ops are dispatched on release. Backlog items are dropped in with HTML5
drag and drop (`ITEM_DRAG_TYPE`). The timeline scrolls itself to today on `todayToken` changes and keeps its
horizontal position across zoom changes. ⌘/Ctrl + wheel zooms at most once per animation frame, and while the
scale changes the root carries `is-zooming`, which turns off the bars' position transitions (they would re-lay
out every bar on every frame); drops and other people's changes still animate.

## Tests (`tests/`)

| File | Covers |
| --- | --- |
| `shared.test.ts` | Sprint calendar, ISO weeks, calendar migrations, upgrading old data, impact maths, quarters, engine (ops, immutability, undo of batches, history coalescing, time travel), demo data |
| `geometry.test.ts` | Team board rows, opening umbrellas in place, compact rows, a dragged bar's geometry |
| `model.test.ts` | What drawing in a lane sets, grouping by umbrella |
| `parts.test.ts` | Umbrellas and parts, roll-up, one-pager and outcome sharing |
| `colors.test.ts` | Board colours, unique umbrella colours, pinning |
| `server.test.ts` | The HTTP API end to end on a temporary database |
| `db.test.ts` | The SQLite store in memory: time travel from the first change per entity, an initiative's activity |
| `history.test.ts` | Merging applied batches into history lists |
