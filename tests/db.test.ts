import { describe, expect, it } from 'vitest';
import { Database } from '../src/server/db.ts';
import { MemoryHistory, RoadmapCore, stateAt } from '../src/shared/engine.ts';
import { generateDemo } from '../src/shared/seed.ts';

// The SQLite store on its own, in memory.

describe('database', () => {
  it('rebuilds any moment from only the first change per initiative after it', () => {
    const demo = generateDemo(new Date('2026-10-20T12:00:00'));
    const db = new Database(':memory:');
    db.importDemo(demo.state, demo.changes, demo.snapshots);
    // A few more edits on top, so some initiatives change several times after the moments below.
    const core = new RoadmapCore(db.loadState(), db);
    const memory = new MemoryHistory(db.listChanges({ limit: 500 }).reverse());
    const memCore = new RoadmapCore(core.state, memory);
    const id = Object.keys(core.state.items)[0];
    for (let k = 0; k < 3; k++) {
      const ops = [{ kind: 'update' as const, entity: 'item' as const, id, patch: { title: `Edit ${k}` } }];
      const meta = { actor: `p${k}`, clientId: null, now: new Date(Date.UTC(2026, 9, 21, 9, k)) };
      core.submit(ops, meta);
      memCore.submit(ops, meta);
    }
    const moments = [...new Set(memory.changes.map((c) => c.ts))].sort();
    expect(moments.length).toBeGreaterThan(5);
    for (const ts of ['2000-01-01T00:00:00.000Z', ...moments]) {
      expect(stateAt(core.state, db.firstChangesAfter(ts))).toEqual(stateAt(memCore.state, memory.changesAfter(ts)));
    }
    db.close();
  });

  it('lists an initiative’s changes newest first, page by page', () => {
    const demo = generateDemo(new Date('2026-10-20T12:00:00'));
    const db = new Database(':memory:');
    db.importDemo(demo.state, demo.changes, demo.snapshots);
    const id = demo.changes.find((c) => c.action === 'update')!.entityId;
    const all = demo.changes.filter((c) => c.entityId === id).map((c) => c.seq).sort((a, b) => b - a);
    expect(db.listChanges({ entityId: id }).map((c) => c.seq)).toEqual(all);
    expect(db.listChanges({ entityId: id, limit: 1 }).map((c) => c.seq)).toEqual(all.slice(0, 1));
    expect(db.listChanges({ entityId: id, beforeSeq: all[0] }).map((c) => c.seq)).toEqual(all.slice(1));
    expect(db.listChanges({ limit: 3 })).toHaveLength(3);
    db.close();
  });
});
