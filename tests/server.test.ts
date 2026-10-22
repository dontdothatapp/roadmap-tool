import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Starts the real server against a throwaway database and talks to it over HTTP.

interface Server {
  url: string;
  proc: ChildProcess;
  dir: string;
}

async function start(env: Record<string, string>): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-test-'));
  const port = 4100 + Math.floor(Math.random() * 800);
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server/index.ts'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, SEED: 'empty', ...env },
    stdio: 'pipe',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url, proc, dir };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('server did not start');
}

function stop(s: Server) {
  s.proc.kill();
  rmSync(s.dir, { recursive: true, force: true });
}

const json = (body: unknown, name = 'Ada Lovelace') => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-User-Name': encodeURIComponent(name) },
  body: JSON.stringify(body),
});

describe('API', () => {
  let s: Server;
  beforeAll(async () => {
    s = await start({});
  });
  afterAll(() => stop(s));

  it('starts empty with default settings', async () => {
    const boot = await (await fetch(`${s.url}/api/bootstrap`)).json();
    expect(Object.keys(boot.state.items)).toHaveLength(0);
    expect(boot.state.settings.sprints.pattern).toHaveLength(3);
    expect(boot.me.managed).toBe(false);
  });

  it('applies changes, records who made them and rebuilds the past', async () => {
    const res = await fetch(
      `${s.url}/api/ops`,
      json({
        ops: [
          { kind: 'create', entity: 'team', id: 'core', data: { name: 'Core', color: '#4f5bd5' } },
          {
            kind: 'create',
            entity: 'item',
            id: 'first',
            data: { title: 'First', teamId: 'core', onePagerUrl: 'javascript:alert(1)', phases: { implementation: { start: '2026-10-08', end: '2026-10-22' } } },
          },
        ],
        clientId: 'test',
      }),
    );
    expect(res.status).toBe(200);
    const batch = await res.json();
    expect(batch.changes).toHaveLength(2);
    expect(batch.changes[0].actor).toBe('Ada Lovelace');
    expect(batch.updates[1].value.onePagerUrl).toBe('');

    const midpoint = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    await fetch(`${s.url}/api/ops`, json({ ops: [{ kind: 'update', entity: 'item', id: 'first', patch: { title: 'Renamed' } }] }, 'Grace Hopper'));

    const now = await (await fetch(`${s.url}/api/bootstrap`)).json();
    expect(now.state.items.first.title).toBe('Renamed');
    const past = await (await fetch(`${s.url}/api/state?at=${encodeURIComponent(midpoint)}`)).json();
    expect(past.state.items.first.title).toBe('First');
    const before = await (await fetch(`${s.url}/api/state?at=2000-01-01T00:00:00Z`)).json();
    expect(Object.keys(before.state.items)).toHaveLength(0);

    const { changes } = await (await fetch(`${s.url}/api/changes?entityId=first`)).json();
    expect(changes.map((c: { actor: string }) => c.actor)).toEqual(['Grace Hopper', 'Ada Lovelace']);
  });

  it('rejects malformed changes without applying any of them', async () => {
    const res = await fetch(
      `${s.url}/api/ops`,
      json({
        ops: [
          { kind: 'update', entity: 'item', id: 'first', patch: { title: 'Should not stick' } },
          { kind: 'update', entity: 'item', id: 'missing', patch: { title: 'x' } },
        ],
      }),
    );
    expect(res.status).toBe(409);
    const boot = await (await fetch(`${s.url}/api/bootstrap`)).json();
    expect(boot.state.items.first.title).toBe('Renamed');
    expect((await fetch(`${s.url}/api/ops`, json({ ops: [{ kind: 'explode', entity: 'item', id: 'a' }] }))).status).toBe(400);
  });

  it('saves and deletes snapshots', async () => {
    const created = await (await fetch(`${s.url}/api/snapshots`, json({ name: 'Baseline' }))).json();
    expect(created.snapshot.name).toBe('Baseline');
    const list = await (await fetch(`${s.url}/api/snapshots`)).json();
    expect(list.snapshots).toHaveLength(1);
    await fetch(`${s.url}/api/snapshots/${created.snapshot.id}`, { method: 'DELETE' });
    expect((await (await fetch(`${s.url}/api/snapshots`)).json()).snapshots).toHaveLength(0);
  });

  it('exports and re-imports', async () => {
    const exported = await (await fetch(`${s.url}/api/export`)).json();
    exported.state.items.first.title = 'Imported title';
    const res = await (await fetch(`${s.url}/api/import`, json(exported))).json();
    expect(res.changed).toBe(1);
    const boot = await (await fetch(`${s.url}/api/bootstrap`)).json();
    expect(boot.state.items.first.title).toBe('Imported title');
  });
});

/** Opens the live stream the way a browser tab does, and collects what arrives. */
async function listen(url: string, clientId: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${url}/api/events?clientId=${clientId}&name=Ada`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  let text = '';
  const pump = (async () => {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    } catch {
      // aborted
    }
  })();
  const events = () => [...text.matchAll(/event: (\w+)\ndata: (.*)\n\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) }));
  return { ctrl, pump, received: () => text, events };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('live updates', () => {
  let s: Server;
  beforeAll(async () => {
    s = await start({});
  });
  afterAll(() => stop(s));

  it('keeps delivering to a client that reconnected before its old connection closed', async () => {
    const open = () => listen(s.url, 'same');
    const first = await open();
    const second = await open();
    await new Promise((r) => setTimeout(r, 100));
    first.ctrl.abort();
    await new Promise((r) => setTimeout(r, 150));
    await fetch(`${s.url}/api/ops`, json({ ops: [{ kind: 'create', entity: 'team', id: 'live', data: { name: 'Live' } }] }));
    await new Promise((r) => setTimeout(r, 150));
    expect(second.received()).toContain('event: batch');
    second.ctrl.abort();
  });

  it('tells a client that connects whether it has missed anything since it loaded', async () => {
    const version = async () => (await (await fetch(`${s.url}/api/bootstrap`)).json()).version as string;
    await fetch(`${s.url}/api/ops`, json({ ops: [{ kind: 'create', entity: 'team', id: 'back', data: { name: 'Back' } }] }, 'Grace Hopper'));
    const loaded = await version();
    const tab = await listen(s.url, 'tab');
    await pause(100);
    // Nothing happened since loading: the stream says the same version, so the tab needn't load again.
    expect(tab.events().find((e) => e.event === 'hello')?.data.version).toBe(loaded);

    await fetch(`${s.url}/api/ops`, json({ ops: [{ kind: 'update', entity: 'team', id: 'back', patch: { name: 'Back 2' } }] }));
    await pause(150);
    const batch = tab.events().find((e) => e.event === 'batch');
    expect(batch?.data.version).not.toBe(loaded);
    expect(batch?.data.version).toBe(await version());
    tab.ctrl.abort();

    // While the tab is away, an edit back to where it was: history keeps no trace of it, the version still moves.
    const seqBefore = (await (await fetch(`${s.url}/api/bootstrap`)).json()).seq;
    await fetch(`${s.url}/api/ops`, json({ ops: [{ kind: 'update', entity: 'team', id: 'back', patch: { name: 'Back' } }] }));
    expect((await (await fetch(`${s.url}/api/bootstrap`)).json()).seq).toBeLessThan(seqBefore);
    const back = await listen(s.url, 'tab');
    await pause(100);
    expect(back.events().find((e) => e.event === 'hello')?.data.version).not.toBe(batch?.data.version);
    back.ctrl.abort();
  });
});

describe('API behind a sign-in proxy', () => {
  let s: Server;
  beforeAll(async () => {
    s = await start({ AUTH_HEADER: 'X-Forwarded-Email' });
  });
  afterAll(() => stop(s));

  it('requires the identity header and records it as the author', async () => {
    expect((await fetch(`${s.url}/api/bootstrap`)).status).toBe(401);
    const headers = { 'Content-Type': 'application/json', 'X-Forwarded-Email': 'anna.kowalski@example.com', 'X-User-Name': 'Someone Else' };
    const boot = await (await fetch(`${s.url}/api/bootstrap`, { headers })).json();
    expect(boot.me).toEqual({ name: 'anna.kowalski@example.com', managed: true });
    const batch = await (
      await fetch(`${s.url}/api/ops`, { method: 'POST', headers, body: JSON.stringify({ ops: [{ kind: 'create', entity: 'team', id: 't', data: { name: 'T' } }] }) })
    ).json();
    expect(batch.changes[0].actor).toBe('anna.kowalski@example.com');
  });
});
