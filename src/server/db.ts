import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { stateFromEntities, type HistoryStore, type ValueBefore } from '../shared/engine.ts';
import type { ChangeRecord, Entity, EntityType, ID, NewChange, RoadmapState, Snapshot } from '../shared/types.ts';

interface ChangeRow {
  seq: number;
  ts: string;
  actor: string;
  entity: string;
  entity_id: string;
  action: string;
  before: string | null;
  after: string | null;
  batch_id: string | null;
}

function toChange(row: ChangeRow): ChangeRecord {
  return {
    seq: row.seq,
    ts: row.ts,
    actor: row.actor,
    entity: row.entity as EntityType,
    entityId: row.entity_id,
    action: row.action as ChangeRecord['action'],
    before: row.before ? (JSON.parse(row.before) as Entity) : null,
    after: row.after ? (JSON.parse(row.after) as Entity) : null,
    batchId: row.batch_id,
  };
}

/** Every fixed query, prepared once: several of them run for each initiative in a batch. */
function prepareStatements(db: DatabaseSync) {
  return {
    countEntities: db.prepare('SELECT COUNT(*) AS n FROM entities'),
    countChanges: db.prepare('SELECT COUNT(*) AS n FROM changes'),
    allEntities: db.prepare('SELECT entity, id, data FROM entities'),
    lastSeq: db.prepare('SELECT MAX(seq) AS seq FROM changes'),
    saveEntity: db.prepare('INSERT INTO entities (entity, id, data) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data'),
    deleteEntity: db.prepare('DELETE FROM entities WHERE entity = ? AND id = ?'),
    insertChange: db.prepare('INSERT INTO changes (ts, actor, entity, entity_id, action, before, after, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    deleteChange: db.prepare('DELETE FROM changes WHERE seq = ?'),
    lastChangeFor: db.prepare('SELECT * FROM changes WHERE entity = ? AND entity_id = ? ORDER BY seq DESC LIMIT 1'),
    // Time travel only needs each entity's value just before its first change after the moment. Left to itself,
    // SQLite reads the whole history in entity order to group it; reading by time touches only the changes after
    // the moment, so a look at last week stays quick however long the history gets.
    firstChangesAfter: db.prepare(
      'SELECT c.entity, c.entity_id, c.before FROM changes c JOIN (SELECT MIN(seq) AS seq FROM changes INDEXED BY changes_ts WHERE ts > ? GROUP BY entity, entity_id) m ON c.seq = m.seq ORDER BY c.seq',
    ),
    latestSnapshotTs: db.prepare('SELECT MAX(ts) AS ts FROM snapshots'),
    listSnapshots: db.prepare('SELECT id, name, note, ts, actor FROM snapshots ORDER BY ts DESC'),
    insertSnapshot: db.prepare('INSERT INTO snapshots (id, name, note, ts, actor) VALUES (?, ?, ?, ?, ?)'),
    deleteSnapshot: db.prepare('DELETE FROM snapshots WHERE id = ?'),
  };
}

export interface ChangeQuery {
  entityId?: string;
  beforeSeq?: number;
  limit?: number;
}

/** SQLite storage: current entities, the full change log, and snapshots. */
export class Database implements HistoryStore {
  private readonly db: DatabaseSync;
  private readonly sql: ReturnType<typeof prepareStatements>;
  /** The History view and an initiative's activity ask in up to four shapes (with or without each filter). */
  private readonly listSql = new Map<string, StatementSync>();
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS entities (
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (entity, id)
      );
      CREATE TABLE IF NOT EXISTS changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        before TEXT,
        after TEXT,
        batch_id TEXT
      );
      CREATE INDEX IF NOT EXISTS changes_entity ON changes (entity, entity_id, seq);
      -- An initiative's activity asks by id alone, which the index above can't serve.
      CREATE INDEX IF NOT EXISTS changes_entity_id ON changes (entity_id, seq);
      CREATE INDEX IF NOT EXISTS changes_ts ON changes (ts);
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT NOT NULL,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL
      );
    `);
    this.sql = prepareStatements(this.db);
  }

  isEmpty(): boolean {
    const row = this.sql.countEntities.get() as { n: number };
    const changes = this.sql.countChanges.get() as { n: number };
    return row.n === 0 && changes.n === 0;
  }

  loadState(): RoadmapState {
    const rows = this.sql.allEntities.all() as { entity: string; id: string; data: string }[];
    return stateFromEntities(rows.map((r) => ({ entity: r.entity as EntityType, id: r.id, value: JSON.parse(r.data) as Entity })));
  }

  lastSeq(): number {
    const row = this.sql.lastSeq.get() as { seq: number | null };
    return row.seq ?? 0;
  }

  saveEntity(entity: EntityType, id: ID, value: Entity | null): void {
    if (value) this.sql.saveEntity.run(entity, id, JSON.stringify(value));
    else this.sql.deleteEntity.run(entity, id);
  }

  insertChange(c: NewChange): number {
    const result = this.sql.insertChange.run(
      c.ts,
      c.actor,
      c.entity,
      c.entityId,
      c.action,
      c.before ? JSON.stringify(c.before) : null,
      c.after ? JSON.stringify(c.after) : null,
      c.batchId,
    );
    return Number(result.lastInsertRowid);
  }

  deleteChange(seq: number): void {
    this.sql.deleteChange.run(seq);
  }

  lastChangeFor(entity: EntityType, id: ID): ChangeRecord | null {
    const row = this.sql.lastChangeFor.get(entity, id) as ChangeRow | undefined;
    return row ? toChange(row) : null;
  }

  /** For each entity changed after `ts`, its value at `ts`: what `stateAt` needs to rebuild the roadmap then. */
  firstChangesAfter(ts: string): ValueBefore[] {
    const rows = this.sql.firstChangesAfter.all(ts) as unknown as Pick<ChangeRow, 'entity' | 'entity_id' | 'before'>[];
    return rows.map((r) => ({ entity: r.entity as EntityType, entityId: r.entity_id, before: r.before ? (JSON.parse(r.before) as Entity) : null }));
  }

  listChanges(q: ChangeQuery): ChangeRecord[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.entityId) {
      where.push('entity_id = ?');
      params.push(q.entityId);
    }
    if (q.beforeSeq) {
      where.push('seq < ?');
      params.push(q.beforeSeq);
    }
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const sql = `SELECT * FROM changes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`;
    let stmt = this.listSql.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.listSql.set(sql, stmt);
    }
    const rows = stmt.all(...params, limit) as unknown as ChangeRow[];
    return rows.map(toChange);
  }

  latestSnapshotTs(): string | null {
    const row = this.sql.latestSnapshotTs.get() as { ts: string | null };
    return row.ts;
  }

  listSnapshots(): Snapshot[] {
    return this.sql.listSnapshots.all() as unknown as Snapshot[];
  }

  insertSnapshot(s: Snapshot): void {
    this.sql.insertSnapshot.run(s.id, s.name, s.note, s.ts, s.actor);
  }

  deleteSnapshot(id: string): boolean {
    return Number(this.sql.deleteSnapshot.run(id).changes) > 0;
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  /** Bulk load used for first-run demo data. */
  importDemo(state: RoadmapState, changes: ChangeRecord[], snapshots: Snapshot[]): void {
    this.transaction(() => {
      this.saveEntity('settings', 'settings', state.settings);
      for (const t of Object.values(state.teams)) this.saveEntity('team', t.id, t);
      for (const t of Object.values(state.tracks)) this.saveEntity('track', t.id, t);
      for (const i of Object.values(state.items)) this.saveEntity('item', i.id, i);
      for (const c of [...changes].sort((a, b) => a.seq - b.seq)) this.insertChange(c);
      for (const s of snapshots) this.insertSnapshot(s);
    });
  }

  close(): void {
    this.db.close();
  }
}
