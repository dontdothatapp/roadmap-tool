import { MemoryHistory, OpError, RoadmapCore, entitiesOf, opsToReach, stateAt, stateFromEntities, stateFromExport, validateOps } from '../../shared/engine.ts';
import { generateDemo } from '../../shared/seed.ts';
import type { AppliedBatch, ChangeRecord, Op, RoadmapState, Snapshot } from '../../shared/types.ts';
import { uid } from '../../shared/util.ts';
import { ApiError, type Api, type Bootstrap, type ChangeQuery, type LiveHandlers } from './api.ts';

// Bumped when the example data changes in ways an old saved demo can't show, so saved demos start over
// (v2: week-numbered sprints; v3: cycles from Oct 1, 2026; v4: team owners and backlog ideas; v5: initiative parts; v6: a strategic bet with its own view).
const STORAGE_KEY = 'roadmap-anywhere-demo-v7';

interface Saved {
  state: RoadmapState;
  changes: ChangeRecord[];
  snapshots: Snapshot[];
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** The whole backend, running in the browser. Used by the demo build; data stays in this browser. */
export class LocalApi implements Api {
  readonly demo = true;
  readonly clientId = uid(12);
  private name = 'You';
  private core!: RoadmapCore;
  private history!: MemoryHistory;
  private snapshots: Snapshot[] = [];
  private handlers: LiveHandlers | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.init(load());
  }

  private init(saved: Saved | null) {
    const data = saved ?? generateDemo();
    this.snapshots = data.snapshots;
    this.history = new MemoryHistory(data.changes, data.snapshots.map((s) => s.ts));
    // A demo saved by an earlier version gets the fields added since (like the server does on start).
    this.core = new RoadmapCore(saved ? stateFromEntities(entitiesOf(saved.state)) : data.state, this.history);
  }

  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        const saved: Saved = { state: this.core.state, changes: this.history.changes, snapshots: this.snapshots };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // Storage can be unavailable (private windows, blocked site data). The demo still works for this visit.
      }
    }, 300);
  }

  setName(name: string): void {
    this.name = name || 'You';
    this.handlers?.presence([{ clientId: this.clientId, name: this.name }]);
  }

  resetDemo(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    this.init(null);
    this.handlers?.reload();
  }

  async bootstrap(): Promise<Bootstrap> {
    return {
      state: this.core.state,
      seq: this.history.changes.at(-1)?.seq ?? 0,
      version: String(this.core.version),
      me: { name: this.name, managed: false },
      snapshots: [...this.snapshots].sort((a, b) => b.ts.localeCompare(a.ts)),
    };
  }

  async submit(ops: Op[]): Promise<AppliedBatch> {
    let result: AppliedBatch;
    try {
      result = this.core.submit(validateOps(ops), { actor: this.name, clientId: this.clientId });
    } catch (err) {
      if (err instanceof OpError) throw new ApiError(err.message, err.status);
      throw err;
    }
    this.persist();
    const version = String(this.core.version);
    queueMicrotask(() => this.handlers?.batch({ ...result, version }));
    return result;
  }

  async stateAt(ts: string): Promise<RoadmapState> {
    return stateAt(this.core.state, this.history.changesAfter(new Date(ts).toISOString()));
  }

  async changes(q: ChangeQuery): Promise<ChangeRecord[]> {
    let list = this.history.changes;
    if (q.entityId) list = list.filter((c) => c.entityId === q.entityId);
    if (q.beforeSeq) list = list.filter((c) => c.seq < q.beforeSeq!);
    return list.slice(-(q.limit ?? 100)).reverse();
  }

  async createSnapshot(name: string, note: string): Promise<Snapshot> {
    const snapshot: Snapshot = { id: uid(), name: name.trim(), note: note.trim(), ts: new Date().toISOString(), actor: this.name };
    this.snapshots.push(snapshot);
    this.history.snapshotTimes.push(snapshot.ts);
    this.persist();
    this.handlers?.snapshots([...this.snapshots].sort((a, b) => b.ts.localeCompare(a.ts)));
    return snapshot;
  }

  async deleteSnapshot(id: string): Promise<void> {
    this.snapshots = this.snapshots.filter((s) => s.id !== id);
    this.persist();
    this.handlers?.snapshots([...this.snapshots].sort((a, b) => b.ts.localeCompare(a.ts)));
  }

  async exportData(): Promise<unknown> {
    return { format: 'roadmap-anywhere', version: 1, exportedAt: new Date().toISOString(), state: this.core.state, snapshots: this.snapshots };
  }

  async importData(data: unknown): Promise<number> {
    const ops = opsToReach(this.core.state, stateFromExport(data));
    if (ops.length === 0) return 0;
    const result = this.core.submit(ops, { actor: this.name, clientId: null });
    this.persist();
    this.handlers?.reload();
    return result.changes.length;
  }

  connect(handlers: LiveHandlers): () => void {
    this.handlers = handlers;
    queueMicrotask(() => {
      handlers.connection(true);
      // Nothing can happen in between here, so this is the version the page just loaded: no second load.
      handlers.hello(String(this.core.version));
      handlers.presence([{ clientId: this.clientId, name: this.name }]);
    });
    return () => {
      this.handlers = null;
    };
  }
}
