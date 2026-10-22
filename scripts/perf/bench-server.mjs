// Fills the history with ~1.8k changes (unique actors, so nothing coalesces) and times the API.
// Point it at a throwaway server, never at real data:  BASE=http://localhost:3721 node scripts/perf/bench-server.mjs
const BASE = process.env.BASE ?? 'http://localhost:3721';
const H = (name) => ({ 'content-type': 'application/json', 'x-user-name': name });
const stats = (arr) => { const s = [...arr].sort((a, b) => a - b); const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); return `p50 ${p(0.5)} p95 ${p(0.95)} max ${p(1)} ms (n=${s.length})`; };
const timeIt = async (fn) => { const t0 = performance.now(); const r = await fn(); return [performance.now() - t0, r]; };
const boot = await (await fetch(`${BASE}/api/bootstrap`)).json();
const ids = Object.keys(boot.state.items);
const since = new Date().toISOString();
// 1-op updates, unique actor each so nothing coalesces: fills the changes table.
const t1 = [];
for (let i = 0; i < 1500; i++) { const [ms, r] = await timeIt(() => fetch(`${BASE}/api/ops`, { method: 'POST', headers: H(`a${i}`), body: JSON.stringify({ ops: [{ kind: 'update', entity: 'item', id: ids[i % ids.length], patch: { description: `d${i}` } }] }) })); if (!r.ok) throw new Error(await r.text()); t1.push(ms); }
console.log('POST /api/ops, 1 op           ', stats(t1));
const t100 = [];
for (let i = 0; i < 10; i++) { const ops = ids.slice(0, 100).map((id) => ({ kind: 'update', entity: 'item', id, patch: { row: i % 3 } })); const [ms] = await timeIt(() => fetch(`${BASE}/api/ops`, { method: 'POST', headers: H(`b${i}`), body: JSON.stringify({ ops }) })); t100.push(ms); }
console.log('POST /api/ops, 100-op batch   ', stats(t100));
const t1c = [];
for (let i = 0; i < 300; i++) { const [ms] = await timeIt(() => fetch(`${BASE}/api/ops`, { method: 'POST', headers: H('same-person'), body: JSON.stringify({ ops: [{ kind: 'update', entity: 'item', id: ids[0], patch: { description: `c${i}` } }] }) })); t1c.push(ms); }
console.log('POST /api/ops, 1 op coalesced ', stats(t1c));
const changesCount = (await (await fetch(`${BASE}/api/changes?limit=1`)).json()).changes[0].seq;
console.log('changes rows (seq):', changesCount);
const ts = [], tb = [], tc = [], tca = [];
for (let i = 0; i < 20; i++) {
  tb.push((await timeIt(() => fetch(`${BASE}/api/bootstrap`).then((r) => r.text())))[0]);
  ts.push((await timeIt(() => fetch(`${BASE}/api/state?at=${encodeURIComponent(since)}`).then((r) => r.text())))[0]);
  tc.push((await timeIt(() => fetch(`${BASE}/api/changes?entityId=${ids[5]}&limit=50`).then((r) => r.text())))[0]);
  tca.push((await timeIt(() => fetch(`${BASE}/api/changes?limit=200`).then((r) => r.text())))[0]);
}
console.log('GET /api/bootstrap            ', stats(tb));
console.log('GET /api/state?at=<2k changes>', stats(ts));
console.log('GET /api/changes?entityId=    ', stats(tc));
console.log('GET /api/changes?limit=200    ', stats(tca));
