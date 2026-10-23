import { quarterOf, toDay } from '../../shared/dates.ts';
import { overallSpan } from '../../shared/sprints.ts';
import { PHASES, type ID, type Item, type PhaseKey, type RoadmapState, type Span } from '../../shared/types.ts';
import type { GroupDef } from '../lib/model.ts';
import type { PhaseMode } from '../store.ts';

export interface Scale {
  start: number;
  end: number;
  px: number;
  width: number;
  x(day: number): number;
  day(x: number): number;
}

export function makeScale(start: number, end: number, px: number): Scale {
  return {
    start,
    end,
    px,
    width: (end - start) * px,
    x: (day) => (day - start) * px,
    day: (x) => start + x / px,
  };
}

/** Days covered by the timeline: everything on the roadmap plus a comfortable margin around today, in whole quarters. */
export function timelineRange(state: RoadmapState, today: number): { start: number; end: number } {
  let min = today - 160;
  let max = today + 460;
  for (const item of Object.values(state.items)) {
    for (const span of Object.values(item.phases)) {
      if (!span) continue;
      min = Math.min(min, toDay(span.start) - 40);
      max = Math.max(max, toDay(span.end) + 60);
    }
  }
  return { start: quarterOf(min).start, end: quarterOf(max).end };
}

export type LayoutMode = 'packed' | 'list';

export interface Metrics {
  rowH: number;
  barTop: number;
  barH: number;
  groupPad: number;
  headerH: number;
  collapsedH: number;
  /** Taken off both ends of a bar, so back-to-back initiatives (one ends the sprint the next starts) don't touch. */
  endInset: number;
  /** A section's header row, when compact rows are grouped (e.g. by team). */
  sectionH: number;
}

/**
 * Every phase mode draws one bar per row; with separate phases, the phases sit side by side in it. Compact rows
 * (a strategic bet's view) are packed lanes of one umbrella each, named in the label column, so bars are thin.
 * The team board's cards are tall enough for an umbrella tag over a name of two lines; packed lanes (Leadership,
 * Alignment) for a name of two lines, or a name over its expected impact.
 */
export function metricsFor(mode: LayoutMode, compact = false): Metrics {
  if (compact) return { rowH: 26, barTop: 4, barH: 18, groupPad: 6, headerH: 0, collapsedH: 38, endInset: 2, sectionH: 32 };
  return mode === 'packed'
    ? { rowH: 52, barTop: 5, barH: 42, groupPad: 10, headerH: 0, collapsedH: 40, endInset: 0, sectionH: 0 }
    : { rowH: 78, barTop: 9, barH: 60, groupPad: 0, headerH: 34, collapsedH: 34, endInset: 3, sectionH: 0 };
}

export type SpanKey = PhaseKey | 'all';

export function visibleSpans(item: Item, phaseMode: PhaseMode): { key: SpanKey; span: Span }[] {
  if (phaseMode === 'combined') {
    const span = overallSpan(item);
    return span ? [{ key: 'all', span }] : [];
  }
  if (phaseMode === 'implementation') {
    return item.phases.implementation ? [{ key: 'implementation', span: item.phases.implementation }] : [];
  }
  return PHASES.filter((p) => item.phases[p]).map((p) => ({ key: p, span: item.phases[p]! }));
}

// ---------------------------------------------------------------------------
// Row assignment (computed from the stored items, so it stays put while dragging)
// ---------------------------------------------------------------------------

export interface Placed {
  item: Item;
  row: number;
  /** A part shown under its expanded umbrella. */
  nested?: boolean;
}

export interface PackedGroup {
  def: GroupDef;
  rows: number;
  items: Placed[];
  /** List mode: the stored row value behind each row shown (grouped lanes close up the gaps between them). */
  rowValues: number[];
}

export interface Packing {
  groups: PackedGroup[];
  /** Items with nothing to draw in this phase mode (e.g. no implementation dates). */
  hidden: Item[];
}

export interface PackOptions {
  /** List mode without grouping: the team's board, where rows are exactly the stored rows (gaps included). */
  board?: boolean;
  /** Placed last in its row, so it's the one that moves down when two initiatives clash (the one being changed). */
  giveWay?: ID | null;
  /** Packed lanes: umbrellas shown open, with the parts to show under them. */
  expand?: Map<ID, Item[]>;
  /** Space kept between bars in a row; by default some air in packed lanes, none in list rows. */
  gap?: number;
  /** An open umbrella's parts each on a line of their own, in date order (compact rows name them on the left). */
  oneEach?: boolean;
}

export const rowsHigh = (item: Item) => (item.tall === true ? 2 : 1);

/**
 * The row each initiative asks for in list mode: its stored row. Ones never placed (older roadmaps, or added
 * without a row) go one per row below the placed ones, in the manual order.
 */
export function wantedRows(items: Item[]): Map<ID, number> {
  const out = new Map<ID, number>();
  let next = 0;
  // Anything but a number (null, or missing on an item from an older version) means not placed yet.
  const placed = (item: Item): item is Item & { row: number } => typeof item.row === 'number' && Number.isFinite(item.row);
  for (const item of items) if (placed(item)) next = Math.max(next, item.row + rowsHigh(item));
  for (const item of items) if (placed(item)) out.set(item.id, item.row);
  const unplaced = items.filter((i) => !placed(i)).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  for (const item of unplaced) out.set(item.id, next++);
  return out;
}

interface Entry {
  item: Item;
  want: number;
  x0: number;
  x1: number;
  h: number;
}

/**
 * First fit from the row each entry asks for, rows top to bottom; a clash moves the later entry down. The entry
 * that gives way goes after all the others, so it takes the next free row instead of pushing anyone else.
 */
function placeRows(entries: Entry[], gap: number, giveWay: ID | null): Placed[] {
  entries.sort(
    (a, b) =>
      Number(a.item.id === giveWay) - Number(b.item.id === giveWay) ||
      a.want - b.want ||
      a.x0 - b.x0 ||
      a.item.order - b.item.order,
  );
  const taken: [number, number][][] = [];
  const free = (row: number, e: Entry) => !(taken[row] ?? []).some(([a, b]) => e.x0 < b + gap && a < e.x1 + gap);
  const fits = (row: number, e: Entry) => {
    for (let r = row; r < row + e.h; r++) if (!free(r, e)) return false;
    return true;
  };
  return entries.flatMap((e) => {
    let row = e.want;
    while (!fits(row, e)) row++;
    for (let r = row; r < row + e.h; r++) (taken[r] ??= []).push([e.x0, e.x1]);
    return { item: e.item, row };
  });
}

const rowsUsed = (placed: Placed[]) => placed.reduce((m, p) => Math.max(m, p.row + rowsHigh(p.item)), 0);

/**
 * Opens umbrellas in place: each keeps its row, new rows right under it hold its parts (packed among
 * themselves), and everything from there down moves down to make room.
 */
function openUp(placed: Placed[], expand: Map<ID, Item[]>, phaseMode: PhaseMode, scale: Scale, oneEach: boolean): Placed[] {
  // A two-row bar can't be split, so the new rows go under it when it straddles the umbrella's bottom edge.
  const straddled = (r: number) => placed.some((p) => p.row < r && r < p.row + rowsHigh(p.item));
  // Row the new rows go in at → the open families there (umbrellas side by side in a row share them).
  const bands = new Map<number, { umbrella: Item; x0: number; x1: number; parts: Placed[] }[]>();
  for (const p of placed) {
    const parts = expand.get(p.item.id)?.filter((q) => visibleSpans(q, phaseMode).length > 0);
    if (!parts?.length) continue;
    let at = p.row + rowsHigh(p.item);
    while (straddled(at)) at++;
    const entries = parts.map((q) => ({ item: q, want: 0, ...extent(q, phaseMode, scale), h: rowsHigh(q) }));
    let next = 0;
    const inner = oneEach ? entries.map((e) => ({ item: e.item, row: (next += e.h) - e.h })) : placeRows(entries, 8, null);
    const family = { umbrella: p.item, x0: Math.min(...entries.map((e) => e.x0)), x1: Math.max(...entries.map((e) => e.x1)), parts: inner };
    bands.set(at, [...(bands.get(at) ?? []), family]);
  }
  if (bands.size === 0) return placed;
  const order = [...bands.keys()].sort((a, b) => a - b);
  const added = new Map<number, number>();
  const nested: Placed[] = [];
  let shift = 0;
  for (const at of order) {
    const families = bands.get(at)!;
    // Families in the same band sit side by side when their parts don't overlap in time, else one under another.
    const spots = new Map(
      placeRows(
        families.map((f) => ({ item: f.umbrella, want: 0, x0: f.x0, x1: f.x1, h: rowsUsed(f.parts) })),
        8,
        null,
      ).map((s) => [s.item.id, s.row]),
    );
    let height = 0;
    for (const f of families) {
      const top = at + shift + spots.get(f.umbrella.id)!;
      for (const q of f.parts) nested.push({ item: q.item, row: top + q.row, nested: true });
      height = Math.max(height, spots.get(f.umbrella.id)! + rowsUsed(f.parts));
    }
    added.set(at, height);
    shift += height;
  }
  const below = (row: number) => order.reduce((sum, at) => (at <= row ? sum + added.get(at)! : sum), 0);
  return [...placed.map((p) => ({ ...p, row: p.row + below(p.row) })), ...nested];
}

function extent(item: Item, phaseMode: PhaseMode, scale: Scale): { x0: number; x1: number } {
  const spans = visibleSpans(item, phaseMode);
  return {
    x0: Math.min(...spans.map((s) => scale.x(toDay(s.span.start)))),
    x1: Math.max(...spans.map((s) => scale.x(toDay(s.span.end)))),
  };
}

export function pack(
  items: Item[],
  groups: GroupDef[],
  groupsOf: (i: Item) => string[],
  mode: LayoutMode,
  phaseMode: PhaseMode,
  scale: Scale,
  opts: PackOptions = {},
): Packing {
  const byGroup = new Map<string, Item[]>(groups.map((g) => [g.id, []]));
  const hidden: Item[] = [];
  const shown: Item[] = [];
  for (const item of items) {
    if (visibleSpans(item, phaseMode).length === 0) {
      hidden.push(item);
      continue;
    }
    shown.push(item);
    for (const g of groupsOf(item)) byGroup.get(g)?.push(item);
  }
  const wanted = mode === 'list' ? wantedRows(shown) : null;
  const out: PackedGroup[] = [];
  for (const def of groups) {
    const list = byGroup.get(def.id) ?? [];
    // Names sit inside the bars, so a row only needs room for the bars themselves.
    const entries: Entry[] = list.map((item) => ({ item, want: 0, ...extent(item, phaseMode, scale), h: rowsHigh(item) }));
    let rowValues: number[] = [];
    if (wanted) {
      // The board keeps its rows as stored; a grouped lane shows only the rows its initiatives use, in order.
      const values = [...new Set(entries.map((e) => wanted.get(e.item.id)!))].sort((a, b) => a - b);
      for (const e of entries) e.want = opts.board ? wanted.get(e.item.id)! : values.indexOf(wanted.get(e.item.id)!);
      rowValues = values;
    }
    // Packed lanes leave a little air between bars; list rows let sprint-to-sprint neighbours touch.
    let placed = placeRows(entries, opts.gap ?? (mode === 'list' ? 0 : 8), opts.giveWay ?? null);
    // Open umbrellas are laid out as if closed first, so opening one never moves anything above it.
    if (mode === 'packed' && opts.expand?.size) placed = openUp(placed, opts.expand, phaseMode, scale, opts.oneEach === true);
    const rows = rowsUsed(placed);
    if (wanted && opts.board) rowValues = Array.from({ length: rows }, (_, r) => r);
    else if (wanted) {
      // Rows pushed past the last used value continue counting from it.
      const last = rowValues.at(-1) ?? -1;
      const used = rowValues.length;
      for (let r = used; r < rows; r++) rowValues.push(last + 1 + r - used);
    }
    out.push({ def, rows, items: placed, rowValues });
  }
  return { groups: out, hidden };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface SpanGeom {
  key: SpanKey;
  span: Span;
  x: number;
  w: number;
  y: number;
  h: number;
}

export interface BlockGeom {
  item: Item;
  groupId: string;
  row: number;
  rowTop: number;
  x: number;
  w: number;
  spans: SpanGeom[];
  /** Where dependencies arrive (start of implementation) and leave (end of implementation). */
  inPoint: { x: number; y: number };
  outPoint: { x: number; y: number };
  /** A part shown under its expanded umbrella. */
  nested: boolean;
}

export interface GroupGeom {
  def: GroupDef;
  y: number;
  h: number;
  collapsed: boolean;
  count: number;
  /** Top of each row. */
  rowTops: number[];
  /** List mode: the stored row value behind each row (see PackedGroup). */
  rowValues: number[];
  items: Item[];
}

export interface Layout {
  groups: GroupGeom[];
  blocks: BlockGeom[];
  byId: Map<ID, BlockGeom>;
  height: number;
  hidden: Item[];
  metrics: Metrics;
}

export function spanGeoms(item: Item, phaseMode: PhaseMode, scale: Scale, m: Metrics, rowTop: number): SpanGeom[] {
  // A two-row bar fills both rows, less the usual margin at its top and bottom.
  const h = m.barH + (rowsHigh(item) - 1) * m.rowH;
  const spans = visibleSpans(item, phaseMode).map(({ key, span }) => {
    const x = scale.x(toDay(span.start));
    const w = Math.max(4, scale.x(toDay(span.end)) - x);
    return { key, span, x, w, y: rowTop + m.barTop, h };
  });
  if (m.endInset > 0 && spans.length > 0) {
    // Only the bar's outer ends move in; phases inside it still meet.
    const first = spans.reduce((a, s) => (s.x < a.x ? s : a));
    const last = spans.reduce((a, s) => (s.x + s.w > a.x + a.w ? s : a));
    const cut = (s: SpanGeom, d: number) => Math.max(0, Math.min(d, (s.w - 4) / 2));
    const left = cut(first, m.endInset);
    first.x += left;
    first.w -= left;
    last.w -= cut(last, m.endInset);
  }
  return spans;
}

/** One initiative's bar in its row, or null when it has nothing to draw in this phase mode. */
function blockGeom(item: Item, groupId: string, row: number, rowTop: number, nested: boolean, phaseMode: PhaseMode, scale: Scale, m: Metrics): BlockGeom | null {
  // Parts under an open umbrella are drawn a little thinner, so the umbrella reads as their heading.
  const spans = spanGeoms(item, phaseMode, scale, m, rowTop).map((sp) => (nested ? { ...sp, y: sp.y + 3, h: sp.h - 6 } : sp));
  if (spans.length === 0) return null;
  const x = Math.min(...spans.map((s) => s.x));
  const w = Math.max(...spans.map((s) => s.x + s.w)) - x;
  // Arrows attach to the edges of the implementation bar (or the whole bar), never its middle.
  const impl = spans.find((s) => s.key === 'implementation') ?? spans.find((s) => s.key === 'all') ?? spans[spans.length - 1];
  const midY = impl.y + impl.h / 2;
  return {
    item,
    groupId,
    row,
    rowTop,
    x,
    w,
    spans,
    inPoint: { x: impl.x, y: midY },
    outPoint: { x: impl.x + impl.w, y: midY },
    nested,
  };
}

export function geometry(
  packing: Packing,
  scale: Scale,
  m: Metrics,
  mode: LayoutMode,
  phaseMode: PhaseMode,
  collapsed: Set<string>,
  showHeaders: boolean,
  overrides: Map<ID, Item> | null,
): Layout {
  const groups: GroupGeom[] = [];
  const blocks: BlockGeom[] = [];
  let y = 0;
  for (const pg of packing.groups) {
    if (pg.def.header) {
      // A section's header (compact rows grouped by team or tag): a named band, no bars.
      groups.push({ def: pg.def, y, h: m.sectionH, collapsed: false, count: 0, rowTops: [], rowValues: [], items: [] });
      y += m.sectionH;
      continue;
    }
    const isCollapsed = collapsed.has(pg.def.id);
    const header = mode === 'list' && showHeaders ? m.headerH : 0;
    // Parts shown under an open umbrella aren't counted again (the umbrella stands for them).
    const items = pg.items.filter((p) => !p.nested).map((p) => p.item);
    if (isCollapsed) {
      groups.push({ def: pg.def, y, h: m.collapsedH, collapsed: true, count: items.length, rowTops: [], rowValues: pg.rowValues, items });
      y += m.collapsedH;
      continue;
    }
    const rows = Math.max(1, pg.rows);
    const top = y + header + m.groupPad;
    const rowTops = Array.from({ length: rows }, (_, r) => top + r * m.rowH);
    for (const { item: stored, row, nested } of pg.items) {
      const b = blockGeom(overrides?.get(stored.id) ?? stored, pg.def.id, row, rowTops[row], nested === true, phaseMode, scale, m);
      if (b) blocks.push(b);
    }
    const h = header + m.groupPad * 2 + rows * m.rowH;
    groups.push({ def: pg.def, y, h, collapsed: false, count: items.length, rowTops, rowValues: pg.rowValues, items });
    y += h;
  }
  // An item can appear in several lanes (e.g. one per tag); lookups by id use its first appearance.
  const byId = new Map<ID, BlockGeom>();
  for (const b of blocks) if (!byId.has(b.item.id)) byId.set(b.item.id, b);
  return { groups, blocks, byId, height: y, hidden: packing.hidden, metrics: m };
}

/**
 * The layout with one initiative drawn as `item` instead, in the rows it already has: a bar being dragged.
 * Every other bar keeps its geometry object, so the bars drawn from them can tell nothing changed and skip
 * rendering again on every pointer move. The same as `geometry` with `item` as an override, only cheaper.
 */
export function withOverride(layout: Layout, item: Item, phaseMode: PhaseMode, scale: Scale): Layout {
  let changed = false;
  const blocks: BlockGeom[] = [];
  for (const b of layout.blocks) {
    if (b.item.id !== item.id || b.item === item) {
      blocks.push(b);
      continue;
    }
    changed = true;
    const next = blockGeom(item, b.groupId, b.row, b.rowTop, b.nested, phaseMode, scale, layout.metrics);
    if (next) blocks.push(next);
  }
  if (!changed) return layout;
  const byId = new Map(layout.byId);
  const first = blocks.find((b) => b.item.id === item.id);
  if (first) byId.set(item.id, first);
  else byId.delete(item.id);
  return { ...layout, blocks, byId };
}
