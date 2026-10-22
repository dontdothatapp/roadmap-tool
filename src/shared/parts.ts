import { PHASES, type ID, type Item, type Op, type Outcome, type RoadmapState } from './types.ts';
import { uid } from './util.ts';

// An initiative can be split into parts: smaller initiatives the team plans one by one (iterations, releases,
// parallel streams) under one umbrella that holds the shared title, outcome and one-pager. Leadership reads the
// umbrella, whose dates come from its parts; the team view shows the parts. One level only: parts have no parts.

const indexes = new WeakMap<RoadmapState, Map<ID, Item[]>>();
const rolled = new WeakMap<RoadmapState, RoadmapState>();

/** umbrella id → its parts, in date order (unscheduled last). Links to a missing umbrella, or to a part, don't count. */
export function partsIndex(state: RoadmapState): Map<ID, Item[]> {
  let index = indexes.get(state);
  if (index) return index;
  index = new Map();
  for (const item of Object.values(state.items)) {
    const parent = item.parentId ? state.items[item.parentId] : undefined;
    if (!parent || parent.parentId || parent.id === item.id) continue;
    index.set(parent.id, [...(index.get(parent.id) ?? []), item]);
  }
  for (const list of index.values()) list.sort((a, b) => startOf(a) - startOf(b) || a.order - b.order);
  indexes.set(state, index);
  return index;
}

function startOf(item: Item): number {
  const starts = PHASES.map((p) => item.phases[p]?.start).filter((s): s is string => !!s).sort();
  return starts.length ? Date.parse(starts[0]) : Number.MAX_SAFE_INTEGER;
}

export function partsOf(state: RoadmapState, id: ID): Item[] {
  return partsIndex(state).get(id) ?? [];
}

export function hasParts(state: RoadmapState, id: ID): boolean {
  return partsIndex(state).has(id);
}

/** The umbrella an item is a part of, if that link is valid. */
export function umbrellaOf(state: RoadmapState, item: Item): Item | null {
  const parent = item.parentId ? state.items[item.parentId] : undefined;
  return parent && !parent.parentId && parent.id !== item.id ? parent : null;
}

/** Each phase from the earliest start to the latest end among the parts that have it. */
export function unionPhases(parts: Item[]): Item['phases'] {
  const out: Item['phases'] = {};
  for (const p of PHASES) {
    for (const part of parts) {
      const span = part.phases[p];
      if (!span) continue;
      const cur = out[p];
      out[p] = cur ? { start: span.start < cur.start ? span.start : cur.start, end: span.end > cur.end ? span.end : cur.end } : { ...span };
    }
  }
  return out;
}

/**
 * The roadmap as leadership reads it: every umbrella gets the dates of its parts. (The parts are still in it;
 * views that show umbrellas leave them out with `isPart`.)
 */
export function rollUp(state: RoadmapState): RoadmapState {
  const cached = rolled.get(state);
  if (cached) return cached;
  const index = partsIndex(state);
  let out = state;
  if (index.size > 0) {
    const items = { ...state.items };
    for (const [id, parts] of index) items[id] = { ...items[id], phases: unionPhases(parts) };
    out = { ...state, items };
    // The rolled-up state keeps the same umbrella/part links.
    indexes.set(out, index);
  }
  rolled.set(state, out);
  rolled.set(out, out);
  return out;
}

/** True for a part whose umbrella exists: views that show umbrellas leave it out. */
export function isPart(state: RoadmapState, item: Item): boolean {
  return umbrellaOf(state, item) !== null;
}

/** The umbrella name to show with a part's own ("One-click checkout" above "Core flow"), unless the name already starts with it. */
export function partLabel(umbrella: Item, part: Item): { prefix: string | null; title: string } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return norm(part.title).startsWith(norm(umbrella.title)) ? { prefix: null, title: part.title } : { prefix: umbrella.title, title: part.title };
}

/**
 * Makes `part` a part of `umbrella`. The one-pager belongs to the umbrella: the part's own moves up when the
 * umbrella has none, and otherwise stays with the part as one of its links (so nothing is lost).
 */
export function linkOps(part: Item, umbrella: Item): Op[] {
  const patch: Partial<Item> = { parentId: umbrella.id };
  const ops: Op[] = [];
  if (part.onePagerUrl) {
    patch.onePagerUrl = '';
    if (!umbrella.onePagerUrl) ops.push({ kind: 'update', entity: 'item', id: umbrella.id, patch: { onePagerUrl: part.onePagerUrl } });
    else if (part.onePagerUrl !== umbrella.onePagerUrl) patch.links = [...part.links, { id: uid(), label: 'One-pager (this part)', url: part.onePagerUrl }];
  }
  return [{ kind: 'update', entity: 'item', id: part.id, patch }, ...ops];
}

/** The one-pager that applies to an item: a part's is its umbrella's. */
export function onePagerOf(state: RoadmapState, item: Item): { url: string; from: Item | null } {
  const umbrella = umbrellaOf(state, item);
  if (umbrella?.onePagerUrl) return { url: umbrella.onePagerUrl, from: umbrella };
  return { url: item.onePagerUrl, from: null };
}

/**
 * The expected outcomes linked to an item, each with the initiative that holds it: for a part, its umbrella's
 * (shared by all its parts) and then its own; for an umbrella, its own and then its parts'. Counted once each in
 * roll-ups (by the initiative that holds it); this is for showing them together.
 */
export function linkedOutcomes(state: RoadmapState, item: Item): { owner: Item; outcome: Outcome }[] {
  const own = item.outcomes.map((outcome) => ({ owner: item, outcome }));
  const umbrella = umbrellaOf(state, item);
  if (umbrella) return [...umbrella.outcomes.map((outcome) => ({ owner: umbrella, outcome })), ...own];
  return [...own, ...partsOf(state, item.id).flatMap((part) => part.outcomes.map((outcome) => ({ owner: part, outcome })))];
}
