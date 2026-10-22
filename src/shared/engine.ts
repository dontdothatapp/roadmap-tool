import { BOARD_COLOR_IDS } from './colors.ts';
import { isValidISODate, toDay } from './dates.ts';
import { DEFAULT_SPRINTS } from './sprints.ts';
import {
  CONFIDENCES,
  DEPENDENCY_STATUSES,
  IMPACT_UNITS,
  PHASES,
  STATUSES,
  type AppliedBatch,
  type ChangeRecord,
  type Dependency,
  type Entity,
  type EntityType,
  type EntityUpdate,
  type FunnelStage,
  type ID,
  type Item,
  type Link,
  type NewChange,
  type Op,
  type Outcome,
  type PhaseKey,
  type RoadmapState,
  type Settings,
  type Span,
  type SprintPatternEntry,
  type Team,
  type Track,
} from './types.ts';
import { isPlainObject, safeUrl, stableEqual, str, uid } from './util.ts';

// ---------------------------------------------------------------------------
// Normalisation: every entity that enters the state passes through these, so
// the rest of the app can trust its shape (and stored links are always safe).
// ---------------------------------------------------------------------------

export const TEAM_COLORS = [
  '#4f5bd5', '#0f8a7e', '#c2410c', '#be185d', '#0369a1', '#7c3aed',
  '#15803d', '#b45309', '#a21caf', '#475569', '#4d7c0f', '#0e7490',
];

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function id(value: unknown): ID {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : uid();
}

function refId(value: unknown): ID | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

function normalizeSpan(value: unknown): Span | undefined {
  if (!isPlainObject(value)) return undefined;
  const { start, end } = value;
  if (!isValidISODate(start) || !isValidISODate(end)) return undefined;
  if (toDay(end) <= toDay(start)) return undefined;
  return { start, end };
}

function normalizeLink(value: unknown): Link | null {
  if (!isPlainObject(value)) return null;
  const url = safeUrl(value.url);
  const label = str(value.label, 200).trim();
  if (!url && !label) return null;
  return { id: id(value.id), label, url };
}

function normalizeOutcome(value: unknown): Outcome | null {
  if (!isPlainObject(value)) return null;
  const impact = value.impact === null || value.impact === '' ? null : num(Number(value.impact), NaN);
  return {
    id: id(value.id),
    stageId: str(value.stageId, 64),
    metric: str(value.metric, 200).trim(),
    impact: impact === null || Number.isNaN(impact) ? null : impact,
    unit: oneOf(value.unit, IMPACT_UNITS, '%'),
    confidence: oneOf(value.confidence, CONFIDENCES, 'medium'),
    landsBy: isValidISODate(value.landsBy) ? value.landsBy : null,
    ramp: Array.isArray(value.ramp)
      ? value.ramp.filter((n) => typeof n === 'number' && Number.isFinite(n)).slice(0, 12).map((n) => Math.min(100, Math.max(0, Math.round(n as number))))
      : [],
    note: str(value.note, 1000),
  };
}

function normalizeDependency(value: unknown): Dependency | null {
  if (!isPlainObject(value)) return null;
  const itemId = refId(value.itemId);
  const teamId = refId(value.teamId);
  if (!itemId && !teamId) return null;
  return {
    id: id(value.id),
    itemId,
    teamId: itemId ? null : teamId,
    note: str(value.note, 1000),
    status: oneOf(value.status, DEPENDENCY_STATUSES, 'open'),
  };
}

function list<T>(value: unknown, fn: (v: unknown) => T | null, max = 100): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const v of value.slice(0, max)) {
    const n = fn(v);
    if (n !== null) out.push(n);
  }
  return out;
}

export function normalizeItem(raw: Record<string, unknown>, itemId: ID): Item {
  const phases: Partial<Record<PhaseKey, Span>> = {};
  const rawPhases = isPlainObject(raw.phases) ? raw.phases : {};
  for (const p of PHASES) {
    const span = normalizeSpan(rawPhases[p]);
    if (span) phases[p] = span;
  }
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map((t) => str(t, 60).trim()).filter(Boolean))].slice(0, 30)
    : [];
  return {
    id: itemId,
    title: str(raw.title, 200).trim() || 'Untitled initiative',
    teamId: str(raw.teamId, 64),
    trackId: refId(raw.trackId),
    tags,
    status: oneOf(raw.status, STATUSES, 'planned'),
    key: raw.key === true,
    owner: str(raw.owner, 120).trim(),
    description: str(raw.description, 10_000),
    phases,
    onePagerUrl: safeUrl(raw.onePagerUrl),
    links: list(raw.links, normalizeLink, 50),
    outcomes: list(raw.outcomes, normalizeOutcome, 30),
    dependencies: list(raw.dependencies, normalizeDependency, 50).filter((d) => d.itemId !== itemId),
    order: num(raw.order, 0),
    row: typeof raw.row === 'number' && Number.isFinite(raw.row) ? Math.min(500, Math.max(0, Math.round(raw.row))) : null,
    tall: raw.tall === true,
    parentId: refId(raw.parentId) === itemId ? null : refId(raw.parentId),
    color: typeof raw.color === 'string' && BOARD_COLOR_IDS.includes(raw.color) ? raw.color : null,
  };
}

export function normalizeTeam(raw: Record<string, unknown>, teamId: ID): Team {
  return {
    id: teamId,
    name: str(raw.name, 80).trim() || 'New team',
    color: color(raw.color, TEAM_COLORS[0]),
    order: num(raw.order, 0),
    archived: raw.archived === true,
    pm: str(raw.pm, 120).trim(),
    em: str(raw.em, 120).trim(),
    ux: str(raw.ux, 120).trim(),
  };
}

export function normalizeTrack(raw: Record<string, unknown>, trackId: ID): Track {
  return {
    id: trackId,
    name: str(raw.name, 80).trim() || 'New strategic bet',
    color: color(raw.color, TEAM_COLORS[5]),
    order: num(raw.order, 0),
    description: str(raw.description, 1000),
    ownView: raw.ownView === true,
  };
}

function normalizePatternEntry(value: unknown): SprintPatternEntry | null {
  if (!isPlainObject(value)) return null;
  const weeks = Math.round(num(value.weeks, 2));
  if (weeks < 1 || weeks > 8) return null;
  return {
    weeks,
    label: str(value.label, 40).trim() || 'Sprint',
    short: str(value.short, 6).trim() || 'S',
    highlight: value.highlight === true,
  };
}

export const DEFAULT_FUNNEL: FunnelStage[] = [
  { id: 'top', name: 'Top of funnel', color: '#0369a1' },
  { id: 'mid', name: 'Mid funnel', color: '#7c3aed' },
  { id: 'bottom', name: 'Bottom funnel', color: '#0f8a7e' },
  { id: 'retention', name: 'Retention', color: '#c2410c' },
];

export function normalizeSettings(raw: Record<string, unknown>): Settings {
  const sprints = isPlainObject(raw.sprints) ? raw.sprints : {};
  const pattern = list(sprints.pattern, normalizePatternEntry, 12);
  const stages = list(
    raw.funnelStages,
    (v) =>
      isPlainObject(v)
        ? { id: id(v.id), name: str(v.name, 60).trim() || 'Stage', color: color(v.color, TEAM_COLORS[0]) }
        : null,
    12,
  );
  return {
    id: 'settings',
    name: str(raw.name, 80).trim() || 'Company roadmap',
    sprints: {
      anchor: isValidISODate(sprints.anchor) ? sprints.anchor : DEFAULT_SPRINTS.anchor,
      pattern: pattern.length ? pattern : DEFAULT_SPRINTS.pattern,
      naming: oneOf(sprints.naming, ['week', 'sequence'] as const, DEFAULT_SPRINTS.naming),
      firstNumber: Math.round(num(sprints.firstNumber, DEFAULT_SPRINTS.firstNumber)),
    },
    fiscalYearStartMonth: Math.min(12, Math.max(1, Math.round(num(raw.fiscalYearStartMonth, 1)))),
    funnelStages: stages.length ? stages : DEFAULT_FUNNEL,
  };
}

export function defaultSettings(): Settings {
  return normalizeSettings({});
}

export function emptyState(): RoadmapState {
  return { settings: defaultSettings(), teams: {}, tracks: {}, items: {} };
}

function normalize(entity: EntityType, raw: Record<string, unknown>, entityId: ID): Entity {
  switch (entity) {
    case 'item':
      return normalizeItem(raw, entityId);
    case 'team':
      return normalizeTeam(raw, entityId);
    case 'track':
      return normalizeTrack(raw, entityId);
    case 'settings':
      return normalizeSettings(raw);
  }
}

// ---------------------------------------------------------------------------
// Applying operations
// ---------------------------------------------------------------------------

const COLLECTION = { item: 'items', team: 'teams', track: 'tracks' } as const;

export function getEntity(state: RoadmapState, entity: EntityType, entityId: ID): Entity | null {
  if (entity === 'settings') return state.settings;
  return state[COLLECTION[entity]][entityId] ?? null;
}

export function setEntity(state: RoadmapState, entity: EntityType, entityId: ID, value: Entity | null): RoadmapState {
  if (entity === 'settings') {
    return value ? { ...state, settings: value as Settings } : state;
  }
  const key = COLLECTION[entity];
  const next = { ...state[key] } as Record<ID, Entity>;
  if (value) next[entityId] = value;
  else delete next[entityId];
  return { ...state, [key]: next };
}

/**
 * A state being changed by many entities at once (a batch of ops, a page of history, loading from storage).
 * `setEntity` copies a whole collection per entity, which makes a batch cost the square of the roadmap's size;
 * here each collection is copied the first time something in it changes and written in place after that.
 * The state it starts from is never touched, and `done()` returns that very object when nothing changed.
 * Nothing may write to the draft once `done()` has handed its state out.
 */
class Draft {
  private state: RoadmapState;
  private readonly copied = new Set<(typeof COLLECTION)[keyof typeof COLLECTION]>();

  constructor(base: RoadmapState) {
    this.state = base;
  }

  get(entity: EntityType, entityId: ID): Entity | null {
    return getEntity(this.state, entity, entityId);
  }

  put(entity: EntityType, entityId: ID, value: Entity | null): void {
    if (entity === 'settings') {
      if (value) this.state = { ...this.state, settings: value as Settings };
      return;
    }
    const key = COLLECTION[entity];
    if (!this.copied.has(key)) {
      this.state = { ...this.state, [key]: { ...this.state[key] } };
      this.copied.add(key);
    }
    const coll = this.state[key] as Record<ID, Entity>;
    if (value) coll[entityId] = value;
    else delete coll[entityId];
  }

  done(): RoadmapState {
    return this.state;
  }
}

export class OpError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const ENTITY_TYPES: EntityType[] = ['item', 'team', 'track', 'settings'];

export function validateOps(input: unknown): Op[] {
  if (!Array.isArray(input) || input.length === 0) throw new OpError('Expected a non-empty list of changes');
  if (input.length > 500) throw new OpError('Too many changes in one request');
  return input.map((raw) => {
    if (!isPlainObject(raw)) throw new OpError('Malformed change');
    const entity = raw.entity as EntityType;
    if (!ENTITY_TYPES.includes(entity)) throw new OpError(`Unknown entity type "${String(raw.entity)}"`);
    const entityId = entity === 'settings' ? 'settings' : raw.id;
    if (typeof entityId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(entityId)) throw new OpError('Malformed id');
    switch (raw.kind) {
      case 'create':
        if (!isPlainObject(raw.data)) throw new OpError('Missing data');
        return { kind: 'create', entity, id: entityId, data: raw.data };
      case 'update':
        if (!isPlainObject(raw.patch)) throw new OpError('Missing patch');
        return { kind: 'update', entity, id: entityId, patch: raw.patch };
      case 'delete':
        return { kind: 'delete', entity, id: entityId };
      default:
        throw new OpError('Unknown change kind');
    }
  });
}

export interface AppliedOp {
  entity: EntityType;
  id: ID;
  action: 'create' | 'update' | 'delete';
  before: Entity | null;
  after: Entity | null;
}

/**
 * What one op makes of an entity, given its value just before: the new value, null once it's deleted, or
 * undefined when the op changes nothing. Throws OpError when the op can't apply.
 */
function applyOne(op: Op, entityId: ID, before: Entity | null): Entity | null | undefined {
  if (op.kind === 'create') {
    if (op.entity === 'settings') throw new OpError('Settings cannot be created');
    if (before) throw new OpError('Something with this id already exists', 409);
    return normalize(op.entity, op.data, entityId);
  }
  if (op.kind === 'update') {
    if (!before) throw new OpError('This was deleted by someone else', 409);
    const after = normalize(op.entity, { ...(before as unknown as Record<string, unknown>), ...op.patch }, entityId);
    return stableEqual(before, after) ? undefined : after;
  }
  if (op.entity === 'settings') throw new OpError('Settings cannot be deleted');
  return before ? null : undefined;
}

/** Applies ops in order. Ops that change nothing are dropped. Throws OpError if any op is invalid (nothing is applied). */
export function applyOps(state: RoadmapState, ops: Op[]): { state: RoadmapState; applied: AppliedOp[] } {
  const draft = new Draft(state);
  const applied: AppliedOp[] = [];
  for (const op of ops) {
    const entityId = op.entity === 'settings' ? 'settings' : op.id;
    const before = draft.get(op.entity, entityId);
    const after = applyOne(op, entityId, before);
    if (after === undefined) continue;
    draft.put(op.entity, entityId, after);
    applied.push({ entity: op.entity, id: entityId, action: op.kind, before, after });
  }
  return { state: draft.done(), applied };
}

/** Ops that undo `ops` when applied after them. Must be computed against the state *before* applying. */
export function invertOps(state: RoadmapState, ops: Op[]): Op[] {
  const inverse: Op[] = [];
  // Each entity the ops have touched so far, as they left it; the rest is still as in `state`.
  const touched = new Map<string, Entity | null>();
  for (const op of ops) {
    const entityId = op.entity === 'settings' ? 'settings' : op.id;
    const key = `${op.entity}:${entityId}`;
    const before = touched.has(key) ? (touched.get(key) ?? null) : getEntity(state, op.entity, entityId);
    if (op.kind === 'create') {
      inverse.push({ kind: 'delete', entity: op.entity, id: op.id });
    } else if (op.kind === 'delete') {
      if (before) inverse.push({ kind: 'create', entity: op.entity, id: op.id, data: { ...before } });
    } else if (before) {
      const patch: Record<string, unknown> = {};
      const prev = before as unknown as Record<string, unknown>;
      for (const k of Object.keys(op.patch)) patch[k] = prev[k];
      inverse.push({ kind: 'update', entity: op.entity, id: op.id, patch });
    }
    try {
      const after = applyOne(op, entityId, before);
      if (after !== undefined) touched.set(key, after);
    } catch {
      // The forward op will fail too; the inverse is irrelevant then.
    }
  }
  // Undo runs backwards: the last op is undone first.
  return inverse.reverse();
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** What rebuilding the past needs from a change: the entity it touched and that entity's value before it. */
export type ValueBefore = Pick<ChangeRecord, 'entity' | 'entityId' | 'before'>;

/**
 * The roadmap as it was at time T, given the current state and the changes made after T (ascending).
 * For each entity, its first change after T holds its value at T in `before`; later ones are skipped, so
 * passing every change after T works as well as passing only the first per entity (what the server does).
 */
export function stateAt(current: RoadmapState, changesAfter: ValueBefore[]): RoadmapState {
  const draft = new Draft(current);
  const seen = new Set<string>();
  for (const c of changesAfter) {
    const key = `${c.entity}:${c.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    draft.put(c.entity, c.entityId, c.before && upToDate(c.entity, c.entityId, c.before));
  }
  return draft.done();
}

/** Storage used by RoadmapCore: SQLite on the server, memory + localStorage in the demo. */
export interface HistoryStore {
  lastChangeFor(entity: EntityType, entityId: ID): ChangeRecord | null;
  latestSnapshotTs(): string | null;
  insertChange(change: NewChange): number;
  deleteChange(seq: number): void;
  saveEntity(entity: EntityType, entityId: ID, value: Entity | null): void;
  transaction<T>(fn: () => T): T;
}

/** Rapid edits of one thing by one person collapse into a single history entry. */
export const COALESCE_WINDOW_MS = 10 * 60 * 1000;

export interface SubmitMeta {
  actor: string;
  clientId: string | null;
  now?: Date;
}

/** Owns the live state and records every change into history. */
export class RoadmapCore {
  state: RoadmapState;
  /**
   * How many batches have changed the state since this core was created. Clients compare it to tell whether
   * they missed anything. History can't tell them: an edit made back to where it was leaves no trace there.
   */
  version = 0;
  private readonly store: HistoryStore;

  constructor(state: RoadmapState, store: HistoryStore) {
    this.state = state;
    this.store = store;
  }

  submit(ops: Op[], meta: SubmitMeta): AppliedBatch {
    const { state, applied } = applyOps(this.state, ops);
    const ts = (meta.now ?? new Date()).toISOString();
    const batchId = applied.length > 1 ? uid() : null;
    const changes: ChangeRecord[] = [];
    const removedSeqs: number[] = [];
    const updates: EntityUpdate[] = [];

    this.store.transaction(() => {
      for (const a of applied) {
        this.store.saveEntity(a.entity, a.id, a.after);
        updates.push({ entity: a.entity, id: a.id, value: a.after });

        let before = a.before;
        let action = a.action;
        const prev = batchId === null ? this.store.lastChangeFor(a.entity, a.id) : null;
        if (prev && this.canCoalesce(prev, a, meta.actor, ts)) {
          this.store.deleteChange(prev.seq);
          removedSeqs.push(prev.seq);
          before = prev.before;
          action = prev.action === 'create' ? 'create' : 'update';
          if (stableEqual(before, a.after)) continue; // edited back to where it was: no trace left
        }
        const change: NewChange = { ts, actor: meta.actor, entity: a.entity, entityId: a.id, action, before, after: a.after, batchId };
        const seq = this.store.insertChange(change);
        changes.push({ ...change, seq });
      }
    });

    this.state = state;
    if (updates.length) this.version++;
    return { updates, changes, removedSeqs, clientId: meta.clientId };
  }

  private canCoalesce(prev: ChangeRecord, next: AppliedOp, actor: string, ts: string): boolean {
    if (next.action !== 'update' || prev.action === 'delete') return false;
    if (prev.actor !== actor || prev.batchId !== null) return false;
    if (Date.parse(ts) - Date.parse(prev.ts) > COALESCE_WINDOW_MS) return false;
    // Never merge across a snapshot, so snapshots always reproduce exactly what people saw.
    const snap = this.store.latestSnapshotTs();
    if (snap && snap >= prev.ts) return false;
    return true;
  }
}

/** In-memory HistoryStore, used by tests, demo data generation and the in-browser demo. */
export class MemoryHistory implements HistoryStore {
  changes: ChangeRecord[] = [];
  snapshotTimes: string[] = [];
  private nextSeq = 1;

  constructor(changes: ChangeRecord[] = [], snapshotTimes: string[] = []) {
    this.changes = changes;
    this.snapshotTimes = snapshotTimes;
    this.nextSeq = changes.reduce((m, c) => Math.max(m, c.seq), 0) + 1;
  }

  lastChangeFor(entity: EntityType, entityId: ID): ChangeRecord | null {
    for (let i = this.changes.length - 1; i >= 0; i--) {
      const c = this.changes[i];
      if (c.entity === entity && c.entityId === entityId) return c;
    }
    return null;
  }

  latestSnapshotTs(): string | null {
    return this.snapshotTimes.reduce<string | null>((m, t) => (m === null || t > m ? t : m), null);
  }

  insertChange(change: NewChange): number {
    const seq = this.nextSeq++;
    this.changes.push({ ...change, seq });
    return seq;
  }

  deleteChange(seq: number): void {
    this.changes = this.changes.filter((c) => c.seq !== seq);
  }

  saveEntity(): void {}

  transaction<T>(fn: () => T): T {
    const saved = this.changes.slice();
    const savedSeq = this.nextSeq;
    try {
      return fn();
    } catch (err) {
      this.changes = saved;
      this.nextSeq = savedSeq;
      throw err;
    }
  }

  changesAfter(ts: string): ChangeRecord[] {
    return this.changes.filter((c) => c.ts > ts);
  }
}

/** Entity updates for applying a batch to a client-side copy of the state. */
export function applyUpdates(state: RoadmapState, updates: EntityUpdate[]): RoadmapState {
  const draft = new Draft(state);
  for (const u of updates) draft.put(u.entity, u.id, u.value);
  return draft.done();
}

/**
 * Items, teams and strategic bets saved by an earlier version can lack newer fields (row, tall, ramp, colour, EPD
 * owners, own view) or hold values no longer used (older statuses), so they're brought up to the current shape as
 * they're read. Settings are left as stored: the calendar migrations recognise old calendars by their shape.
 */
function upToDate(entity: EntityType, id: ID, value: Entity): Entity {
  const raw = value as unknown as Record<string, unknown>;
  if (entity === 'item') return normalizeItem(raw, id);
  if (entity === 'team') return normalizeTeam(raw, id);
  if (entity === 'track') return normalizeTrack(raw, id);
  return value;
}

export function stateFromEntities(rows: { entity: EntityType; id: ID; value: Entity }[]): RoadmapState {
  const draft = new Draft(emptyState());
  for (const r of rows) draft.put(r.entity, r.id, upToDate(r.entity, r.id, r.value));
  return draft.done();
}

export function entitiesOf(state: RoadmapState): { entity: EntityType; id: ID; value: Entity }[] {
  return [
    { entity: 'settings', id: 'settings', value: state.settings },
    ...Object.values(state.teams).map((t) => ({ entity: 'team' as const, id: t.id, value: t })),
    ...Object.values(state.tracks).map((t) => ({ entity: 'track' as const, id: t.id, value: t })),
    ...Object.values(state.items).map((i) => ({ entity: 'item' as const, id: i.id, value: i })),
  ];
}

/** Validates an exported JSON document and turns it into a state (used by import). */
export function stateFromExport(raw: unknown): RoadmapState {
  if (!isPlainObject(raw) || !isPlainObject(raw.state)) throw new OpError('This file is not a roadmap export');
  const s = raw.state;
  const draft = new Draft({ ...emptyState(), settings: normalizeSettings(isPlainObject(s.settings) ? s.settings : {}) });
  for (const [key, entity] of [['teams', 'team'], ['tracks', 'track'], ['items', 'item']] as const) {
    const coll = isPlainObject(s[key]) ? s[key] : {};
    for (const [entityId, value] of Object.entries(coll)) {
      if (!isPlainObject(value) || !/^[A-Za-z0-9_-]{1,64}$/.test(entityId)) continue;
      draft.put(entity, entityId, normalize(entity, value, entityId));
    }
  }
  return draft.done();
}

/** Ops that turn `from` into `to` (used by import, which stays undoable and shows up in history). */
export function opsToReach(from: RoadmapState, to: RoadmapState): Op[] {
  const ops: Op[] = [];
  if (!stableEqual(from.settings, to.settings)) {
    ops.push({ kind: 'update', entity: 'settings', id: 'settings', patch: { ...to.settings } });
  }
  for (const [key, entity] of [['teams', 'team'], ['tracks', 'track'], ['items', 'item']] as const) {
    const a = from[key] as Record<ID, Entity>;
    const b = to[key] as Record<ID, Entity>;
    for (const entityId of Object.keys(b)) {
      if (!a[entityId]) ops.push({ kind: 'create', entity, id: entityId, data: { ...b[entityId] } });
      else if (!stableEqual(a[entityId], b[entityId])) {
        ops.push({ kind: 'update', entity, id: entityId, patch: { ...b[entityId] } });
      }
    }
  }
  // Delete items before teams/tracks so references disappear first.
  for (const [key, entity] of [['items', 'item'], ['tracks', 'track'], ['teams', 'team']] as const) {
    const a = from[key] as Record<ID, Entity>;
    const b = to[key] as Record<ID, Entity>;
    for (const entityId of Object.keys(a)) if (!b[entityId]) ops.push({ kind: 'delete', entity, id: entityId });
  }
  return ops;
}
