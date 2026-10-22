// Compares zoom and horizontal-scroll frame times under a few CSS and event-handling variants, injected
// into the running app (no code change needed). Needs a server with the --big data from measure-ui.mjs:
//   BASE=http://localhost:3721 node scripts/perf/zoom-variants.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:3721';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const VARIANTS = {
  'baseline': { css: '', throttle: false },
  'no left/width transitions': { css: '.tl-item,.tl-seg{transition:none!important}', throttle: false },
  'rAF-throttled wheel zoom': { css: '', throttle: true },
  'throttle + no transitions': { css: '.tl-item,.tl-seg{transition:none!important}', throttle: true },
  'throttle + no transitions + contain': { css: '.tl-item,.tl-seg{transition:none!important} .tl-item{contain:layout paint}', throttle: true },
  'labels not sticky (scroll test)': { css: '.tl-text-in{position:static!important}', throttle: false },
};
const stats = (frames) => { const s = [...frames].sort((a, b) => a - b); const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))]?.toFixed(0); return `frames ${String(frames.length).padStart(3)} p50 ${p(0.5)} p95 ${p(0.95)} max ${p(1)} ms  >50ms: ${frames.filter((f) => f > 50).length}`; };
for (const [name, v] of Object.entries(VARIANTS)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('roadmap-anywhere-prefs-v1', JSON.stringify({ name: 'Test', prefsVersion: 2 })));
  await ctx.addInitScript((v) => {
    document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = v.css; document.head.appendChild(st); });
    if (v.throttle) {
      // Prototype of the fix: let at most one ctrl+wheel reach the timeline per animation frame, with the deltas summed.
      let pending = 0, target = null, scheduled = false, synthetic = false;
      document.addEventListener('wheel', (e) => {
        if (synthetic || !e.ctrlKey) return;
        e.preventDefault(); e.stopImmediatePropagation(); pending += e.deltaY; target = e;
        if (scheduled) return; scheduled = true;
        requestAnimationFrame(() => { scheduled = false; synthetic = true; target.target.dispatchEvent(new WheelEvent('wheel', { deltaY: pending, ctrlKey: true, bubbles: true, cancelable: true, clientX: target.clientX, clientY: target.clientY })); synthetic = false; pending = 0; });
      }, { capture: true, passive: false });
    }
    window.__frames = []; let last = null; let on = false;
    window.__startFrames = () => { window.__frames = []; last = performance.now(); on = true; const tick = () => { if (!on) return; const t = performance.now(); window.__frames.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); };
    window.__stopFrames = () => { on = false; return window.__frames; };
  }, v);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#leadership`); await page.waitForSelector('.tl-item'); await page.waitForTimeout(800);
  const body = await page.locator('.tl-body').boundingBox();
  await page.mouse.move(body.x + 400, body.y + 100);
  await page.evaluate(() => window.__startFrames());
  const t0 = Date.now();
  await page.keyboard.down('Control'); for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -30); await page.waitForTimeout(16); } await page.keyboard.up('Control'); await page.waitForTimeout(300);
  const wall = Date.now() - t0;
  const zoom = await page.evaluate(() => window.__stopFrames());
  // Horizontal scroll: 60 steps of 20 px, one per frame.
  const scroll = await page.evaluate(async () => { const el = document.querySelector('.tl'); window.__startFrames(); for (let i = 0; i < 60; i++) { el.scrollLeft += 20; await new Promise((r) => requestAnimationFrame(r)); } return window.__stopFrames(); });
  console.log(`${name.padEnd(38)} ZOOM wall ${wall} ms ${stats(zoom)}   | SCROLL ${stats(scroll)}`);
  await ctx.close();
}
await browser.close();
