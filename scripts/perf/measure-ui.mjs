// Drives the app in Chromium and reports React commits and frame times for the interactions that matter
// (hover, drag, zoom, filtering, opening the drawer). Needs a running server (see docs/PERFORMANCE.md):
//   BASE=http://localhost:3721 node scripts/perf/measure-ui.mjs [--big] [--notrans]
// --big adds 300 generated initiatives through the API first (idempotent); --notrans disables the bar
// transitions, to see what they cost. CHROMIUM=/path/to/chrome overrides the browser Playwright launches.
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:3720';
const big = process.argv.includes('--big');

if (big) {
  // Add ~300 items through the API so the measurement reflects a mid-sized company roadmap.
  const boot = await (await fetch(`${BASE}/api/bootstrap`)).json();
  if (!boot.state.items.big0) {
    const teams = Object.keys(boot.state.teams), tracks = Object.keys(boot.state.tracks);
    const ops = [];
    const start = new Date(); start.setUTCDate(1);
    const day = (d) => { const x = new Date(Date.UTC(2026, 9, 1 + d)); return x.toISOString().slice(0, 10); };
    for (let k = 0; k < 300; k++) {
      const a = ((k * 7) % 280) - 70;
      const umbrella = k % 5 === 0; const parentId = k % 5 !== 0 && k % 5 !== 4 ? `big${k - (k % 5)}` : null;
      ops.push({ kind: 'create', entity: 'item', id: `big${k}`, data: { title: `Initiative ${k} with a fairly long name`, teamId: teams[k % teams.length], trackId: tracks[k % tracks.length], tags: [`tag${k % 7}`], status: 'planned',
        phases: umbrella ? {} : { discovery: { start: day(a), end: day(a + 14) }, ux: { start: day(a + 14), end: day(a + 28) }, implementation: { start: day(a + 28), end: day(a + 42 + 14 * (k % 3)) } },
        outcomes: [{ id: `o${k}`, stageId: 'mid', impact: 1, unit: '%', ramp: [50], landsBy: null }], order: 1000 + k, row: k % 25, parentId } });
    }
    for (let i = 0; i < ops.length; i += 100) {
      const r = await fetch(`${BASE}/api/ops`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-name': 'bench' }, body: JSON.stringify({ ops: ops.slice(i, i + 100) }) });
      if (!r.ok) throw new Error(await r.text());
    }
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('roadmap-anywhere-prefs-v1', JSON.stringify({ name: 'Test', prefsVersion: 2 }));
  // Count React commits through the DevTools hook (dev build only).
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false, supportsFiber: true, renderers: new Map(), inject() { return 1; }, on() {}, off() {}, emit() {}, sub() {}, 
    onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    checkDCE() {}, 
  };
  // Frame timing: record rAF gaps while a measurement runs. Each run has its own number, so a loop left over
  // from the previous run (its next frame not yet fired when the next run starts) stops instead of doubling up.
  window.__frames = []; let run = 0;
  window.__startFrames = () => { const mine = ++run; window.__frames = []; let last = performance.now(); const tick = () => { if (mine !== run) return; const t = performance.now(); window.__frames.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); };
  window.__stopFrames = () => { run++; return window.__frames; };
});
const page = await ctx.newPage();
if (process.argv.includes('--notrans')) await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.tl-item, .tl-seg { transition: none !important }'; document.head.appendChild(st); }); });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Performance.enable');
// Main-thread time Chrome reports, in ms: what the interaction cost in script, layout and style, frames aside.
const busy = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value * 1000]));
async function profile(label, fn) {
  await cdp.send('Profiler.start');
  await fn();
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const f = n.callFrame; const key = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/(src|node_modules)\//, '$1/').split('?')[0]}:${f.lineNumber}`; self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0)); }
  const total = [...self.values()].reduce((a, b) => a + b, 0) / 1000;
  console.log(`  [profile ${label}] total ${total.toFixed(0)} ms, top self-time:`);
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`     ${(v / 1000).toFixed(1).padStart(7)} ms  ${k}`);
}


async function measure(label, fn) {
  await page.evaluate(() => { window.__commits = 0; window.__startFrames(); });
  const before = await busy();
  const t0 = Date.now();
  await fn();
  const ms = Date.now() - t0;
  const after = await busy();
  const { commits, frames } = await page.evaluate(() => ({ commits: window.__commits, frames: window.__stopFrames() }));
  const cost = (k) => (after[k] - before[k]).toFixed(0);
  const times = (k) => ((after[k] - before[k]) / 1000).toFixed(0);
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]?.toFixed(0);
  const slow = frames.filter((f) => f > 50).length;
  console.log(`${label.padEnd(44)} wall ${String(ms).padStart(5)} ms  commits ${String(commits).padStart(4)}  frames ${String(frames.length).padStart(4)}  p50 ${p(0.5)} p95 ${p(0.95)} max ${p(1)} ms  >50ms: ${slow}  |  script ${cost('ScriptDuration')} layout ${cost('LayoutDuration')} style ${cost('RecalcStyleDuration')} ms (${times('LayoutCount')} layouts)`);
}

// The team view opens on the busiest team's board (with --big data, Checkout: ~67 bars).
const { state } = await (await fetch(`${BASE}/api/bootstrap`)).json();
const perTeam = {};
for (const i of Object.values(state.items)) perTeam[i.teamId] = (perTeam[i.teamId] ?? 0) + 1;
const busiest = Object.entries(perTeam).sort((a, b) => b[1] - a[1])[0]?.[0];
for (const view of ['leadership', `team.${busiest}`]) {
  await page.goto(`${BASE}/#${view}`);
  await page.waitForSelector('.tl-item');
  await page.waitForTimeout(800);
  const n = await page.locator('.tl-item').count();
  console.log(`\n--- #${view}: ${n} bars on screen (${big ? 'big' : 'demo'} data)`);
  const body = await page.locator('.tl-body').boundingBox();
  const bars = await page.locator('.tl-item').evaluateAll((els) => { const v = document.querySelector('.tl').getBoundingClientRect(); return els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; }).filter((b) => b.x > v.left + 200 && b.x < v.right - 20 && b.y > v.top + 80 && b.y < v.bottom - 10).slice(0, 40); });
  await measure('hover sweep over 40 bars', async () => { for (const b of bars) { await page.mouse.move(b.x, b.y); await page.waitForTimeout(16); } await page.mouse.move(body.x + 5, body.y + 5); });
  await measure('hover sweep, 40 bars, no wait', async () => { for (const b of bars) await page.mouse.move(b.x, b.y); await page.mouse.move(body.x + 5, body.y + 5); });
  const b0 = bars[1] ?? bars[0];
  await measure('drag a bar 60 steps (move right 200px)', async () => { await page.mouse.move(b0.x, b0.y); await page.mouse.down(); for (let i = 1; i <= 60; i++) { await page.mouse.move(b0.x + (200 * i) / 60, b0.y); } await page.keyboard.press('Escape'); await page.mouse.up(); });
  const edge = (await page.locator('.tl').boundingBox()).x + (await page.locator('.tl').boundingBox()).width - 16;
  const scrolled = await page.evaluate(() => document.querySelector('.tl').scrollLeft);
  await measure('drag a bar to the right edge, hold 1 s', async () => { await page.mouse.move(b0.x, b0.y); await page.mouse.down(); for (let i = 1; i <= 20; i++) { await page.mouse.move(b0.x + ((edge - b0.x) * i) / 20, b0.y); } await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.mouse.up(); });
  await page.evaluate((x) => { document.querySelector('.tl').scrollLeft = x; }, scrolled);
  await profile('zoom', () => measure('ctrl+wheel zoom, 20 steps', async () => { await page.mouse.move(body.x + 400, body.y + 100); await page.keyboard.down('Control'); for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -30); await page.waitForTimeout(16); } await page.keyboard.up('Control'); await page.waitForTimeout(300); }));
  await profile('filter typing', () => measure('type 5 letters in the filter field', async () => { await page.click('#filter-search'); await page.keyboard.type('initi', { delay: 30 }); await page.waitForTimeout(100); await page.keyboard.press('Escape'); }));
  const b1 = await page.locator('.tl-item').evaluateAll((els) => { const v = document.querySelector('.tl').getBoundingClientRect(); return els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; }).filter((b) => b.x > v.left + 200 && b.x < v.right - 20 && b.y > v.top + 80 && b.y < v.bottom - 10)[0]; });
  await measure('open the drawer on a bar (click)', async () => { await page.mouse.click(b1.x, b1.y); await page.waitForSelector('.drawer'); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(200); });
}
await page.goto(`${BASE}/#history`); await page.waitForSelector('.feed-entry'); 
await measure('history: type 3 letters in search', async () => { await page.click('#history-search'); await page.keyboard.type('ini', { delay: 30 }); await page.waitForTimeout(200); });
await browser.close();
