import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import { OpError, RoadmapCore, defaultSettings, opsToReach, stateAt, stateFromExport, validateOps } from '../shared/engine.ts';
import { generateDemo } from '../shared/seed.ts';
import type { AppliedBatch, Me, PresenceUser, Snapshot } from '../shared/types.ts';
import { str, uid } from '../shared/util.ts';
import { Database } from './db.ts';
import { migrateSprintCalendar } from './migrations.ts';

const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data');
/** When set (e.g. "x-forwarded-email"), identity comes from this header, added by an SSO proxy in front of the app. */
const AUTH_HEADER = process.env.AUTH_HEADER?.trim().toLowerCase() || null;
const SEED = process.env.SEED ?? 'demo';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// --- storage & state --------------------------------------------------------

const db = new Database(join(DATA_DIR, 'roadmap.db'));
if (db.isEmpty()) {
  if (SEED === 'demo') {
    const demo = generateDemo();
    db.importDemo(demo.state, demo.changes, demo.snapshots);
    console.log('Started a new roadmap with example data (set SEED=empty to start blank).');
  } else {
    db.saveEntity('settings', 'settings', defaultSettings());
    console.log('Started a new, empty roadmap.');
  }
}
const core = new RoadmapCore(db.loadState(), db);
for (const line of migrateSprintCalendar(core)) console.log(line);

// The roadmap's version: this run of the server, and how many batches it has applied. A client that loaded one
// version and hears another when its live stream (re)connects has missed something and loads the roadmap again;
// after a restart every client does, since the run is new.
const run = uid(8);
const version = () => `${run}.${core.version}`;

// --- live updates (server-sent events) ---------------------------------------

interface Client {
  res: Response;
  clientId: string;
  name: string;
}
const clients = new Map<string, Client>();

function message(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function send(res: Response, event: string, data: unknown) {
  res.write(message(event, data));
}

function broadcast(event: string, data: unknown) {
  if (clients.size === 0) return;
  // One batch can carry hundreds of initiatives: turn it into text once, not once per open tab.
  const text = message(event, data);
  for (const c of clients.values()) c.res.write(text);
}

function presence(): PresenceUser[] {
  return [...clients.values()].map((c) => ({ clientId: c.clientId, name: c.name }));
}

setInterval(() => {
  for (const c of clients.values()) c.res.write(': keep-alive\n\n');
}, 25_000).unref();

// --- identity ------------------------------------------------------------------

function identify(req: Request): Me | null {
  if (AUTH_HEADER) {
    const value = req.header(AUTH_HEADER)?.trim();
    return value ? { name: value.slice(0, 120), managed: true } : null;
  }
  let name = '';
  try {
    name = decodeURIComponent(req.header('x-user-name') ?? (typeof req.query.name === 'string' ? req.query.name : ''));
  } catch {
    name = '';
  }
  name = name.trim().slice(0, 80);
  return { name: name || 'Anonymous', managed: false };
}

// --- app ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
// gzip takes the script, the stylesheet and the roadmap JSON to about a tenth of their size. The live-updates
// stream is left out: compression buffers what it sends, which would hold back server-sent events.
const compress = compression();
app.use((req, res, next) => (req.path === '/api/events' ? next() : compress(req, res, next)));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  const me = identify(req);
  if (!me) {
    res.status(401).json({ error: `Sign-in required: the ${AUTH_HEADER} header is missing.` });
    return;
  }
  res.locals.me = me;
  next();
});

app.get('/api/bootstrap', (_req, res) => {
  res.json({ state: core.state, seq: db.lastSeq(), version: version(), me: res.locals.me, snapshots: db.listSnapshots() });
});

app.get('/api/state', (req, res) => {
  const at = typeof req.query.at === 'string' ? req.query.at : '';
  if (Number.isNaN(Date.parse(at))) {
    res.status(400).json({ error: 'Pass ?at= with a date and time' });
    return;
  }
  const ts = new Date(at).toISOString();
  res.json({ state: stateAt(core.state, db.firstChangesAfter(ts)) });
});

app.post('/api/ops', (req, res) => {
  const ops = validateOps(req.body?.ops);
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.slice(0, 64) : null;
  const result: AppliedBatch = core.submit(ops, { actor: (res.locals.me as Me).name, clientId });
  if (result.updates.length) broadcast('batch', { ...result, version: version() });
  res.json(result);
});

app.get('/api/changes', (req, res) => {
  res.json({
    changes: db.listChanges({
      entityId: typeof req.query.entityId === 'string' ? req.query.entityId : undefined,
      beforeSeq: req.query.beforeSeq ? Number(req.query.beforeSeq) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }),
  });
});

app.get('/api/snapshots', (_req, res) => {
  res.json({ snapshots: db.listSnapshots() });
});

app.post('/api/snapshots', (req, res) => {
  const name = str(req.body?.name, 120).trim();
  if (!name) {
    res.status(400).json({ error: 'Give the snapshot a name' });
    return;
  }
  const snapshot: Snapshot = { id: uid(), name, note: str(req.body?.note, 1000).trim(), ts: new Date().toISOString(), actor: (res.locals.me as Me).name };
  db.insertSnapshot(snapshot);
  broadcast('snapshots', { snapshots: db.listSnapshots() });
  res.json({ snapshot });
});

app.delete('/api/snapshots/:id', (req, res) => {
  db.deleteSnapshot(req.params.id);
  broadcast('snapshots', { snapshots: db.listSnapshots() });
  res.json({ ok: true });
});

app.get('/api/export', (_req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="roadmap-${date}.json"`);
  res.json({ format: 'roadmap-anywhere', version: 1, exportedAt: new Date().toISOString(), state: core.state, snapshots: db.listSnapshots() });
});

app.post('/api/import', (req, res) => {
  const target = stateFromExport(req.body);
  const ops = opsToReach(core.state, target);
  if (ops.length === 0) {
    res.json({ changed: 0 });
    return;
  }
  const result = core.submit(ops, { actor: (res.locals.me as Me).name, clientId: null });
  broadcast('reload', { reason: 'import' });
  res.json({ changed: result.changes.length });
});

app.get('/api/events', (req, res) => {
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId.slice(0, 64) : uid();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.set(clientId, { res, clientId, name: (res.locals.me as Me).name });
  send(res, 'hello', { seq: db.lastSeq(), version: version() });
  broadcast('presence', { users: presence() });
  req.on('close', () => {
    // A reconnect with the same clientId may already have replaced this entry.
    if (clients.get(clientId)?.res === res) clients.delete(clientId);
    broadcast('presence', { users: presence() });
  });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof OpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

// --- client ---------------------------------------------------------------------------

if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = join(ROOT, 'dist', 'client');
  if (existsSync(join(dist, 'index.html'))) {
    // Built scripts and styles carry a hash of their content in the name, so a browser can keep them for good.
    // index.html (and anything else) is checked on every load, so a deploy is picked up at once.
    app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(dist, { index: false, maxAge: 0 }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(dist, 'index.html'));
    });
  } else {
    console.warn('No client build found, so only the API is served. Run `npm run build` (or use `npm run dev`).');
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.status(503).type('text').send('The roadmap app has not been built yet. Run `npm run build`, then restart the server.');
    });
  }
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Roadmap running on http://localhost:${PORT}${DEV ? ' (development)' : ''}`);
  if (AUTH_HEADER) console.log(`Identity is taken from the "${AUTH_HEADER}" header.`);
});

function shutdown() {
  for (const c of clients.values()) c.res.end();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
