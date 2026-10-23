import { deliverySpan } from './sprints.ts';
import type { SprintCalendar } from './sprints.ts';
import type { ID, Item, RoadmapState, Status } from './types.ts';
import { stableEqual } from './util.ts';

export interface ItemDiff {
  id: ID;
  kind: 'added' | 'removed' | 'changed';
  /** The item as it is now (or as it was, for removed items). */
  item: Item;
  previous: Item | null;
  /** Sprints the delivery date moved: positive = later (slipped), negative = earlier. */
  slip: number;
  statusChange: { from: Status; to: Status } | null;
  teamChanged: boolean;
  fieldsChanged: string[];
}

export interface RoadmapDiff {
  items: ItemDiff[];
  byId: Map<ID, ItemDiff>;
  added: number;
  removed: number;
  slipped: number;
  pulledIn: number;
  statusChanges: number;
  /** Initiatives whose expected outcomes changed. */
  outcomeChanges: number;
  totalSlip: number;
}

function slipBetween(a: Item, b: Item, cal: SprintCalendar): number {
  const sa = deliverySpan(a);
  const sb = deliverySpan(b);
  if (!sa || !sb) return 0;
  return cal.spanIndexes(sb)[1] - cal.spanIndexes(sa)[1];
}

/** Layout (order, row, height, board colour) and fields no longer shown (star, per-item owner, tags) don’t count as changes. */
const IGNORED = new Set<keyof Item>(['order', 'row', 'tall', 'color', 'key', 'owner', 'tags']);

/** What changed between two versions of the roadmap (`from` → `to`). */
export function diffStates(from: RoadmapState, to: RoadmapState, cal: SprintCalendar): RoadmapDiff {
  const items: ItemDiff[] = [];
  for (const item of Object.values(to.items)) {
    const prev = from.items[item.id];
    if (!prev) {
      items.push({ id: item.id, kind: 'added', item, previous: null, slip: 0, statusChange: null, teamChanged: false, fieldsChanged: [] });
      continue;
    }
    if (stableEqual(prev, item)) continue;
    const fieldsChanged = (Object.keys(item) as (keyof Item)[]).filter((k) => !IGNORED.has(k) && !stableEqual(prev[k], item[k]));
    if (fieldsChanged.length === 0) continue;
    items.push({
      id: item.id,
      kind: 'changed',
      item,
      previous: prev,
      slip: slipBetween(prev, item, cal),
      statusChange: prev.status !== item.status ? { from: prev.status, to: item.status } : null,
      teamChanged: prev.teamId !== item.teamId,
      fieldsChanged,
    });
  }
  for (const prev of Object.values(from.items)) {
    if (!to.items[prev.id]) {
      items.push({ id: prev.id, kind: 'removed', item: prev, previous: prev, slip: 0, statusChange: null, teamChanged: false, fieldsChanged: [] });
    }
  }
  const order = { removed: 0, added: 1, changed: 2 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.slip) - Math.abs(a.slip) || a.item.title.localeCompare(b.item.title));
  return {
    items,
    byId: new Map(items.map((d) => [d.id, d])),
    added: items.filter((d) => d.kind === 'added').length,
    removed: items.filter((d) => d.kind === 'removed').length,
    slipped: items.filter((d) => d.slip > 0).length,
    pulledIn: items.filter((d) => d.slip < 0).length,
    statusChanges: items.filter((d) => d.statusChange).length,
    outcomeChanges: items.filter((d) => d.fieldsChanged.includes('outcomes')).length,
    totalSlip: items.reduce((s, d) => s + Math.max(0, d.slip), 0),
  };
}
