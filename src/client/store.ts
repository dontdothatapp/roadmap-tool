import { useMemo } from 'react';
import { create } from 'zustand';
import { pinUmbrellaColors } from '../shared/colors.ts';
import { applyOps, applyUpdates, emptyState, invertOps } from '../shared/engine.ts';
import { fromDay, todayDay } from '../shared/dates.ts';
import { calendarFor } from '../shared/sprints.ts';
import { partsOf } from '../shared/parts.ts';
import { PHASES, STATUSES, type AppliedBatch, type EntityUpdate, type ID, type Item, type Me, type Op, type PhaseKey, type PresenceUser, type RoadmapState, type Snapshot, type Span, type Status } from '../shared/types.ts';
import { uid } from '../shared/util.ts';
import type { Api } from './api/api.ts';
import { HttpApi } from './api/http.ts';
import { LocalApi } from './api/local.ts';

export const api: Api = __DEMO__ ? new LocalApi() : new HttpApi();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViewId = 'leadership' | 'alignment' | 'team' | 'bet' | 'impact' | 'history' | 'admin';
export type TimelineView = 'leadership' | 'alignment' | 'team' | 'bet';
export type PhaseMode = 'separate' | 'combined' | 'implementation';
export type GroupBy = 'team' | 'track' | 'stage' | 'umbrella' | 'none';
/** `board` is the team board's pastels (see shared/colors.ts); the other views let people pick team or track. */
export type ColorBy = 'team' | 'track' | 'board';
const GROUP_BYS: GroupBy[] = ['team', 'track', 'stage', 'umbrella', 'none'];
const COLOR_BYS: ColorBy[] = ['team', 'track'];

export interface ViewPrefs {
  phaseMode: PhaseMode;
  pxPerDay: number;
  groupBy: GroupBy;
  colorBy: ColorBy;
  showDeps: boolean;
  collapsed: string[];
  /** Umbrellas shown open, with their parts under them (leadership, alignment and bet views). */
  expanded: string[];
  /** Each bar names its strategic bet in a small tag of the bet's colour (leadership). */
  betTags: boolean;
  /** Parts on their own, each tagged with its umbrella, instead of one bar per umbrella (alignment). */
  showParts: boolean;
}

export interface Filters {
  q: string;
  teams: ID[];
  tracks: ID[];
  statuses: Status[];
}

export interface Route {
  view: ViewId;
  teamId: ID | null;
  /** The strategic bet shown in the bet view. */
  betId: ID | null;
  itemId: ID | null;
}

/** A read-only version of the roadmap at some moment (time travel) or a baseline to compare against. */
export interface Frame {
  at: string;
  label: string;
  state: RoadmapState;
}

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface UndoEntry {
  label: string;
  ops: Op[];
  inverse: Op[];
}

type Overlay = null | 'palette' | 'shortcuts' | 'name';

interface AppState {
  phase: 'loading' | 'ready' | 'error';
  loadError: string | null;
  live: RoadmapState;
  me: Me;
  needsName: boolean;
  presence: PresenceUser[];
  connected: boolean;
  snapshots: Snapshot[];
  travel: Frame | null;
  compare: Frame | null;
  route: Route;
  prefs: Record<TimelineView, ViewPrefs>;
  filters: Filters;
  overlay: Overlay;
  toasts: Toast[];
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  /** Bumped whenever history changes, so open history lists refresh. */
  historyVersion: number;
  /**
   * The batch behind the latest bump of `historyVersion` (own or someone else's): open history lists merge its
   * rows instead of fetching again. Null when history was reloaded as a whole (a reconnect, an import).
   */
  lastBatch: AppliedBatch | null;
  /** Newly created item whose title should get focus in the drawer. */
  focusTitle: ID | null;
  theme: 'system' | 'light' | 'dark';
}

// ---------------------------------------------------------------------------
// Persistence of per-person preferences
// ---------------------------------------------------------------------------

const PREFS_KEY = 'roadmap-anywhere-prefs-v1';

const DEFAULT_PREFS: Record<TimelineView, ViewPrefs> = {
  leadership: { phaseMode: 'combined', pxPerDay: 2.4, groupBy: 'track', colorBy: 'team', showDeps: false, collapsed: [], expanded: [], betTags: false, showParts: false },
  alignment: { phaseMode: 'combined', pxPerDay: 5, groupBy: 'team', colorBy: 'team', showDeps: false, collapsed: [], expanded: [], betTags: false, showParts: false },
  team: { phaseMode: 'separate', pxPerDay: 9, groupBy: 'none', colorBy: 'team', showDeps: false, collapsed: [], expanded: [], betTags: false, showParts: false },
  bet: { phaseMode: 'combined', pxPerDay: 4.5, groupBy: 'none', colorBy: 'team', showDeps: false, collapsed: [], expanded: [], betTags: false, showParts: false },
};

const EMPTY_FILTERS: Filters = { q: '', teams: [], tracks: [], statuses: [] };

/** Bump when a default changes in a way saved preferences should not override. */
const PREFS_VERSION = 2;

interface SavedPrefs {
  prefsVersion?: number;
  prefs?: Partial<Record<TimelineView, Partial<ViewPrefs>>>;
  filters?: Partial<Filters>;
  name?: string;
  theme?: AppState['theme'];
  lastTeam?: ID;
}

function readSaved(): SavedPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as SavedPrefs;
  } catch {
    return {};
  }
}

// Zoom and filters change many times a second (a trackpad pinch, typing in the filter field), and each save
// reads, parses and rewrites all the preferences. Those changes are gathered here and saved once they settle.
// Leaving the page saves them at once; only a crash or a killed tab in that quarter second loses them.
let pendingSave: Partial<SavedPrefs> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function writeSaved(patch: Partial<SavedPrefs>) {
  // Anything still waiting goes along, so it can't land later and overwrite this.
  const all = { ...pendingSave, ...patch };
  pendingSave = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readSaved(), ...all }));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

function writeSavedSoon(patch: Partial<SavedPrefs>) {
  pendingSave = { ...pendingSave, ...patch };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeSaved({}), 250);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (pendingSave) writeSaved({});
  });
}

const saved = readSaved();

// ---------------------------------------------------------------------------
// Routing: #view[.teamId or .betId][~itemId] — plain tokens so links survive any host.
// ---------------------------------------------------------------------------

const VIEWS: ViewId[] = ['leadership', 'alignment', 'team', 'bet', 'impact', 'history', 'admin'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [main, itemId] = raw.split('~');
  const [view, id] = (main ?? '').split('.');
  return {
    view: VIEWS.includes(view as ViewId) ? (view as ViewId) : 'alignment',
    teamId: view !== 'bet' ? id || null : null,
    betId: view === 'bet' ? id || null : null,
    itemId: itemId || null,
  };
}

export function routeHash(r: Route): string {
  let h = `#${r.view}`;
  if (r.view === 'team' && r.teamId) h += `.${r.teamId}`;
  if (r.view === 'bet' && r.betId) h += `.${r.betId}`;
  if (r.itemId) h += `~${r.itemId}`;
  return h;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function mergePrefs(): Record<TimelineView, ViewPrefs> {
  const out = { ...DEFAULT_PREFS };
  for (const v of Object.keys(out) as TimelineView[]) {
    const own = { ...(saved.prefs?.[v] ?? {}) };
    // Version 2 hides dependency arrows by default; earlier saves stored the old default.
    if ((saved.prefsVersion ?? 1) < 2) delete own.showDeps;
    // Groupings and colours that no longer exist (status, metric, owner) fall back to the default.
    if (own.groupBy && !GROUP_BYS.includes(own.groupBy)) delete own.groupBy;
    if (own.colorBy && !COLOR_BYS.includes(own.colorBy)) delete own.colorBy;
    delete (own as { keyOnly?: boolean }).keyOnly;
    out[v] = { ...DEFAULT_PREFS[v], ...own };
  }
  return out;
}

export const useApp = create<AppState>(() => ({
  phase: 'loading',
  loadError: null,
  live: emptyState(),
  me: { name: saved.name ?? '', managed: false },
  needsName: false,
  presence: [],
  connected: false,
  snapshots: [],
  travel: null,
  compare: null,
  route: parseHash(typeof location !== 'undefined' ? location.hash : ''),
  prefs: mergePrefs(),
  // Saved filters may hold ones that no longer exist (tags, the done status): only the current kinds are read.
  filters: {
    q: '',
    teams: saved.filters?.teams ?? [],
    tracks: saved.filters?.tracks ?? [],
    statuses: (saved.filters?.statuses ?? []).filter((s) => STATUSES.includes(s)),
  },
  overlay: null,
  toasts: [],
  undoStack: [],
  redoStack: [],
  historyVersion: 0,
  lastBatch: null,
  focusTitle: null,
  theme: saved.theme ?? 'system',
}));

const get = useApp.getState;
const set = useApp.setState;

/** The roadmap being displayed: a past version while time travelling, otherwise the live one. */
export function useRoadmap(): RoadmapState {
  return useApp((s) => s.travel?.state ?? s.live);
}

export function useReadOnly(): boolean {
  return useApp((s) => s.travel !== null);
}

/**
 * While an older version is open (time travel) or compared with today, the two versions to set side by side:
 * `before` is the older one, `after` today's. Null when only today's roadmap is shown.
 */
export function useVersions(): { before: RoadmapState; after: RoadmapState } | null {
  const old = useApp((s) => s.travel ?? s.compare);
  // Only follows live changes while there is something to compare them with.
  const live = useApp((s) => (s.travel || s.compare ? s.live : null));
  return useMemo(() => (old && live ? { before: old.state, after: live } : null), [old, live]);
}

export function useCalendar() {
  const settings = useApp((s) => (s.travel?.state ?? s.live).settings.sprints);
  return calendarFor(settings);
}

export function currentState(): RoadmapState {
  const s = get();
  return s.travel?.state ?? s.live;
}

// --- boot & live updates ------------------------------------------------------

let disconnect: (() => void) | null = null;

/**
 * The server's version of the roadmap that `live` shows: the loaded one's, then each batch's from the live stream.
 * Only batches from the stream count: they arrive in order, so having one means having every batch before it,
 * whereas the reply to our own change can overtake someone else's earlier batch.
 */
let liveVersion: string | null = null;

export async function boot(): Promise<void> {
  try {
    if (get().me.name) api.setName(get().me.name);
    const data = await api.bootstrap();
    const me = data.me.managed ? data.me : { name: get().me.name, managed: false };
    liveVersion = data.version;
    set({
      phase: 'ready',
      live: data.state,
      snapshots: data.snapshots,
      me,
      needsName: !me.managed && !me.name && !api.demo,
    });
    if (api.demo && !me.name) set({ me: { name: 'You', managed: false } });
    normalizeRoute();
    disconnect?.();
    disconnect = api.connect({
      batch(batch) {
        if (batch.version) liveVersion = batch.version;
        set((s) => ({ live: applyUpdates(s.live, settled(batch.updates)), historyVersion: s.historyVersion + 1, lastBatch: batch }));
      },
      presence(users) {
        set({ presence: users });
      },
      snapshots(snapshots) {
        set({ snapshots });
      },
      reload() {
        void reloadLive();
      },
      connection(connected) {
        set({ connected });
      },
      hello(version) {
        // The stream (re)connected. If the server's roadmap moved on while we weren't listening (between loading
        // and connecting, or while offline), load it again; usually it hasn't, and one load at start is enough.
        if (get().phase === 'ready' && (version === null || version !== liveVersion)) void reloadLive();
      },
    });
  } catch (err) {
    set({ phase: 'error', loadError: err instanceof Error ? err.message : String(err) });
  }
}

async function reloadLive() {
  try {
    const data = await api.bootstrap();
    liveVersion = data.version;
    set((s) => ({ live: data.state, snapshots: data.snapshots, historyVersion: s.historyVersion + 1, lastBatch: null }));
  } catch {
    // The connection handler will retry.
  }
}

export function setName(name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  writeSaved({ name: clean });
  api.setName(clean);
  set({ me: { name: clean, managed: false }, needsName: false, overlay: null });
}

// --- toasts --------------------------------------------------------------------

export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action']; duration?: number } = {}) {
  const id = uid();
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone: opts.tone ?? 'info', action: opts.action }] }));
  setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 6000 : 3500));
}

export function dismissToast(id: string) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// --- changes, undo & redo ---------------------------------------------------------

// Entities with changes still on their way to the server. Incoming updates for them are held back
// until our own last change comes back, so fast successive edits never flicker to an older value.
const inFlight = new Map<string, number>();
const flightKey = (entity: string, id: string) => `${entity}:${id}`;

function settled(updates: EntityUpdate[]): EntityUpdate[] {
  return updates.filter((u) => !inFlight.get(flightKey(u.entity, u.id)));
}

function land(ops: Op[]) {
  for (const op of ops) {
    const k = flightKey(op.entity, op.id);
    const n = (inFlight.get(k) ?? 1) - 1;
    if (n <= 0) inFlight.delete(k);
    else inFlight.set(k, n);
  }
}

/**
 * Applies ops immediately (optimistic), sends them to the server and records an undo step.
 * Returns false when nothing could be applied.
 */
export function dispatch(ops: Op[], label: string, opts: { undoable?: boolean; undoToast?: boolean } = {}): boolean {
  if (ops.length === 0) return false;
  if (get().travel) {
    toast('You’re looking at a past version. Go back to the live roadmap to make changes.', { tone: 'error' });
    return false;
  }
  const before = get().live;
  let next: RoadmapState;
  try {
    next = applyOps(before, ops).state;
    // An umbrella formed by this change gets its own colour on the team board, kept from then on.
    const pinned = pinUmbrellaColors(before, next);
    if (pinned.length) {
      ops = [...ops, ...pinned];
      next = applyOps(before, ops).state;
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : 'That change could not be applied', { tone: 'error' });
    return false;
  }
  if (next === before) return false;
  const inverse = invertOps(before, ops);
  set((s) => ({
    live: next,
    undoStack: opts.undoable === false ? s.undoStack : [...s.undoStack.slice(-99), { label, ops, inverse }],
    redoStack: opts.undoable === false ? s.redoStack : [],
  }));
  if (opts.undoToast) toast(label, { action: { label: 'Undo', run: undo } });
  for (const op of ops) inFlight.set(flightKey(op.entity, op.id), (inFlight.get(flightKey(op.entity, op.id)) ?? 0) + 1);
  api.submit(ops).then(
    (batch) => {
      land(ops);
      set((s) => ({ live: applyUpdates(s.live, settled(batch.updates)), historyVersion: s.historyVersion + 1, lastBatch: batch }));
    },
    (err) => {
      land(ops);
      toast(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`, { tone: 'error' });
      void reloadLive();
    },
  );
  return true;
}

export function undo() {
  const entry = get().undoStack.at(-1);
  if (!entry || get().travel) return;
  set((s) => ({ undoStack: s.undoStack.slice(0, -1) }));
  if (dispatch(entry.inverse, entry.label, { undoable: false })) {
    set((s) => ({ redoStack: [...s.redoStack, entry] }));
    toast(`Undid: ${entry.label}`);
  }
}

export function redo() {
  const entry = get().redoStack.at(-1);
  if (!entry || get().travel) return;
  set((s) => ({ redoStack: s.redoStack.slice(0, -1) }));
  if (dispatch(entry.ops, entry.label, { undoable: false })) {
    set((s) => ({ undoStack: [...s.undoStack, entry] }));
    toast(`Redid: ${entry.label}`);
  }
}

export function updateItem(id: ID, patch: Partial<Item>, label?: string, opts?: { undoToast?: boolean }) {
  const item = get().live.items[id];
  if (!item) return;
  dispatch([{ kind: 'update', entity: 'item', id, patch: patch as Record<string, unknown> }], label ?? `Edited “${item.title}”`, opts);
}

/** Adds an initiative and opens it, name field first. With open: false (quick add on the timeline) it just adds it. */
export function createItem(defaults: Partial<Item>, opts: { open?: boolean; extraOps?: Op[] } = {}): ID | null {
  const state = get().live;
  const teams = Object.values(state.teams).filter((t) => !t.archived).sort((a, b) => a.order - b.order);
  const teamId = defaults.teamId ?? get().route.teamId ?? saved.lastTeam ?? teams[0]?.id;
  if (!teamId || !state.teams[teamId]) {
    toast('Add a team in Settings first.', { tone: 'error' });
    return null;
  }
  const maxOrder = Object.values(state.items).reduce((m, i) => Math.max(m, i.order), 0);
  const id = uid();
  const open = opts.open ?? true;
  const ok = dispatch(
    [{ kind: 'create', entity: 'item', id, data: { title: 'Untitled initiative', status: 'planned', order: maxOrder + 1, ...defaults, teamId } }, ...(opts.extraOps ?? [])],
    open ? 'Added an initiative' : `Added “${defaults.title ?? 'Untitled initiative'}”`,
    { undoToast: !open },
  );
  if (!ok) return null;
  if (!open) return id;
  set({ focusTitle: id });
  openItem(id);
  return id;
}

/** A new item scheduled for the next sprint, one sprint long (keyboard shortcut / "New" button). */
export function createScheduledItem(defaults: Partial<Item> = {}): ID | null {
  const cal = calendarFor(get().live.settings.sprints);
  const next = cal.indexOf(todayDay()) + 1;
  const span: Span = cal.spanFromIndexes(next, next + 1);
  return createItem({ phases: { implementation: span }, ...defaults });
}

export function deleteItem(id: ID) {
  const state = get().live;
  const item = state.items[id];
  if (!item) return;
  const ops: Op[] = [{ kind: 'delete', entity: 'item', id }];
  for (const other of Object.values(state.items)) {
    if (other.dependencies.some((d) => d.itemId === id)) {
      ops.push({ kind: 'update', entity: 'item', id: other.id, patch: { dependencies: other.dependencies.filter((d) => d.itemId !== id) } });
    }
  }
  // Its parts stay, as initiatives of their own.
  for (const part of partsOf(state, id)) ops.push({ kind: 'update', entity: 'item', id: part.id, patch: { parentId: null } });
  if (get().route.itemId === id) closeItem();
  dispatch(ops, `Deleted “${item.title}”`, { undoToast: true });
}

export function duplicateItem(id: ID) {
  const item = get().live.items[id];
  if (!item) return;
  const copy: Partial<Item> = { ...item, title: `${item.title} (copy)`, order: item.order + 0.01 };
  delete copy.id;
  createItem(copy);
}

/** Keyboard nudge: move the whole item by a sprint, or (resize) move the end of its last phase. */
export function nudgeItem(id: ID, dir: -1 | 1, resize: boolean) {
  const item = get().live.items[id];
  if (!item) return;
  const cal = calendarFor(get().live.settings.sprints);
  const parts = partsOf(get().live, id);
  if (parts.length) {
    // An umbrella's dates are its parts': it moves as a whole, and only parts change length.
    if (resize) {
      toast('Change the length of its parts in the team view.');
      return;
    }
    const ops: Op[] = parts
      .filter((part) => Object.keys(part.phases).length)
      .map((part) => {
        const phases = { ...part.phases };
        for (const p of PHASES) if (phases[p]) phases[p] = cal.shiftSpan(phases[p]!, dir);
        return { kind: 'update', entity: 'item', id: part.id, patch: { phases } };
      });
    if (ops.length) dispatch(ops, `Rescheduled “${item.title}” and its parts`);
    return;
  }
  const present = (Object.keys(item.phases) as PhaseKey[]).filter((p) => item.phases[p]);
  if (present.length === 0) return;
  const phases = { ...item.phases };
  if (resize) {
    const last = present.reduce((a, b) => (item.phases[b]!.end > item.phases[a]!.end ? b : a));
    const [a, b] = cal.spanIndexes(item.phases[last]!);
    phases[last] = cal.spanFromIndexes(a, Math.max(a + 1, b + dir));
  } else {
    for (const p of present) phases[p] = cal.shiftSpan(item.phases[p]!, dir);
  }
  updateItem(id, { phases }, `Rescheduled “${item.title}”`);
}

export function setPhase(id: ID, phase: PhaseKey, span: Span | null) {
  const item = get().live.items[id];
  if (!item) return;
  const phases = { ...item.phases };
  if (span) phases[phase] = span;
  else delete phases[phase];
  updateItem(id, { phases }, `Rescheduled “${item.title}”`);
}

// --- navigation --------------------------------------------------------------------

function writeHash(route: Route, push: boolean) {
  const hash = routeHash(route);
  if (location.hash === hash) return;
  try {
    if (push) history.pushState(null, '', hash);
    else history.replaceState(null, '', hash);
  } catch {
    // Some embedded frames refuse history changes; the in-memory route still works.
  }
}

export function navigate(patch: Partial<Route>, push = patch.view !== undefined || patch.teamId !== undefined || patch.betId !== undefined) {
  const route = { ...get().route, ...patch };
  if (route.view === 'team' && route.teamId) writeSaved({ lastTeam: route.teamId });
  set({ route });
  writeHash(route, push);
}

export function openItem(id: ID) {
  navigate({ itemId: id });
}

export function closeItem() {
  navigate({ itemId: null });
}

/** Fills in a team for the team view and drops links to items that don't exist. */
function normalizeRoute() {
  const { route, live } = get();
  const teams = Object.values(live.teams).filter((t) => !t.archived).sort((a, b) => a.order - b.order);
  let teamId = route.teamId;
  if (!teamId || !live.teams[teamId]) teamId = (saved.lastTeam && live.teams[saved.lastTeam] ? saved.lastTeam : teams[0]?.id) ?? null;
  // A bet view shows a bet that has a view of its own (or, failing that, any bet).
  let betId = route.betId;
  if (!betId || !live.tracks[betId]) {
    const bets = Object.values(live.tracks).sort((a, b) => a.order - b.order);
    betId = (bets.find((t) => t.ownView) ?? bets[0])?.id ?? null;
  }
  const itemId = route.itemId && live.items[route.itemId] ? route.itemId : null;
  navigate({ teamId, betId, itemId }, false);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    set({ route: parseHash(location.hash) });
    if (get().phase === 'ready') normalizeRoute();
  });
}

// --- preferences & filters -------------------------------------------------------

export function setPrefs(view: TimelineView, patch: Partial<ViewPrefs>) {
  set((s) => {
    const prefs = { ...s.prefs, [view]: { ...s.prefs[view], ...patch } };
    writeSavedSoon({ prefs, prefsVersion: PREFS_VERSION });
    return { prefs };
  });
}

export function setFilters(patch: Partial<Filters>) {
  set((s) => {
    const filters = { ...s.filters, ...patch };
    writeSavedSoon({ filters: { ...filters, q: '' } });
    return { filters };
  });
}

export function clearFilters() {
  set({ filters: { ...EMPTY_FILTERS } });
  writeSaved({ filters: EMPTY_FILTERS });
}

export function activeFilterCount(f: Filters): number {
  return f.teams.length + f.tracks.length + f.statuses.length + (f.q.trim() ? 1 : 0);
}

export function setTheme(theme: AppState['theme']) {
  writeSaved({ theme });
  set({ theme });
}

export function setOverlay(overlay: Overlay) {
  set({ overlay });
}

// --- time travel & compare -----------------------------------------------------------

export async function timeTravel(at: string, label: string) {
  try {
    const state = await api.stateAt(at);
    set({ travel: { at, label, state }, compare: null });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t load that version', { tone: 'error' });
  }
}

export function exitTravel() {
  set({ travel: null });
}

export async function startCompare(at: string, label: string) {
  try {
    const state = await api.stateAt(at);
    set({ compare: { at, label, state }, travel: null });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t load that version', { tone: 'error' });
  }
}

export function stopCompare() {
  set({ compare: null });
}

export async function createSnapshot(name: string, note: string) {
  try {
    const snapshot = await api.createSnapshot(name, note);
    set((s) => ({ snapshots: [snapshot, ...s.snapshots.filter((x) => x.id !== snapshot.id)] }));
    toast(`Saved snapshot “${snapshot.name}”`, { tone: 'success' });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t save the snapshot', { tone: 'error' });
  }
}

export async function deleteSnapshot(id: string) {
  try {
    await api.deleteSnapshot(id);
    set((s) => ({ snapshots: s.snapshots.filter((x) => x.id !== id) }));
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t delete the snapshot', { tone: 'error' });
  }
}

export function todayIso(): string {
  return fromDay(todayDay());
}
