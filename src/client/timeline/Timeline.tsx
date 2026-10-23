import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Link2 } from 'lucide-react';
import { fmtDay, fmtRange, toDay, todayDay } from '../../shared/dates.ts';
import { calendarFor, deliverySpan, overallSpan, type SprintCalendar } from '../../shared/sprints.ts';
import { boardColorOf } from '../../shared/colors.ts';
import { partLabel, partsOf, umbrellaOf } from '../../shared/parts.ts';
import type { StageFigures } from '../../shared/impact.ts';
import { PHASES, PHASE_LABELS, type ID, type Item, type Op, type PhaseKey, type RoadmapState, type Span } from '../../shared/types.ts';
import { canRegroup, colorOf, inkOn, regroupPatch, type GroupDef } from '../lib/model.ts';
import { closeItem, createItem, dispatch, openItem, updateItem, useApp, type ColorBy, type GroupBy, type PhaseMode } from '../store.ts';
import { Figures, Popover } from '../components/ui.tsx';
import { useMediaQuery } from '../lib/media.ts';
import {
  geometry,
  makeScale,
  metricsFor,
  pack,
  spanGeoms,
  timelineRange,
  wantedRows,
  withOverride,
  type BlockGeom,
  type LayoutMode,
  type Metrics,
  type Scale,
  type SpanKey,
} from './geometry.ts';
import { DependencyLayer, LOWER_TIER_H, HoverCard, TimelineGrid, TimelineHeader, headerImpact, topTierH, type HeaderOutcomes } from './parts.tsx';

/** Drag data for an initiative dragged onto the timeline from elsewhere (the team's backlog). */
export const ITEM_DRAG_TYPE = 'application/x-roadmap-item';

export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 26;
const clampZoom = (px: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, px));

export interface TimelineProps {
  state: RoadmapState;
  items: Item[];
  groups: GroupDef[];
  /** The lanes an item belongs to (usually one; several for tags, metrics and funnel stages). */
  groupsOf: (i: Item) => string[];
  groupBy: GroupBy;
  mode: LayoutMode;
  phaseMode: PhaseMode;
  pxPerDay: number;
  onZoom: (px: number) => void;
  colorBy: ColorBy;
  showDeps: boolean;
  compare: RoadmapState | null;
  readOnly: boolean;
  collapsed: string[];
  onToggleGroup: (id: string) => void;
  /** Fields for an item created by double-clicking a lane. Return null to disallow creating there. */
  newItemDefaults?: (groupId: string) => Partial<Item> | null;
  /** Width of the lane label column (packed mode). List mode has none: names sit in the bars. */
  labelWidth?: number;
  showGroupHeaders?: boolean;
  /** Change this number to scroll to today. */
  todayToken?: number;
  /** Umbrellas shown open, with their parts under them, and how to open or close one (packed views). */
  expanded?: string[];
  onToggleExpand?: (id: ID) => void;
  /** Expected impact to show period by period in the header, above the sprints (Leadership). */
  outcomes?: HeaderOutcomes | null;
  /** What each initiative is expected to move, shown small under its name (Leadership); only those with outcomes. */
  impactLines?: Map<ID, StageFigures[]> | null;
  /** Each bar names its strategic bet in a small tag of the bet's colour (Leadership, under Display). */
  betTags?: boolean;
  /**
   * Compact rows (a strategic bet's view): each lane is one umbrella or initiative, named in the label column,
   * with thin bars and no names in them. Clicking a name opens it.
   */
  compact?: boolean;
  onOpenGroup?: (id: string) => void;
}

type DragKind = 'move' | 'start' | 'end' | 'create' | 'height' | 'pan';

interface DragRec {
  kind: DragKind;
  item: Item | null;
  target: SpanKey;
  groupId: string;
  startX: number;
  startY: number;
  originDay: number;
  scrollLeft: number;
  scrollTop: number;
  /**
   * Measured once when the drag begins: the scroller's box on screen, where the body's top left corner would be
   * with nothing scrolled, and how far it can scroll. With the scroll offsets kept up to date below, a pointer
   * move never has to ask the page where things are; reading a position or a scroll offset right after the last
   * move changed the bars makes the browser lay the page out first.
   */
  view: DOMRect;
  originX: number;
  originY: number;
  maxScroll: { left: number; top: number };
  /** How far the timeline is scrolled now (autoscroll writes it, a scroll listener catches the rest). */
  scrolled: { left: number; top: number };
  active: boolean;
  axis: 'x' | 'y' | null;
  wholeItem: boolean;
  /** Creating: the row the new initiative is drawn in. */
  slot?: Slot;
  /** Moving or resizing a bar: the top of its row when the drag began. */
  rowTop?: number;
  /** A part shown under its open umbrella: it moves in time only, never to another lane. */
  nested?: boolean;
}

/** Where a new initiative goes: its lane, the top of its row, and (list mode) the stored row value. */
interface Slot {
  groupId: string;
  y: number;
  row?: number;
}

/** List mode: the row a bar is dragged to (or a new row inserted at that point, moving the rows below down). */
interface RowTarget {
  groupId: string;
  /** Stored row value. */
  value: number;
  y: number;
  insert: boolean;
}

/** An initiative drawn on the timeline, waiting for its name. */
type Draft = Slot & { span: Span };

interface QuickLink {
  label: string;
  url: string;
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/** The one-pager first (a part's is its umbrella's, shared by all its parts), then the other links that have an address. */
function linksOf(item: Item, umbrella: Item | null): QuickLink[] {
  const out: QuickLink[] = [];
  if (umbrella?.onePagerUrl) out.push({ label: `One-pager · ${umbrella.title}`, url: umbrella.onePagerUrl });
  if (item.onePagerUrl) out.push({ label: umbrella?.onePagerUrl ? 'One-pager (this part)' : 'One-pager', url: item.onePagerUrl });
  for (const l of item.links) if (l.url) out.push({ label: l.label || hostOf(l.url), url: l.url });
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface Preview {
  kind: DragKind;
  itemId: string | null;
  item: Item | null;
  dy: number;
  targetGroup: string | null;
  row: RowTarget | null;
  create: { groupId: string; span: Span; y: number } | null;
  tip: string | null;
  pointer: { x: number; y: number };
}

function shiftPhases(cal: ReturnType<typeof calendarFor>, item: Item, target: SpanKey, n: number): Item['phases'] {
  const phases: Item['phases'] = {};
  for (const p of PHASES) {
    const span = item.phases[p];
    if (!span) continue;
    phases[p] = target === 'all' || target === p ? cal.shiftSpan(span, n) : span;
  }
  return phases;
}

function resizePhases(cal: ReturnType<typeof calendarFor>, item: Item, target: SpanKey, edge: 'start' | 'end', day: number): Item['phases'] {
  let key: PhaseKey | undefined = target === 'all' ? undefined : target;
  if (!key) {
    const present = PHASES.filter((p) => item.phases[p]);
    key =
      edge === 'start'
        ? present.reduce((a, b) => (item.phases[b]!.start < item.phases[a]!.start ? b : a))
        : present.reduce((a, b) => (item.phases[b]!.end > item.phases[a]!.end ? b : a));
  }
  const span = item.phases[key];
  if (!span) return item.phases;
  let [a, b] = cal.spanIndexes(span);
  const boundary = cal.indexOf(cal.nearestBoundary(day));
  if (edge === 'start') a = Math.min(boundary, b - 1);
  else b = Math.max(boundary, a + 1);
  return { ...item.phases, [key]: cal.spanFromIndexes(a, b) };
}

function spanTip(cal: ReturnType<typeof calendarFor>, label: string, span: Span | null): string | null {
  if (!span) return null;
  return `${label} ${cal.spanCode(span)} · ${fmtRange(toDay(span.start), toDay(span.end))}`;
}

export function Timeline(props: TimelineProps) {
  const {
    state,
    items,
    groups,
    groupsOf,
    groupBy,
    mode,
    phaseMode,
    pxPerDay,
    onZoom,
    colorBy,
    showDeps,
    compare,
    readOnly,
    collapsed,
    onToggleGroup,
    newItemDefaults,
    labelWidth: labelWidthProp,
    showGroupHeaders = mode === 'list' && groups.length > 1,
    todayToken,
    expanded,
    onToggleExpand,
    outcomes,
    impactLines,
    betTags = false,
    compact = false,
    onOpenGroup,
  } = props;
  // The team view without grouping is a free board: initiatives sit on the rows they're put on, several to a row.
  const board = mode === 'list' && groupBy === 'none';
  // Packed views can open an umbrella to show its parts under it.
  const expand = useMemo(() => {
    if (mode !== 'packed' || !expanded?.length) return undefined;
    const map = new Map<ID, Item[]>();
    for (const id of expanded) {
      const parts = partsOf(state, id);
      // Compact rows name each part on the left, so none needs two rows for a long name.
      if (parts.length) map.set(id, compact ? parts.map((p) => (p.tall ? { ...p, tall: false } : p)) : parts);
    }
    return map;
  }, [mode, expanded, state, compact]);

  // On phones the label column gives most of its width back to the timeline.
  const narrow = useMediaQuery('(max-width: 600px)');
  const labelWidth = mode === 'list' ? 0 : narrow ? 112 : (labelWidthProp ?? 188);
  const cal = calendarFor(state.settings.sprints);
  const fy = state.settings.fiscalYearStartMonth;
  const today = todayDay();
  const selectedId = useApp((s) => s.route.itemId);

  const range = useMemo(() => timelineRange(state, today), [state, today]);
  const scale = useMemo(() => makeScale(range.start, range.end, pxPerDay), [range.start, range.end, pxPerDay]);
  const metrics = useMemo(() => metricsFor(mode, compact), [mode, compact]);
  const impact = useMemo(() => (outcomes ? headerImpact(scale, fy, outcomes) : null), [outcomes, scale, fy]);
  // The header grows by the lines of impact it shows.
  const headH = topTierH(impact) + LOWER_TIER_H;
  const packing = useMemo(
    // Compact rows let one part follow another in the same row; their ends are inset instead.
    () => pack(items, groups, groupsOf, mode, phaseMode, scale, { board, expand, gap: compact ? 0 : undefined, oneEach: compact }),
    [items, groups, groupsOf, mode, phaseMode, scale, board, expand, compact],
  );
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);

  const layout = useMemo(
    () => geometry(packing, scale, metrics, mode, phaseMode, collapsedSet, showGroupHeaders, null),
    [packing, scale, metrics, mode, phaseMode, collapsedSet, showGroupHeaders],
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  // While a bar is dragged only its own geometry follows the pointer. Every other bar keeps its geometry object,
  // so it doesn't render again on each move; rows, lanes and drop targets are read from `layout`, which stays put.
  const drawn = useMemo(
    () => (preview?.item ? withOverride(layout, preview.item, phaseMode, scale) : layout),
    [layout, preview?.item, phaseMode, scale],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The grid runs to the bottom of the card even when there are only a few rows.
  const [viewH, setViewH] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- scrolling & zoom -------------------------------------------------------------

  const prevScale = useRef<Scale | null>(null);
  const zoomAnchor = useRef<{ day: number; offset: number } | null>(null);
  const pxRef = useRef(pxPerDay);
  const emittedPx = useRef(pxPerDay);
  if (emittedPx.current !== pxPerDay) {
    pxRef.current = pxPerDay;
    emittedPx.current = pxPerDay;
  }

  // While the scale changes, every bar gets a new position and width at once. Animating those makes the browser
  // lay out every bar again on each frame of the transition, on top of the zoom step itself, so the timeline is
  // marked as zooming and the bars jump instead (styles.css). A class set here rather than state, so it costs no
  // extra render; it's cleared a moment after the last step, so drops and other people's changes still glide.
  const zoomEnd = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (zoomEnd.current) clearTimeout(zoomEnd.current);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevScale.current;
    prevScale.current = scale;
    if (prev && prev.px !== scale.px) {
      // Before anything below reads layout: that would start the transitions this is meant to skip.
      el.classList.add('is-zooming');
      if (zoomEnd.current) clearTimeout(zoomEnd.current);
      zoomEnd.current = setTimeout(() => {
        zoomEnd.current = null;
        el.classList.remove('is-zooming');
      }, 200);
    }
    const viewW = el.clientWidth - labelWidth;
    if (!prev) {
      el.scrollLeft = Math.max(0, scale.x(today) - viewW * 0.22);
      return;
    }
    if (prev.px === scale.px && prev.start === scale.start) return;
    const anchor = zoomAnchor.current ?? { day: prev.day(el.scrollLeft + viewW / 2), offset: viewW / 2 };
    zoomAnchor.current = null;
    el.scrollLeft = scale.x(anchor.day) - anchor.offset;
  }, [scale, labelWidth, today]);

  useEffect(() => {
    if (!todayToken) return;
    const el = scrollRef.current;
    const s = prevScale.current;
    if (!el || !s) return;
    el.scrollTo({ left: Math.max(0, s.x(todayDay()) - (el.clientWidth - labelWidth) * 0.22), behavior: 'smooth' });
  }, [todayToken, labelWidth]);

  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A trackpad sends wheel events faster than frames, and each zoom re-renders the whole timeline. The events
    // only add up the zoom; at most once per frame the latest value is passed on, anchored at the latest pointer.
    let frame: number | null = null;
    let pointerX = 0;
    const emit = () => {
      frame = null;
      const s = prevScale.current;
      if (!s) return;
      // Only a change that survives rounding re-renders (and needs the anchor).
      const rounded = Math.round(pxRef.current * 100) / 100;
      if (rounded === emittedPx.current) return;
      const rect = el.getBoundingClientRect();
      const offset = Math.max(0, pointerX - rect.left - labelWidth);
      zoomAnchor.current = { day: s.day(el.scrollLeft + offset), offset };
      emittedPx.current = rounded;
      onZoomRef.current(rounded);
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (!prevScale.current) return;
      // pxRef accumulates small trackpad steps.
      pxRef.current = clampZoom(pxRef.current * Math.exp(-e.deltaY * 0.0022));
      pointerX = e.clientX;
      if (frame === null) frame = requestAnimationFrame(emit);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [labelWidth]);

  // --- hover card --------------------------------------------------------------------

  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  // The umbrella of the part under the pointer: its other parts light up too.
  const [family, setFamily] = useState<ID | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Opening an umbrella rearranges the bars under the pointer, which reads as hovering again: hold the card back a moment.
  const hoverMutedAt = useRef(0);
  const enter = useCallback((id: string, el: HTMLElement) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (Date.now() - hoverMutedAt.current < 1200) return;
    hoverTimer.current = setTimeout(() => setHover({ id, rect: el.getBoundingClientRect() }), 450);
  }, []);
  const leave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(null);
  }, []);

  // --- dragging ------------------------------------------------------------------------

  const dragRef = useRef<DragRec | null>(null);
  const suppressClick = useRef(0);
  const lastPointer = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(null);
  const autoRaf = useRef<number | null>(null);
  const live = useRef({ scale, cal, layout, metrics, groupBy, mode, board, newItemDefaults });
  live.current = { scale, cal, layout, metrics, groupBy, mode, board, newItemDefaults };

  /**
   * List mode: the row at height y. Near a row's top or bottom edge (when allowed) it's a new row inserted there.
   * The board goes on below its last row; a grouped lane offers one more row under its last.
   */
  function rowTargetAt(y: number, onlyGroup: string | null, allowInsert: boolean): RowTarget | null {
    const { layout, metrics, board } = live.current;
    const lanes = layout.groups.filter((g) => !g.collapsed && g.rowTops.length > 0 && (!onlyGroup || g.def.id === onlyGroup));
    if (lanes.length === 0) return null;
    const g = lanes.find((gg) => y < gg.y + gg.h) ?? lanes[lanes.length - 1];
    const top = g.rowTops[0];
    const rows = g.rowTops.length;
    const pos = (y - top) / metrics.rowH;
    let k = Math.max(0, Math.floor(pos));
    if (!board) k = Math.min(k, rows);
    const valueAt = (r: number) => (r < g.rowValues.length ? g.rowValues[r] : (g.rowValues.at(-1) ?? -1) + 1 + r - g.rowValues.length);
    const at = (r: number, insert: boolean): RowTarget => ({ groupId: g.def.id, value: valueAt(r), y: top + r * metrics.rowH, insert });
    if (allowInsert && pos < 0) return at(0, true);
    if (allowInsert && k < rows) {
      const frac = pos - Math.floor(pos);
      if (frac < 0.25) return at(k, true);
      if (frac > 0.75) return at(k + 1, k + 1 < rows);
    }
    return at(k, false);
  }

  const computePreview = useCallback((e: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const d = dragRef.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    const { scale, cal, layout, metrics, mode } = live.current;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (!d.active) {
      if (Math.hypot(dx, dy) < 4) return;
      d.active = true;
      // Up/down moves to another row (list) or lane (packed, when the grouping can be changed by dragging).
      if (d.kind === 'move') d.axis = !d.nested && (mode === 'list' || canRegroup(live.current.groupBy)) ? (Math.abs(dy) > Math.abs(dx) ? 'y' : 'x') : 'x';
      document.body.classList.add('is-dragging', `drag-${d.kind}`, ...(d.axis === 'y' ? ['drag-rows'] : []));
      setHover(null);
    }

    if (d.kind === 'pan') {
      el.scrollLeft = d.scrollLeft - dx;
      el.scrollTop = d.scrollTop - dy;
      return;
    }

    const x = e.clientX - d.originX + d.scrolled.left;
    const y = e.clientY - d.originY + d.scrolled.top;
    const day = scale.day(x);
    const pointer = { x: e.clientX, y: e.clientY };
    const base: Preview = { kind: d.kind, itemId: d.item?.id ?? null, item: null, dy: 0, targetGroup: null, row: null, create: null, tip: null, pointer };

    if (d.kind === 'create') {
      const a = Math.min(cal.indexOf(day), cal.indexOf(d.originDay));
      const b = Math.max(cal.indexOf(day), cal.indexOf(d.originDay)) + 1;
      const span = cal.spanFromIndexes(a, b);
      showPreview({ ...base, create: { groupId: d.groupId, span, y: d.slot?.y ?? 0 }, tip: spanTip(cal, 'New ·', span) });
      return;
    }
    if (!d.item) return;
    const item = d.item;

    if (d.kind === 'height') {
      // Drag the bottom edge down for a two-row bar, up for one row.
      const tall = dy > metrics.rowH * 0.45 ? true : dy < -metrics.rowH * 0.45 ? false : item.tall;
      showPreview({ ...base, item: { ...item, tall }, tip: tall ? 'Two rows high' : 'One row high' });
      return;
    }

    if (d.kind === 'move' && d.axis === 'y') {
      // Follow the pointer in timeline coordinates, so autoscroll doesn't leave the bar behind.
      const follow = dy + (d.scrolled.top - d.scrollTop);
      if (mode === 'list') {
        // The row the bar's (first) row is over; halfway between two rows makes a new row there.
        const { groupBy, board } = live.current;
        const onlyGroup = board || canRegroup(groupBy) ? null : d.groupId;
        const row = rowTargetAt((d.rowTop ?? 0) + follow + metrics.rowH / 2, onlyGroup, true);
        showPreview({ ...base, item, dy: follow, row });
        return;
      }
      const g = layout.groups.find((gg) => y >= gg.y && y < gg.y + gg.h);
      showPreview({ ...base, item, dy: follow, targetGroup: g && g.def.id !== d.groupId ? g.def.id : null });
      return;
    }

    const target: SpanKey = d.wholeItem || e.shiftKey ? 'all' : d.target;
    let phases: Item['phases'];
    if (d.kind === 'move') phases = shiftPhases(cal, item, target, cal.indexOf(day) - cal.indexOf(d.originDay));
    else phases = resizePhases(cal, item, target, d.kind, day);
    const next = { ...item, phases };
    const tipSpan = target === 'all' ? overallSpan(next) : next.phases[target];
    const tipLabel = target === 'all' ? (phaseMode === 'combined' ? '' : 'All phases ·') : `${PHASE_LABELS[target]} ·`;
    showPreview({ ...base, item: next, tip: spanTip(cal, tipLabel, tipSpan ?? null) });
  }, [phaseMode]);

  const stopAutoScroll = () => {
    if (autoRaf.current !== null) cancelAnimationFrame(autoRaf.current);
    autoRaf.current = null;
  };

  const autoScroll = useCallback(() => {
    const el = scrollRef.current;
    const p = lastPointer.current;
    const d = dragRef.current;
    if (!el || !p || !d?.active || d.kind === 'pan') {
      stopAutoScroll();
      return;
    }
    const r = d.view;
    const edge = 48;
    let vx = 0;
    let vy = 0;
    if (p.clientX < r.left + labelWidth + edge) vx = -Math.ceil((r.left + labelWidth + edge - p.clientX) / 4);
    else if (p.clientX > r.right - edge) vx = Math.ceil((p.clientX - (r.right - edge)) / 4);
    if (p.clientY < r.top + headH + edge / 2) vy = -Math.ceil((r.top + headH + edge / 2 - p.clientY) / 4);
    else if (p.clientY > r.bottom - edge / 2) vy = Math.ceil((p.clientY - (r.bottom - edge / 2)) / 4);
    if (d.kind === 'start' || d.kind === 'end' || d.kind === 'create') vy = 0;
    if (d.kind === 'height' || (d.kind === 'move' && d.axis === 'y' && live.current.mode === 'list')) vx = 0;
    if (vx === 0 && vy === 0) {
      stopAutoScroll();
      return;
    }
    const left = Math.min(d.maxScroll.left, Math.max(0, d.scrolled.left + vx));
    const top = Math.min(d.maxScroll.top, Math.max(0, d.scrolled.top + vy));
    if (left !== d.scrolled.left) el.scrollLeft = left;
    if (top !== d.scrolled.top) el.scrollTop = top;
    d.scrolled = { left, top };
    computePreview(p);
    autoRaf.current = requestAnimationFrame(autoScroll);
  }, [computePreview, labelWidth, headH]);

  const previewRef = useRef<Preview | null>(null);
  const showPreview = (p: Preview | null) => {
    previewRef.current = p;
    setPreview(p);
  };

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onUpRef = useRef<() => void>(() => {});
  const onCancelRef = useRef<() => void>(() => {});
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  // Stable wrappers, so the exact listeners that were added can be removed.
  const handlers = useMemo(
    () => ({
      move: (e: PointerEvent) => onMoveRef.current(e),
      up: () => onUpRef.current(),
      cancel: () => onCancelRef.current(),
      key: (e: KeyboardEvent) => onKeyRef.current(e),
    }),
    [],
  );

  const commitRef = useRef<(d: DragRec, p: Preview | null) => void>(() => {});
  commitRef.current = commitDrag;

  const finish = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      const p = previewRef.current;
      dragRef.current = null;
      stopAutoScroll();
      document.body.classList.remove('is-dragging', 'drag-move', 'drag-start', 'drag-end', 'drag-create', 'drag-height', 'drag-pan', 'drag-rows');
      window.removeEventListener('pointermove', handlers.move);
      window.removeEventListener('pointerup', handlers.up);
      window.removeEventListener('pointercancel', handlers.cancel);
      window.removeEventListener('keydown', handlers.key, true);
      showPreview(null);
      if (d?.active) {
        suppressClick.current = Date.now();
        if (commit) commitRef.current(d, p);
      } else if (commit && (d?.kind === 'pan' || d?.kind === 'create')) closeItem();
    },
    [handlers],
  );
  useEffect(() => () => finish(false), [finish]);

  // Scrolling during a drag (the wheel, or autoscroll settling on a rounded offset) moves the body under the
  // pointer: keep the drag's record of it current. Runs at most once a frame, and only while something scrolls.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const d = dragRef.current;
      if (d) d.scrolled = { left: el.scrollLeft, top: el.scrollTop };
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  onMoveRef.current = (e: PointerEvent) => {
    lastPointer.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    computePreview(lastPointer.current);
    if (dragRef.current?.active && autoRaf.current === null) autoRaf.current = requestAnimationFrame(autoScroll);
  };
  onUpRef.current = () => finish(true);
  onCancelRef.current = () => finish(false);
  onKeyRef.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish(false);
    }
  };

  // --- rows (list mode) -------------------------------------------------------------------

  const shownItems = () => {
    const hidden = new Set(layout.hidden.map((i) => i.id));
    return items.filter((i) => !hidden.has(i.id));
  };

  /** Every shown initiative's row as it is now: on the board, where it's drawn; in grouped lanes, the row it asks for. */
  function currentRows(): Map<ID, number> {
    if (!board) return wantedRows(shownItems());
    return new Map(packing.groups.flatMap((g) => g.items.map((p): [ID, number] => [p.item.id, p.row])));
  }

  /** The board after a change: rows as drawn once `rows` and `change` apply, with `giveWay` moving down on a clash. */
  function settle(rows: Map<ID, number>, giveWay: ID | null, change: (item: Item) => Item = (i) => i, extra: Item[] = []): Map<ID, number> {
    const added = new Set(extra.map((i) => i.id));
    const list = [...shownItems().filter((it) => !added.has(it.id)).map((it) => ({ ...change(it), row: rows.get(it.id) ?? it.row })), ...extra];
    const settled = pack(list, groups, groupsOf, 'list', phaseMode, scale, { board: true, giveWay });
    return new Map(settled.groups.flatMap((g) => g.items.map((p): [ID, number] => [p.item.id, p.row])));
  }

  /** Writes rows that differ from what's stored (the first change on a board also pins every row), plus any patches. */
  function rowOps(rows: Map<ID, number>, patches: Record<ID, Partial<Item>> = {}): Op[] {
    const ops: Op[] = [];
    const ids = new Set([...rows.keys(), ...Object.keys(patches)]);
    for (const id of ids) {
      const stored = state.items[id];
      if (!stored) continue;
      const patch: Partial<Item> = { ...patches[id] };
      const row = rows.get(id);
      if (row !== undefined && stored.row !== row) patch.row = row;
      if (Object.keys(patch).length) ops.push({ kind: 'update', entity: 'item', id, patch });
    }
    return ops;
  }

  function moveToRow(item: Item, fromGroup: string, t: RowTarget) {
    const rows = currentRows();
    const from = rows.get(item.id);
    if (t.insert) for (const [id, r] of rows) if (id !== item.id && r >= t.value) rows.set(id, r + 1);
    rows.set(item.id, t.value);
    // A row the bar leaves empty closes up (rows left empty on purpose stay).
    const left = from === undefined ? undefined : t.insert && from >= t.value ? from + 1 : from;
    const occupied = (row: number) => [...rows].some(([id, r]) => r === row || (r === row - 1 && state.items[id]?.tall));
    if (left !== undefined && !occupied(left)) for (const [id, r] of rows) if (r > left) rows.set(id, r - 1);
    const patch: Partial<Item> = {};
    if (!board && t.groupId !== fromGroup) Object.assign(patch, regroupPatch(groupBy, t.groupId, groups) ?? {});
    const ops = rowOps(board ? settle(rows, item.id) : rows, { [item.id]: patch });
    if (ops.length) dispatch(ops, `Moved “${item.title}”${t.insert ? ' to a new row' : ' to another row'}`);
  }

  function commitDrag(d: DragRec, p: Preview | null) {
    const { cal, groupBy, newItemDefaults } = live.current;
    if (!p) return;
    if (d.kind === 'create' && p.create) {
      // The new bar stays where it was drawn and asks for a name; nothing is added until it has one.
      if (d.slot && newItemDefaults?.(p.create.groupId)) setDraft(placeDraft({ ...d.slot, span: p.create.span }));
      return;
    }
    const item = d.item;
    if (!item) return;
    if (d.kind === 'height') {
      if (!p.item || p.item.tall === item.tall) return;
      const tall = p.item.tall;
      // On the board a taller bar keeps its place and the rows under it make room.
      const ops = board
        ? rowOps(settle(currentRows(), null, (it) => (it.id === item.id ? { ...it, tall } : it)), { [item.id]: { tall } })
        : [{ kind: 'update', entity: 'item', id: item.id, patch: { tall } } as Op];
      dispatch(ops, tall ? `Made “${item.title}” two rows high` : `Made “${item.title}” one row high`);
      return;
    }
    if (d.kind === 'move' && d.axis === 'y' && live.current.mode === 'list') {
      if (p.row) moveToRow(item, d.groupId, p.row);
      return;
    }
    if (d.kind === 'move' && d.axis === 'y') {
      if (!p.targetGroup) return;
      const patch = regroupPatch(groupBy, p.targetGroup, live.current.layout.groups.map((gg) => gg.def));
      if (!patch) return;
      const target = live.current.layout.groups.find((g) => g.def.id === p.targetGroup);
      updateItem(item.id, patch, `Moved “${item.title}” to ${target?.def.label ?? 'another lane'}`, { undoToast: true });
      return;
    }
    const parts = partsOf(state, item.id);
    if (p.item && parts.length) {
      // An umbrella's dates are its parts': moving it moves every part by the same number of sprints.
      const from = overallSpan(item);
      const to = overallSpan(p.item);
      const n = from && to ? cal.indexOf(toDay(to.start)) - cal.indexOf(toDay(from.start)) : 0;
      if (n === 0) return;
      const ops: Op[] = parts
        .filter((part) => Object.keys(part.phases).length)
        .map((part) => ({ kind: 'update', entity: 'item', id: part.id, patch: { phases: shiftPhases(cal, part, 'all', n) } }));
      dispatch(ops, `“${item.title}” and its ${parts.length} parts → ${cal.spanCode(to!)}`, { undoToast: true });
      return;
    }
    if (p.item && JSON.stringify(p.item.phases) !== JSON.stringify(item.phases)) {
      const span = deliverySpan(p.item);
      const phases = p.item.phases;
      // On the board, new dates that clash with a neighbour move the bar down a row (and it stays there).
      const ops = board
        ? rowOps(settle(currentRows(), item.id, (it) => (it.id === item.id ? { ...it, phases } : it)), { [item.id]: { phases } })
        : [{ kind: 'update', entity: 'item', id: item.id, patch: { phases } } as Op];
      dispatch(ops, `“${item.title}” → ${span ? cal.spanCode(span) : 'rescheduled'}`, { undoToast: true });
    }
  }

  function begin(e: React.PointerEvent, rec: BeginRec) {
    if (e.button !== 0) return;
    if (readOnly && rec.kind !== 'pan') return;
    // On touch screens the browser scrolls natively; only mice pan by dragging.
    if (rec.kind === 'pan' && e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    const body = bodyRef.current;
    if (!el || !body || dragRef.current) return;
    e.stopPropagation();
    if (rec.kind !== 'pan') e.preventDefault();
    // preventDefault keeps focus where it is, so settle a half-typed quick add (adds it if named) before the next drag.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.tl-quick')) active.blur();
    const bodyRect = body.getBoundingClientRect();
    dragRef.current = {
      ...rec,
      startX: e.clientX,
      startY: e.clientY,
      originDay: live.current.scale.day(e.clientX - bodyRect.left),
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      view: el.getBoundingClientRect(),
      originX: bodyRect.left + el.scrollLeft,
      originY: bodyRect.top + el.scrollTop,
      maxScroll: { left: el.scrollWidth - el.clientWidth, top: el.scrollHeight - el.clientHeight },
      scrolled: { left: el.scrollLeft, top: el.scrollTop },
      active: false,
      axis: null,
    };
    window.addEventListener('pointermove', handlers.move);
    window.addEventListener('pointerup', handlers.up);
    window.addEventListener('pointercancel', handlers.cancel);
    window.addEventListener('keydown', handlers.key, true);
  }

  /** A click on a bar opens its details; on an umbrella that can open in place, it shows or hides its parts. */
  const clickItem = (id: string, expand: boolean) => {
    if (Date.now() - suppressClick.current < 250) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(null);
    if (expand) {
      hoverMutedAt.current = Date.now();
      onToggleExpand?.(id);
    } else openItem(id);
  };

  // --- quick add ---------------------------------------------------------------------------

  const [draft, setDraft] = useState<Draft | null>(null);

  /** The row under the pointer: in list mode any row, including the empty ones below; packed lanes fill themselves. */
  function slotAt(groupId: string, clientY: number, tail: boolean): Slot {
    const { layout, metrics, mode } = live.current;
    const y = bodyRef.current ? clientY - bodyRef.current.getBoundingClientRect().top : 0;
    if (mode === 'list') {
      const t = rowTargetAt(y, groupId, false);
      if (t) return { groupId, y: t.y, row: t.value };
    }
    if (tail) return { groupId, y: layout.height };
    const g = layout.groups.find((gg) => gg.def.id === groupId);
    if (!g || g.rowTops.length === 0) return { groupId, y: g?.y ?? 0 };
    const idx = Math.max(0, Math.min(g.rowTops.length - 1, Math.floor((y - g.rowTops[0]) / metrics.rowH)));
    return { groupId, y: g.rowTops[idx] };
  }

  const NEW_ID = '__new';
  const draftItem = (d: Draft): Item =>
    ({ id: NEW_ID, title: '', phases: { implementation: d.span }, row: d.row ?? null, tall: false, order: Number.MAX_SAFE_INTEGER }) as Item;

  /** On the board, a new bar drawn over a neighbour lands on the next free row: show the name field there. */
  function placeDraft(d: Draft): Draft {
    if (!board || d.row === undefined) return d;
    const row = settle(currentRows(), NEW_ID, undefined, [draftItem(d)]).get(NEW_ID) ?? d.row;
    const top = (layout.groups[0]?.rowTops[0] ?? 0) + row * metrics.rowH;
    return { ...d, row, y: top };
  }

  const canCreate = (groupId: string) => !readOnly && !!newItemDefaults?.(groupId);

  const onBackgroundDown = (e: React.PointerEvent, groupId: string, tail = false) => {
    // Drawing on an empty part of a lane adds an initiative there. ⌥/Alt + drag scrolls instead; touch scrolls natively.
    if (e.pointerType === 'mouse' && !e.altKey && canCreate(groupId)) {
      begin(e, { kind: 'create', item: null, target: 'implementation', groupId, wholeItem: false, slot: slotAt(groupId, e.clientY, tail) });
    } else begin(e, { kind: 'pan', item: null, target: 'all', groupId, wholeItem: false });
  };

  const onBackgroundDoubleClick = (e: React.MouseEvent, groupId: string, tail = false) => {
    if (!canCreate(groupId) || !bodyRef.current) return;
    const idx = cal.indexOf(scale.day(e.clientX - bodyRef.current.getBoundingClientRect().left));
    setDraft(placeDraft({ ...slotAt(groupId, e.clientY, tail), span: cal.spanFromIndexes(idx, idx + 1) }));
  };

  const submitDraft = (title: string, open: boolean) => {
    const d = draft;
    setDraft(null);
    const defaults = d && title.trim() ? newItemDefaults?.(d.groupId) : null;
    if (!d || !defaults) return;
    // On the board, the first change also pins every row, so nothing else moves when the new one arrives.
    let row = d.row;
    let extraOps: Op[] = [];
    if (board && row !== undefined) {
      const rows = settle(currentRows(), NEW_ID, undefined, [draftItem(d)]);
      row = rows.get(NEW_ID) ?? row;
      rows.delete(NEW_ID);
      extraOps = rowOps(rows);
    }
    const id = createItem(
      { ...defaults, title: title.trim(), phases: { implementation: d.span }, ...(row === undefined ? {} : { row }) },
      { open: false, extraOps },
    );
    if (id && open) openItem(id);
  };

  // --- dropping an initiative from outside (the backlog) ----------------------------------------

  const [dropAt, setDropAt] = useState<{ x: number; w: number; y: number } | null>(null);

  /** The sprint and row under the pointer, if an initiative can land there. */
  function dropTarget(e: React.DragEvent): { groupId: string; span: Span; slot: Slot } | null {
    const body = bodyRef.current;
    if (readOnly || !body) return null;
    const rect = body.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const g = layout.groups.find((gg) => !gg.collapsed && y >= gg.y && y < gg.y + gg.h) ?? (board ? layout.groups[0] : undefined);
    if (!g || !canCreate(g.def.id)) return null;
    const idx = cal.indexOf(scale.day(e.clientX - rect.left));
    return { groupId: g.def.id, span: cal.spanFromIndexes(idx, idx + 1), slot: slotAt(g.def.id, e.clientY, y >= layout.height) };
  }

  /** Puts an unscheduled initiative on the timeline: one sprint, in the row it was dropped on. */
  function scheduleAt(id: ID, t: { groupId: string; span: Span; slot: Slot }) {
    const item = state.items[id];
    if (!item) return;
    const phases: Item['phases'] = { implementation: t.span };
    let ops: Op[];
    if (board && t.slot.row !== undefined) {
      const rows = settle(currentRows(), id, undefined, [{ ...item, phases, row: t.slot.row }]);
      ops = rowOps(rows, { [id]: { phases } });
    } else {
      const patch: Partial<Item> = { phases };
      if (mode === 'list' && t.slot.row !== undefined) patch.row = t.slot.row;
      if (canRegroup(groupBy)) Object.assign(patch, regroupPatch(groupBy, t.groupId, groups) ?? {});
      ops = [{ kind: 'update', entity: 'item', id, patch }];
    }
    dispatch(ops, `Scheduled “${item.title}” in ${cal.spanCode(t.span)}`, { undoToast: true });
  }

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return;
      const t = dropTarget(e);
      if (!t) return setDropAt(null);
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const x = scale.x(toDay(t.span.start));
      setDropAt({ x, w: scale.x(toDay(t.span.end)) - x, y: t.slot.y });
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(ITEM_DRAG_TYPE);
      const t = dropTarget(e);
      setDropAt(null);
      if (!id || !t) return;
      e.preventDefault();
      scheduleAt(id, t);
    },
  };

  // --- links ---------------------------------------------------------------------------------

  const [linkMenu, setLinkMenu] = useState<{ itemId: string; anchor: HTMLElement } | null>(null);
  const menuItem = linkMenu ? state.items[linkMenu.itemId] : undefined;
  const menuLinks = menuItem ? linksOf(menuItem, umbrellaOf(state, menuItem)) : [];

  // --- render ---------------------------------------------------------------------------

  // Arrows are hidden unless turned on; the opened initiative always shows its own.
  const focusId = selectedId;
  const currentSprint = cal.at(today);
  const draggingId = preview?.itemId ?? null;

  // One object for the timeline's lifetime, so the bars never render again because of it; each call goes to
  // whatever the latest render defined.
  const beginRef = useRef(begin);
  beginRef.current = begin;
  const clickRef = useRef(clickItem);
  clickRef.current = clickItem;
  const toggleExpandRef = useRef(onToggleExpand);
  toggleExpandRef.current = onToggleExpand;
  const blockActions = useMemo<BlockActions>(
    () => ({
      begin: (e, rec) => beginRef.current(e, rec),
      click: (id, expand) => clickRef.current(id, expand),
      enter: (id, el, umbrellaId) => {
        if (dragRef.current) return;
        enter(id, el);
        setFamily(umbrellaId);
      },
      leave: () => {
        leave();
        setFamily(null);
      },
      toggleExpand: (id) => {
        // The hover card would cover the parts that just appeared.
        hoverMutedAt.current = Date.now();
        leave();
        toggleExpandRef.current?.(id);
      },
      linkMenu: (itemId, anchor) => setLinkMenu({ itemId, anchor }),
    }),
    [enter, leave],
  );
  // An umbrella's bar has a button that opens it, in packed views that let umbrellas open (compact rows open
  // theirs from the name on the left).
  const expandable = !!onToggleExpand && mode === 'packed' && !compact;

  const hoverItem = hover && !preview ? (state.items[hover.id] ?? null) : null;
  const showCreateHint = !readOnly && !!newItemDefaults;
  // With a single lane, the space under the last row is room to draw new initiatives (at least two rows of it).
  const only = layout.groups.length === 1 ? layout.groups[0] : null;
  const tailGroup = only && !only.collapsed && canCreate(only.def.id) ? only.def.id : null;
  const bodyH = Math.max(layout.height + (tailGroup ? metrics.rowH * 2 : 0), Math.floor(viewH - headH));
  const hiddenNote =
    layout.hidden.length > 0 && phaseMode !== 'separate'
      ? `${layout.hidden.length} without ${phaseMode === 'implementation' ? 'implementation dates' : 'dates'}`
      : null;
  const hiddenTitles = layout.hidden.map((i) => i.title).join('\n');

  const miniBars = (g: GroupGeom, top: number) =>
    g.items.map((item) => {
      const span = overallSpan(item);
      if (!span) return null;
      const x = scale.x(toDay(span.start));
      return (
        <div
          key={`c-${item.id}`}
          className="tl-mini"
          style={{ left: x, width: scale.x(toDay(span.end)) - x, top, '--c': colorOf(item, state, colorBy) } as CSSProperties}
          title={item.title}
        />
      );
    });

  return (
    <div className={`tl${readOnly ? ' is-readonly' : ''}${compact ? ' is-compact' : ''} mode-${mode} pm-${phaseMode} cb-${colorBy}`} ref={scrollRef} style={{ '--label-w': `${labelWidth}px` } as CSSProperties}>
      <div className="tl-inner" style={{ width: labelWidth + scale.width }}>
        <div
          className="tl-head"
          style={{ height: headH }}
          onPointerDown={(e) => begin(e, { kind: 'pan', item: null, target: 'all', groupId: '', wholeItem: false })}
        >
          {labelWidth > 0 && (
            <div className={`tl-corner${impact?.lines ? ' with-impact' : ''}`} style={{ width: labelWidth }}>
              {impact?.lines ? (
                <div className="tl-impact-caption" title="What each period is expected to gain from the initiatives shown, by funnel stage (ramp-ups spread month by month)">
                  Expected impact
                </div>
              ) : null}
              <div className="tl-now">
                <span className="tl-now-label">Now</span>
                <span className="mono">{currentSprint.code}</span>
                <span className="tl-now-dates">until {fmtDay(currentSprint.end - 1)}</span>
              </div>
              {phaseMode === 'separate' && (
                <div className="tl-legend" aria-hidden="true">
                  <span title="Discovery">
                    <span className="phase-swatch discovery" /> Disc
                  </span>
                  <span title="UX">
                    <span className="phase-swatch ux" /> UX
                  </span>
                  <span title="Implementation">
                    <span className="phase-swatch implementation" /> Impl
                  </span>
                </div>
              )}
              {hiddenNote && (
                <div className="tl-hidden" title={hiddenTitles}>
                  {hiddenNote}
                </div>
              )}
            </div>
          )}
          <TimelineHeader scale={scale} cal={cal} fy={fy} impact={impact} />
        </div>

        <div className="tl-main">
          {labelWidth > 0 && (
            <div className="tl-labels" style={{ width: labelWidth, height: bodyH }}>
              {layout.groups.map((g) => (
                compact ? (
                  <RowLabel
                    key={g.def.id}
                    g={g}
                    m={metrics}
                    parts={layout.blocks.filter((b) => b.nested && b.groupId === g.def.id)}
                    onOpen={onOpenGroup}
                    expandable={!!onToggleExpand && !!g.def.itemId && partsOf(state, g.def.itemId).length > 0}
                    open={!!g.def.itemId && !!expand?.has(g.def.itemId)}
                    onToggleExpand={onToggleExpand}
                  />
                ) : (
                  <GroupLabel key={g.def.id} g={g} onToggle={onToggleGroup} />
                )
              ))}
            </div>
          )}

          <div className="tl-body" ref={bodyRef} style={{ width: scale.width, height: bodyH }} {...dropHandlers}>
            <TimelineGrid scale={scale} cal={cal} fy={fy} today={today} height={bodyH} />
            {layout.groups.map((g) => (
              <div
                key={g.def.id}
                className={`tl-gbg${preview?.targetGroup === g.def.id ? ' is-target' : ''}${g.count === 0 ? ' is-empty' : ''}${g.def.header ? ' is-section' : ''}${canCreate(g.def.id) ? ' can-create' : ''}`}
                style={{ top: g.y, height: g.h }}
                onPointerDown={(e) => onBackgroundDown(e, g.def.id)}
                onDoubleClick={(e) => onBackgroundDoubleClick(e, g.def.id)}
              >
                {g.count === 0 && showCreateHint && !g.collapsed && newItemDefaults?.(g.def.id) && (
                  <span className="tl-empty-hint" style={{ left: scale.x(today) + 12 }}>
                    Drag across the sprints to add an initiative
                  </span>
                )}
              </div>
            ))}
            {bodyH > layout.height &&
              (tailGroup ? (
                <div
                  className="tl-gbg tl-tail can-create"
                  style={{ top: layout.height, height: bodyH - layout.height }}
                  onPointerDown={(e) => onBackgroundDown(e, tailGroup, true)}
                  onDoubleClick={(e) => onBackgroundDoubleClick(e, tailGroup, true)}
                >
                  <span className="tl-empty-hint" style={{ left: scale.x(today) + 12, top: Math.min(60, (bodyH - layout.height) / 2) }}>
                    Drag across the sprints to add an initiative
                  </span>
                </div>
              ) : (
                // Below the last of several lanes: nothing to add to, so dragging scrolls.
                <div
                  className="tl-gbg tl-tail"
                  style={{ top: layout.height, height: bodyH - layout.height }}
                  onPointerDown={(e) => begin(e, { kind: 'pan', item: null, target: 'all', groupId: '', wholeItem: false })}
                />
              ))}
            {mode === 'list' &&
              layout.groups.flatMap((g) =>
                g.rowTops.map((top, i) => <div key={`${g.def.id}-r${i}`} className="tl-rowline" style={{ top: top + metrics.rowH - 1 }} />),
              )}
            {board &&
              // The open rows below the board: lines to draw new initiatives on, or drag ones to.
              Array.from({ length: Math.max(0, Math.floor((bodyH - layout.height) / metrics.rowH)) }, (_, i) => (
                <div key={`open-r${i}`} className="tl-rowline is-open" style={{ top: layout.height + (i + 1) * metrics.rowH - 1 }} />
              ))}
            {mode === 'packed' && layout.groups.filter((g) => g.collapsed).flatMap((g) => miniBars(g, g.y + g.h / 2 - 4))}
            {mode === 'list' &&
              showGroupHeaders &&
              layout.groups.map((g) => (
                // With no label column, a group's header is a band across the timeline; a collapsed group shows its bars in it.
                <div key={`band-${g.def.id}`} className="tl-gband" style={{ top: g.y, height: metrics.headerH }}>
                  <GroupHeader g={g} onToggle={onToggleGroup} />
                  {g.collapsed && miniBars(g, (metrics.headerH - 8) / 2)}
                </div>
              ))}
            {(showDeps || focusId) && <DependencyLayer layout={drawn} state={state} width={scale.width} focusId={focusId} showAll={showDeps} />}
            {expand &&
              // An open umbrella and its parts share a light backdrop, so they read as one initiative.
              drawn.blocks
                .filter((b) => !b.nested && expand.has(b.item.id))
                .map((b) => {
                  const kids = drawn.blocks.filter((k) => k.nested && k.groupId === b.groupId && k.item.parentId === b.item.id);
                  if (!kids.length) return null;
                  const left = Math.min(b.x, ...kids.map((k) => k.x)) - 6;
                  const right = Math.max(b.x + b.w, ...kids.map((k) => k.x + k.w)) + 6;
                  const bottom = Math.max(...kids.map((k) => k.spans[0].y + k.spans[0].h)) + 6;
                  return (
                    <div
                      key={`box-${b.groupId}:${b.item.id}`}
                      className="tl-family-box"
                      style={{ left, top: b.spans[0].y - 4, width: right - left, height: bottom - b.spans[0].y + 4, '--c': colorOf(b.item, state, colorBy) } as CSSProperties}
                    />
                  );
                })}
            {drawn.blocks.map((b) => {
              const dragging = draggingId === b.item.id;
              return (
                <Block
                  key={`${b.groupId}:${b.item.id}`}
                  b={b}
                  state={state}
                  cal={cal}
                  scale={scale}
                  metrics={metrics}
                  colorBy={colorBy}
                  phaseMode={phaseMode}
                  groupBy={groupBy}
                  compact={compact}
                  readOnly={readOnly}
                  compare={compare}
                  expandable={expandable}
                  selected={selectedId === b.item.id}
                  dragging={dragging}
                  dy={dragging ? (preview?.dy ?? 0) : 0}
                  family={family !== null && umbrellaOf(state, b.item)?.id === family}
                  open={!!expand?.has(b.item.id)}
                  impactLine={impactLines?.get(b.item.id)}
                  betTags={betTags}
                  actions={blockActions}
                />
              );
            })}
            {preview?.create && (
              <div
                className="tl-create-ghost"
                style={{
                  left: scale.x(toDay(preview.create.span.start)),
                  width: scale.x(toDay(preview.create.span.end)) - scale.x(toDay(preview.create.span.start)),
                  top: preview.create.y + metrics.barTop,
                  height: metrics.barH,
                }}
              />
            )}
            {dropAt && <div className="tl-create-ghost is-drop" style={{ left: dropAt.x, width: dropAt.w, top: dropAt.y + metrics.barTop, height: metrics.barH }} />}
            {preview?.row &&
              (preview.row.insert ? (
                <div className="tl-insert" style={{ top: preview.row.y }} />
              ) : (
                <div className="tl-rowtarget" style={{ top: preview.row.y, height: metrics.rowH }} />
              ))}
            {draft && (
              <QuickAdd
                key={`${draft.groupId}:${draft.y}:${draft.span.start}:${draft.span.end}`}
                x={scale.x(toDay(draft.span.start))}
                w={scale.x(toDay(draft.span.end)) - scale.x(toDay(draft.span.start))}
                top={draft.y + metrics.barTop}
                height={metrics.barH}
                when={(spanTip(cal, '', draft.span) ?? '').trim()}
                onDone={submitDraft}
              />
            )}
            {labelWidth === 0 && hiddenNote && (
              <div className="tl-foot" style={{ top: layout.height }}>
                <span className="tl-hidden" title={hiddenTitles}>
                  {hiddenNote}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      {preview?.tip && (
        <div className="drag-tip" style={{ left: preview.pointer.x + 14, top: preview.pointer.y + 18 }}>
          {preview.tip}
        </div>
      )}
      {preview?.targetGroup && (
        <div className="drag-tip" style={{ left: preview.pointer.x + 14, top: preview.pointer.y + 18 }}>
          Move to {layout.groups.find((g) => g.def.id === preview.targetGroup)?.def.label}
        </div>
      )}
      {hoverItem && hover && (
        <HoverCard
          item={hoverItem}
          state={state}
          cal={cal}
          rect={hover.rect}
          hint={
            expandable && partsOf(state, hoverItem.id).length > 0
              ? `Click to ${expand?.has(hoverItem.id) ? 'hide' : 'show'} its parts · ${MOD}-click for details`
              : undefined
          }
        />
      )}
      <Popover anchor={linkMenu?.anchor ?? null} open={menuLinks.length > 0} onClose={() => setLinkMenu(null)} width={260}>
        <div className="link-menu" role="menu">
          {menuLinks.map((l, i) => (
            <a key={i} className="link-menu-row" role="menuitem" href={l.url} target="_blank" rel="noreferrer noopener" onClick={() => setLinkMenu(null)}>
              <Link2 size={14} />
              <span className="link-menu-label">{l.label}</span>
              <span className="link-menu-host">{hostOf(l.url)}</span>
            </a>
          ))}
        </div>
      </Popover>
    </div>
  );
}

type BeginRec = Pick<DragRec, 'kind' | 'item' | 'target' | 'groupId' | 'wholeItem' | 'slot' | 'rowTop' | 'nested'>;

/** What a bar asks of the timeline around it. */
interface BlockActions {
  begin: (e: React.PointerEvent, rec: BeginRec) => void;
  /** `expand`: show or hide an umbrella's parts instead of opening its details. */
  click: (id: ID, expand: boolean) => void;
  enter: (id: ID, el: HTMLElement, umbrellaId: ID | null) => void;
  leave: () => void;
  toggleExpand: (id: ID) => void;
  linkMenu: (itemId: ID, anchor: HTMLElement) => void;
}

interface BlockProps {
  b: BlockGeom;
  state: RoadmapState;
  cal: SprintCalendar;
  scale: Scale;
  metrics: Metrics;
  colorBy: ColorBy;
  phaseMode: PhaseMode;
  groupBy: GroupBy;
  compact: boolean;
  readOnly: boolean;
  compare: RoadmapState | null;
  /** An umbrella's bar has a button that opens it. */
  expandable: boolean;
  selected: boolean;
  dragging: boolean;
  /** How far the bar is being dragged up or down. */
  dy: number;
  /** A part of the umbrella whose part is under the pointer: the whole family lights up. */
  family: boolean;
  open: boolean;
  /** What the initiative is expected to move, shown small under its name (Leadership). */
  impactLine: StageFigures[] | undefined;
  /** Name the initiative's strategic bet in a small tag before its name. */
  betTags: boolean;
  actions: BlockActions;
}

/**
 * One initiative's bar. Memoised: a drag renders the timeline again on every pointer move, and hovering a part
 * lights up its family, but only the bars whose props change (the dragged one, the family) render again.
 */
const Block = memo(function Block({
  b,
  state,
  cal,
  scale,
  metrics,
  colorBy,
  phaseMode,
  groupBy,
  compact,
  readOnly,
  compare,
  expandable,
  selected,
  dragging,
  dy,
  family,
  open,
  impactLine,
  betTags,
  actions,
}: BlockProps) {
  const item = b.item;
  const color = colorOf(item, state, colorBy);
  const ink = inkOn(color);
  const { badge, ghosts } = compareInfo(b, compare, phaseMode, scale, metrics, cal);
  const top = b.spans[0].y;
  const height = b.spans[0].h;
  const overall = overallSpan(item);
  // A part shows its umbrella in front of its own name (unless the name already starts with it).
  const umbrella = umbrellaOf(state, item);
  // Under its open umbrella, or in its umbrella's lane, a part needs no umbrella line: it's right there.
  const showsUmbrella = !!umbrella && !b.nested && groupBy !== 'umbrella';
  const named = umbrella && showsUmbrella ? partLabel(umbrella, item) : null;
  // A part shown on its own (the team board, alignment with parts shown) carries its umbrella as a tag: the name
  // on white after a dot of the umbrella's colour, or just the dot when the part's own name already says it.
  const tagged = showsUmbrella;
  const cssVars = { '--c': color, '--ink': ink, ...(tagged ? { '--u': boardColorOf(state, item).ink } : {}) } as CSSProperties;
  // Its strategic bet, in the bet's colour (an open umbrella's parts share its bet, so they go without): a tag on
  // the second line, before the expected impact, so the name keeps the first; just a dot before the name when the
  // bar is too short for the tag.
  const bet = betTags && !b.nested && item.trackId ? state.tracks[item.trackId] : undefined;
  const betTag = bet && b.w >= 150 && (
    <span className="bar-tag is-bet" style={{ '--u': bet.color } as CSSProperties}>
      {bet.name}
    </span>
  );
  const betDot = bet && !betTag && <span className="bar-dot" style={{ '--u': bet.color } as CSSProperties} title={bet.name} />;
  // An umbrella's dates come from its parts: it moves as a whole, and its parts are resized in the team view.
  const partCount = partsOf(state, item.id).length;
  const isUmbrella = partCount > 0;
  const label = (
    <>
      {named?.prefix || impactLine || betTag ? (
        // Two lines: a part's umbrella tag over its name, or the name over its strategic bet and expected impact.
        <span className="bar-stack">
          {named?.prefix && <span className="bar-tag">{named.prefix}</span>}
          {betDot ? (
            <span className="bar-line">
              {betDot}
              <span className="bar-title">{item.title}</span>
            </span>
          ) : (
            <span className="bar-title">{item.title}</span>
          )}
          <span className="bar-meta">
            {betTag}
            {impactLine && (
              <span className="bar-impact">
                {impactLine.map(({ stage, figures }, k) => (
                  <Fragment key={stage.id}>
                    {k > 0 && ' · '}
                    {figures.length > 0 && (
                      <>
                        <strong>
                          <Figures figures={figures} sep=", " />
                        </strong>{' '}
                      </>
                    )}
                    {stage.name}
                  </Fragment>
                ))}
              </span>
            )}
          </span>
        </span>
      ) : (
        <>
          {tagged && <span className="bar-dot" />}
          {betDot}
          <span className="bar-title">{item.title}</span>
        </>
      )}
      {item.status === 'at_risk' && <span className="bar-flag" aria-label="At risk">!</span>}
      {item.status === 'done' && <span className="bar-done" aria-label="Done">✓</span>}
      {badge && <span className={`cmp-badge ${badge.tone}`}>{badge.text}</span>}
    </>
  );
  // Too narrow for even a few letters: the hover card shows the name instead.
  const showLabel = !compact && b.w >= 44;
  // Short bars keep their room for the name; the details still list the links.
  const links = !compact && b.w >= 110 ? linksOf(item, umbrella) : [];
  // An umbrella can open to show its parts (packed views), from a small button at the end of its bar.
  const canExpand = expandable && isUmbrella && b.w >= 56;
  const actionsW = (links.length ? (links.length > 1 ? 32 : 22) : 0) + (canExpand ? 20 : 0);
  // With phases side by side the name crosses light and solid parts: draw it twice, and show the
  // light-on-dark copy only over the implementation part.
  const impl = phaseMode === 'separate' ? b.spans.find((sp) => sp.key === 'implementation') : undefined;
  return (
    <div
      className={`tl-block${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${family ? ' is-family' : ''}${b.nested ? ' is-nested' : ''}`}
      style={dy ? { transform: `translateY(${dy}px)`, zIndex: 30 } : undefined}
      onPointerEnter={(e) => actions.enter(item.id, (e.currentTarget.querySelector('.tl-item') as HTMLElement) ?? e.currentTarget, umbrella?.id ?? null)}
      onPointerLeave={actions.leave}
    >
      {ghosts.map((g, i) => (
        <div key={`g${i}`} className="tl-ghost" style={{ left: g.x, top: g.y, width: g.w, height: g.h, ...cssVars }} />
      ))}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${item.title}, ${overall ? cal.spanCode(overall) : 'not scheduled'}`}
        className={`tl-item st-${item.status}${actionsW ? ' has-actions' : ''}${item.tall ? ' is-tall' : ''}${open ? ' is-open' : ''}`}
        style={{ left: b.x, top, width: b.w, height, ...cssVars, ...(actionsW ? { '--actions-w': `${actionsW + 12}px` } : {}) } as CSSProperties}
        onPointerDown={(e) => actions.begin(e, { kind: 'move', item, target: 'all', groupId: b.groupId, wholeItem: true, rowTop: b.rowTop, nested: b.nested })}
        // An umbrella that opens in place does so on a click; ⌘/Ctrl-click (or Enter) opens its details.
        onClick={(e) => actions.click(item.id, expandable && isUmbrella && !(e.metaKey || e.ctrlKey))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openItem(item.id);
          }
        }}
      >
        {b.spans.map((sp) => (
          <div
            key={sp.key}
            className={`tl-seg ph-${sp.key}`}
            style={{ left: sp.x - b.x, width: sp.w }}
            title={sp.key === 'all' ? undefined : `${PHASE_LABELS[sp.key]} · ${cal.spanCode(sp.span)}`}
            onPointerDown={(e) =>
              actions.begin(e, { kind: 'move', item, target: sp.key, groupId: b.groupId, wholeItem: phaseMode === 'combined' || isUmbrella, rowTop: b.rowTop, nested: b.nested })
            }
          >
            {sp.key === 'all' && <PhaseStrip item={item} scale={scale} x={sp.x} />}
            {!readOnly && !isUmbrella && sp.w >= 26 && (
              <>
                <span className="tl-handle l" onPointerDown={(e) => actions.begin(e, { kind: 'start', item, target: sp.key, groupId: b.groupId, wholeItem: false })} />
                <span className="tl-handle r" onPointerDown={(e) => actions.begin(e, { kind: 'end', item, target: sp.key, groupId: b.groupId, wholeItem: false })} />
              </>
            )}
          </div>
        ))}
        {showLabel && (
          <span className="tl-text" style={impl ? outsideOf(impl.x - b.x, impl.x + impl.w - b.x) : undefined}>
            <span className="tl-text-in">{label}</span>
          </span>
        )}
        {showLabel && impl && (
          <span className="tl-text on-solid" aria-hidden="true" style={{ clipPath: `inset(0 ${b.x + b.w - (impl.x + impl.w)}px 0 ${impl.x - b.x}px)` }}>
            <span className="tl-text-in">{label}</span>
          </span>
        )}
        {actionsW > 0 && (
          <span className="tl-actions">
            {links.length > 0 && <LinkChip links={links} onMenu={(anchor) => actions.linkMenu(item.id, anchor)} />}
            {canExpand && (
              <button
                type="button"
                className={`tl-expand${open ? ' is-open' : ''}`}
                aria-expanded={open}
                aria-label={open ? `Hide the parts of ${item.title}` : `Show the ${partCount} parts of ${item.title}`}
                title={open ? 'Hide its parts' : `Show its ${partCount} part${partCount === 1 ? '' : 's'}`}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.toggleExpand(item.id);
                }}
              >
                {open ? <ChevronUp size={16} strokeWidth={2.5} /> : <ChevronDown size={16} strokeWidth={2.5} />}
              </button>
            )}
          </span>
        )}
        {!readOnly && (
          <span
            className="tl-handle b"
            title={item.tall ? 'Drag up for a one-row bar' : 'Drag down for a two-row bar (room for a long name)'}
            onPointerDown={(e) => actions.begin(e, { kind: 'height', item, target: 'all', groupId: b.groupId, wholeItem: true, rowTop: b.rowTop })}
          />
        )}
      </div>
    </div>
  );
});

/** Compare mode: dashed outlines where a bar's phases were, and a badge saying what changed. */
function compareInfo(
  b: BlockGeom,
  compare: RoadmapState | null,
  phaseMode: PhaseMode,
  scale: Scale,
  metrics: Metrics,
  cal: SprintCalendar,
): { badge: { text: string; tone: string } | null; ghosts: { x: number; w: number; y: number; h: number }[] } {
  const item = b.item;
  if (!compare) return { badge: null, ghosts: [] };
  const base = compare.items[item.id];
  if (!base) return { badge: { text: 'New', tone: 'new' }, ghosts: [] };
  const ghosts: { x: number; w: number; y: number; h: number }[] = [];
  {
    const now = b.spans;
    for (const g of spanGeoms(base, phaseMode, scale, metrics, b.rowTop)) {
      const cur = now.find((s) => s.key === g.key);
      if (!cur || Math.abs(cur.x - g.x) > 0.5 || Math.abs(cur.w - g.w) > 0.5) ghosts.push(g);
    }
  }
  const a = deliverySpan(base);
  const c = deliverySpan(item);
  let badge: { text: string; tone: string } | null = null;
  if (a && c) {
    const slip = cal.spanIndexes(c)[1] - cal.spanIndexes(a)[1];
    if (slip > 0) badge = { text: `+${slip} sprint${slip > 1 ? 's' : ''}`, tone: 'late' };
    else if (slip < 0) badge = { text: `${slip} sprint${slip < -1 ? 's' : ''}`, tone: 'early' };
    else if (ghosts.length) badge = { text: 'Moved', tone: 'moved' };
  }
  if (!badge && base.status !== item.status) badge = { text: 'Status', tone: 'moved' };
  return { badge, ghosts };
}

/** Opens an initiative's link straight from its bar: the only link directly, or a menu when there are several. */
function LinkChip({ links, onMenu }: { links: QuickLink[]; onMenu: (anchor: HTMLElement) => void }) {
  // Keep the bar from starting a drag or opening the details.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (links.length === 1) {
    return (
      <a
        className="tl-link"
        href={links[0].url}
        target="_blank"
        rel="noreferrer noopener"
        title={`Open ${links[0].label} (${hostOf(links[0].url)})`}
        aria-label={`Open ${links[0].label}`}
        onPointerDown={stop}
        onClick={stop}
        onKeyDown={stop}
      >
        <Link2 size={16} strokeWidth={2.25} />
      </a>
    );
  }
  return (
    <button
      type="button"
      className="tl-link"
      title={`${links.length} links`}
      aria-label={`${links.length} links`}
      aria-haspopup="menu"
      onPointerDown={stop}
      onKeyDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        onMenu(e.currentTarget);
      }}
    >
      <Link2 size={16} strokeWidth={2.25} />
      <span className="tl-link-count">{links.length}</span>
    </button>
  );
}

/** The name field of an initiative drawn on the timeline: Enter adds it, ⇧Enter adds and opens it, Esc cancels. */
function QuickAdd({
  x,
  w,
  top,
  height,
  when,
  onDone,
}: {
  x: number;
  w: number;
  top: number;
  height: number;
  when: string;
  onDone: (title: string, open: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const done = useRef(false);
  const finish = (value: string, open: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(value, open);
  };
  return (
    <>
      <div className="tl-create-ghost is-draft" style={{ left: x, top, width: w, height }} />
      <div className="tl-quick" style={{ left: x, top, width: Math.max(w, 260), height }} onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="tl-quick-input"
          value={title}
          placeholder="Name the initiative"
          aria-label="Name of the new initiative"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(title, e.shiftKey);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              finish('', false);
            }
          }}
          // Clicking away keeps what was typed (an empty name adds nothing).
          onBlur={() => finish(title, false)}
        />
        <div className="tl-quick-hint">
          <span className="mono">{when}</span>
          <span>
            <span className="kbd">↵</span> add <span className="kbd">⇧↵</span> add & open <span className="kbd">Esc</span> cancel
          </span>
        </div>
      </div>
    </>
  );
}

/** Hides a layer between two x positions (the implementation part), so the two copies of a name never overlap. */
function outsideOf(from: number, to: number): CSSProperties {
  const mask = `linear-gradient(to right, #000 ${from}px, transparent ${from}px, transparent ${to}px, #000 ${to}px)`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

function PhaseStrip({ item, scale, x }: { item: Item; scale: Scale; x: number }) {
  const present = PHASES.filter((p) => item.phases[p]);
  if (present.length < 2) return null;
  return (
    <span className="phase-strip" aria-hidden="true">
      {present.map((p) => {
        const s = item.phases[p]!;
        const left = scale.x(toDay(s.start)) - x;
        const width = scale.x(toDay(s.end)) - scale.x(toDay(s.start));
        return <span key={p} className={`ps ${p}`} style={{ left, width }} />;
      })}
    </span>
  );
}

type GroupGeom = ReturnType<typeof geometry>['groups'][number];

function GroupHeader({ g, onToggle }: { g: GroupGeom; onToggle: (id: string) => void }) {
  return (
    <button type="button" className="tl-ghead" onClick={() => onToggle(g.def.id)} aria-expanded={!g.collapsed} title={g.def.sub}>
      {g.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      {g.def.color && <span className="tl-gdot" style={{ background: g.def.color }} />}
      <span className="tl-gname">{g.def.label}</span>
      <span className="tl-gcount">{g.count}</span>
    </button>
  );
}

/**
 * A compact row's names: the umbrella (or initiative) on its first line, with a chevron that opens an umbrella,
 * and each open part's name on its own line below, indented. A section's header names the team or tag.
 */
function RowLabel({
  g,
  m,
  parts,
  onOpen,
  expandable,
  open,
  onToggleExpand,
}: {
  g: GroupGeom;
  m: Metrics;
  parts: BlockGeom[];
  onOpen?: (id: string) => void;
  expandable: boolean;
  open: boolean;
  onToggleExpand?: (id: ID) => void;
}) {
  if (g.def.header) {
    return (
      <div className="tl-rlabel is-section" style={{ top: g.y, height: g.h }}>
        <span className="tl-rsection">
          {g.def.color && <span className="tl-gdot" style={{ background: g.def.color }} />}
          <span className="tl-gname">{g.def.label}</span>
          {g.def.sub && <span className="tl-gcount">{g.def.sub}</span>}
        </span>
      </div>
    );
  }
  const itemId = g.def.itemId ?? g.def.id;
  const first = g.rowTops[0] ?? g.y;
  return (
    <div className="tl-rlabel" style={{ top: g.y, height: g.h }}>
      <div className="tl-rline" style={{ top: first - g.y, height: m.rowH }}>
        {expandable ? (
          <button
            type="button"
            className="tl-rtoggle"
            aria-expanded={open}
            aria-label={open ? `Hide the parts of ${g.def.label}` : `Show the parts of ${g.def.label}`}
            title={open ? 'Hide its parts' : 'Show its parts'}
            onClick={() => onToggleExpand?.(itemId)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="tl-rtoggle is-empty" />
        )}
        <button type="button" className="tl-rname" onClick={() => onOpen?.(itemId)} title={g.def.sub ? `${g.def.label} · ${g.def.sub}` : g.def.label}>
          {g.def.color && <span className="tl-gdot" style={{ background: g.def.color }} />}
          <span className="tl-gname">{g.def.label}</span>
        </button>
      </div>
      {parts.map((b) => (
        <div key={b.item.id} className="tl-rline is-part" style={{ top: b.rowTop - g.y, height: m.rowH }}>
          <button type="button" className="tl-rname" onClick={() => openItem(b.item.id)} title={b.item.title}>
            <span className="tl-gname">{b.item.title}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function GroupLabel({ g, onToggle }: { g: GroupGeom; onToggle: (id: string) => void }) {
  return (
    <div className="tl-glabel" style={{ top: g.y, height: g.h }}>
      <GroupHeader g={g} onToggle={onToggle} />
      {g.def.sub && !g.collapsed && g.h > 70 && <div className="tl-gsub">{g.def.sub}</div>}
    </div>
  );
}
