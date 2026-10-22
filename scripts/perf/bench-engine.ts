// Micro-benchmark of the shared engine and the timeline layout maths at 300, 1000 and 3000 initiatives.
// Run: node --disable-warning=ExperimentalWarning scripts/perf/bench-engine.ts
// See docs/PERFORMANCE.md for the numbers this gave and what they mean.
import { applyOps, applyUpdates, stateFromEntities, entitiesOf, invertOps, normalizeItem } from '../../src/shared/engine.ts';
import { generateDemo } from '../../src/shared/seed.ts';
import { pack, geometry, makeScale, metricsFor, timelineRange } from '../../src/client/timeline/geometry.ts';
import { groupsFor, umbrellaItems, applyFilters } from '../../src/client/lib/model.ts';
import { rollUp, partsIndex } from '../../src/shared/parts.ts';
import { diffStates } from '../../src/shared/diff.ts';
import { calendarFor } from '../../src/shared/sprints.ts';
import { todayDay, fromDay } from '../../src/shared/dates.ts';
import type { Item, Op, RoadmapState } from '../../src/shared/types.ts';

const demo = generateDemo();
const teams = Object.keys(demo.state.teams);
const tracks = Object.keys(demo.state.tracks);
const cal = calendarFor(demo.state.settings.sprints);
const today = todayDay();

function bigState(n: number): RoadmapState {
  let s = demo.state;
  const items = { ...s.items };
  const now = cal.indexOf(today);
  for (let k = 0; k < n; k++) {
    const id = `big${k}`;
    const a = now + ((k * 7) % 40) - 10;
    const umbrella = k % 5 === 0;
    const parentId = k % 5 !== 0 && k % 5 !== 4 ? `big${k - (k % 5)}` : null;
    items[id] = normalizeItem({
      title: `Initiative ${k} with a fairly long name`, teamId: teams[k % teams.length], trackId: tracks[k % tracks.length], tags: [`tag${k % 7}`],
      status: 'planned', description: 'x'.repeat(200),
      phases: umbrella ? {} : { discovery: cal.spanFromIndexes(a, a + 1), ux: cal.spanFromIndexes(a + 1, a + 2), implementation: cal.spanFromIndexes(a + 2, a + 3 + (k % 3)) },
      outcomes: [{ id: `o${k}`, stageId: 'mid', impact: 1, unit: '%', ramp: [50], landsBy: null }],
      dependencies: k % 3 === 0 && k > 0 ? [{ id: `d${k}`, itemId: `big${k - 1}`, status: 'open', note: '' }] : [],
      order: k, row: k % 20, parentId,
    }, id);
  }
  return { ...s, items };
}

function time(label: string, fn: () => unknown, runs = 5) {
  fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  console.log(label.padEnd(58), ((performance.now() - t0) / runs).toFixed(2).padStart(8), 'ms');
}

for (const n of [0, 300, 1000, 3000]) {
  const state = bigState(n);
  const count = Object.keys(state.items).length;
  console.log(`\n=== ${count} items ===`);
  time('stateFromEntities (server boot / demo load)', () => stateFromEntities(entitiesOf(state)), 3);
  const rolledFresh = () => { const copy = { ...state, items: { ...state.items } }; return rollUp(copy); };
  time('rollUp (fresh state object)', rolledFresh);
  const rolled = rollUp(state);
  const filters = { q: '', teams: [], tracks: [], statuses: [], tags: [] };
  time('umbrellaItems, no query', () => umbrellaItems(rolled, filters));
  time('umbrellaItems, query "init 7"', () => umbrellaItems(rolled, { ...filters, q: 'init 7' }));
  const items = umbrellaItems(rolled, filters);
  const { groups, groupsOf } = groupsFor(rolled, 'track', items);
  const range = timelineRange(rolled, today);
  const scale = makeScale(range.start, range.end, 2.4);
  const metrics = metricsFor('packed');
  time('pack (packed, by track)', () => pack(items, groups, groupsOf, 'packed', 'combined', scale));
  const packing = pack(items, groups, groupsOf, 'packed', 'combined', scale);
  const expand = new Map<string, Item[]>();
  for (const [id, parts] of partsIndex(rolled)) expand.set(id, parts);
  time('pack with every umbrella open', () => pack(items, groups, groupsOf, 'packed', 'combined', scale, { expand }));
  time('geometry', () => geometry(packing, scale, metrics, 'packed', 'combined', new Set(), false, null));
  time('geometry with 1 override (each drag frame)', () => geometry(packing, scale, metrics, 'packed', 'combined', new Set(), false, new Map([[items[0].id, items[0]]])));
  const teamItems = Object.values(state.items).filter((i) => i.teamId === teams[0]);
  const tg = groupsFor(state, 'none', teamItems);
  time(`pack (team board, ${teamItems.length} items)`, () => pack(teamItems, tg.groups, tg.groupsOf, 'list', 'separate', makeScale(range.start, range.end, 9), { board: true }));
  const ids = Object.keys(state.items);
  const ops: Op[] = ids.slice(0, 100).map((id) => ({ kind: 'update', entity: 'item', id, patch: { row: 3 } }));
  time('applyOps, 100-op batch (board row pins)', () => applyOps(state, ops));
  time('invertOps, 100-op batch', () => invertOps(state, ops));
  const one: Op[] = [{ kind: 'update', entity: 'item', id: ids[0], patch: { title: 'x' } }];
  time('applyOps, 1 op', () => applyOps(state, one), 50);
  const updates = ids.slice(0, 100).map((id) => ({ entity: 'item' as const, id, value: state.items[id] }));
  time('applyUpdates, 100 entities (SSE batch)', () => applyUpdates(state, updates));
  const other = { ...state, items: { ...state.items, [ids[0]]: { ...state.items[ids[0]], title: 'changed' } } };
  time('diffStates (compare banner, per render)', () => diffStates(state, other, cal));
  time('JSON.stringify(state) (bootstrap body)', () => JSON.stringify(state));
  console.log('bootstrap bytes', JSON.stringify(state).length);
}
