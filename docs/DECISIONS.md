# Product decisions

What the product owner has asked for so far, and why things are the way they are. When a request seems to
conflict with something here, it's fine to change it, but do it on purpose, and mention it in your reply.
Newest areas last within each section. (Built in October 2026; "today" in the example data is around W42.)

## Context

- Built for one company's product organisation: several product teams, the funnel stages their work moves,
  initiatives that span teams, and strategic bets across them. Its real roadmap lives only in its own database;
  the example data in `src/shared/seed.ts` is a generic product company (Growth, Checkout, Platform, Mobile App,
  Data & ML), and examples in these docs come from it.
- The roadmap is the layer above Jira: initiatives and their phases per sprint, not tasks.
- Audiences: leadership (big picture, impact), cross-team syncs (alignment, dependencies), each team (sprint
  planning), and the owners of a strategic bet.

## General style the owner likes

- Compact and calm: little chrome, no redundant labels or counts, icons without button backgrounds where they sit
  on bars, nothing that shifts the layout when something opens or closes.
- Items are named inside their bars (except in the bet view, where names are on the left).
- Things open in place and push what's below down, rather than rearranging the roadmap.
- Per-person view settings (zoom, grouping, open umbrellas…) are remembered in the browser; the roadmap itself is
  shared.
- Colour is used sparingly: where we are is only the red today line (no tinted current sprint, quarter or month),
  and the timeline header takes its cue from the owner's Figma roadmap (see Sprints and calendar).

## Sprints and calendar

- Cadence: 2-week sprint, 2-week sprint, 1-week "Brilliant Basics" (BB), cycles starting Thursdays. Sprints are
  named after the ISO week they start in: BB39 (Sep 24–30), W40 (Oct 1–14), W42 (Oct 15–28), BB44 (Oct 29–Nov 4).
  The anchor is 2026-10-01. Two earlier built-in calendars are migrated automatically (`src/server/migrations.ts`).
- Everything snaps to sprints. A new phase or initiative starts as one sprint.
- The timeline header reads like the Figma roadmap the company used before: one clear month name each (the year
  only on January), and under it each sprint as a soft block of its own with its code and its days centred
  ("W42" over "15–28"; "29–4" across a month's end), in the UI font, no separators or monospace. Blocks are set
  apart by small gaps rather than lines. Narrow blocks drop the days, then the code.
- Brilliant Basics weeks are marked quietly: a faint flat tint down their column and a slightly darker header
  block, no stripes.

## Initiatives and the details drawer

- No per-initiative owner: each team has an EPD trio (PM, EM, UX) set in Settings, who own everything on its
  roadmap.
- Status is implicit in the roadmap. The only flags are **Mark as done** and **Mark at risk**; no "on track"
  label anywhere, no starring.
- Schedule takes two lines: phase chips (Discovery, UX, Implementation), then one sprint-range picker for the
  chosen phase.
- Expected outcomes: funnel stage (the stage *is* the metric, so no separate metric field), impact in % / pp /
  absolute, the month it lands (monthly, not quarterly; default: the month implementation ends), and an optional
  ramp-up (e.g. 50% in July, 85% in August, full from September). No confidence field. Old `metric` and
  `confidence` values are kept in the data but not edited.
- Link button on bars opens the one-pager (or a menu of links) without opening the details. Like the umbrella
  chevron, it's just the icon (and the count), in the bar's text colour: no background or outline.

## Umbrellas and parts

- Leadership reads one initiative ("One-click checkout") where the team plans several pieces (discovery, iterations,
  releases, an app stream). Those pieces are **parts** of an **umbrella**, one level only.
- The umbrella holds the shared title, outcomes, one-pager and strategic bet; its dates are the union of its
  parts'. Rename an umbrella by opening it and editing its title.
- Umbrellas are planned per team, not company-wide. Picking one (**Part of**, or adding existing initiatives to
  an umbrella) is a field you type in to filter, with the list under it: the item's own team only, umbrellas
  that already have parts first (with their colour dot and part count); **Show other teams** adds the rest
  (and is on from the start when the current umbrella belongs to another team).
- Cross-linking: a part shows its umbrella's outcomes and can add its own; the umbrella shows its parts'
  outcomes. Each outcome counts once in impact. The one-pager belongs to the umbrella and is shared by all parts.
- Team view shows parts, named in two lines: the umbrella as a small white tag on top (its name in the umbrella's
  colour after a dot of it), the part's name below. When the part's name already starts with the umbrella's, only
  the dot shows, before the name.
- Leadership and Alignment bars are 1.4 times their first height (42 px, rows 52 px): a name can take two lines,
  or one line over the expected impact. The bet view keeps its thin Gantt bars.
- Leadership and Alignment show the umbrella as one bar. A bare chevron (no count, no background) at the end of
  its bar opens that one umbrella; it stays on its line, its parts appear in new lines under it in a light box,
  and the lines below move down. Display → Expand all / Collapse all opens or closes all of them.

## Views

### Leadership
- Lanes by strategic bet by default; also team, funnel stage, tag, or no grouping at all.
- No quarter-summary row. Instead the timeline header shows each month (zoomed in) or quarter (zoomed out) with
  the impact it is expected to gain per funnel stage, and the sprints (or months) below.
- Bars with expected outcomes name them under the initiative's name, small and quiet: "+3% Bottom funnel · +1 pp
  Retention", added up per stage and unit (whenever they land). An umbrella shows its own and its parts'; a part
  shown under its open umbrella only its own. Bars without outcomes keep one line.
- Viewing an older version (time travel) or comparing with one, expected impact reads "then → now" (older figure
  quieter, today's bold) in the header and on the bars, only where it changed. In time travel too, the right-hand
  side is today's roadmap. The compare banner counts initiatives whose outcomes changed.

### Team view
- A free board: no names column (names are in the bars), rows chosen by the team, several items to a row when
  dates don't clash, two-row bars for long names, drawing new items on any row including empty ones below, a
  small gap between back-to-back items.
- Cards are twice the height they started at (60 px, rows 78 px): room for the umbrella tag over a name that
  wraps to two lines (three without a tag; twice that in a two-row card).
- Every bar is the same colour (the Mist pastel), whatever it is. Umbrellas are told apart by the tags on their
  parts instead: each umbrella gets a colour of its own, unique among umbrellas, picked automatically and kept,
  changeable in the drawer of the umbrella or any part. Initiatives on their own have no colour choice (an older
  per-item colour stays in the data but isn't shown).
- Optional grouping by umbrella (a lane per umbrella; dragging into a lane re-parents), strategic bet, funnel
  stage or tag.
- Sprint overview and Backlog are side panels, closed by default. The backlog lists ideas without dates, with
  quick add, the funnel stage each would move, and drag onto the timeline.

### Strategic bet view
- For bets with **Own view** turned on in Settings (any bet can have one; Conversion in the example data). Its own
  sidebar entry after Team.
- Looks like a classic Gantt: names on the left (umbrella, or the initiative when there's no umbrella), bars
  without names on the right. An umbrella is one bar like in Leadership; the chevron by its name opens it, with
  each part on its own named line underneath. Optional grouping by team or tag, Expand all / Collapse all.

### Impact
- Driver cards: strategic bet as a small note on top, the umbrella (or the initiative) as the title, the exact
  part as a smaller line, the team as a small note at the bottom; the value with "from Dec, full by Feb" right
  under it.
- Viewing or comparing with an older version, cells, totals and driver cards read "then → now" like Leadership;
  driver cards list initiatives that no longer move the cell last, dimmed, at "→ —".

## Naming

- "Tracks" are called **Strategic bets** everywhere in the product (code and data still say `track`).
- "Umbrella" and "part" are the user-facing words for the parent/child initiatives.

## Navigation and search

- Sidebar: an icon rail that opens on hover (or pinned). Order: Search, Leadership, Alignment, Team (with the team
  list), bets with their own view, Impact, History; undo/redo below the views; Settings and the user at the
  bottom. No New initiative button (initiatives are drawn on the timeline; **N** still adds one).
- Search results show the umbrella (as a chip in its colour) and tags; the team; a status only when flagged.

## Offered, not (yet) asked for

- Clicking the umbrella line on a part's bar to open the umbrella.
