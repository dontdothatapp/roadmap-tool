import { describe, expect, it } from 'vitest';
import { geometry, makeScale, metricsFor, pack, wantedRows, withOverride } from '../src/client/timeline/geometry.ts';
import type { GroupDef } from '../src/client/lib/model.ts';
import type { Item } from '../src/shared/types.ts';
import { toDay } from '../src/shared/dates.ts';

const scale = makeScale(toDay('2026-09-01'), toDay('2027-06-01'), 4);
const lane: GroupDef[] = [{ id: 'all', label: 'All', color: null }];
let n = 0;
const item = (start: string, end: string, extra: Partial<Item> = {}): Item =>
  ({
    id: `i${++n}`,
    title: `Item ${n}`,
    teamId: 't',
    trackId: null,
    tags: [],
    status: 'planned',
    key: false,
    owner: '',
    description: '',
    phases: { implementation: { start, end } },
    onePagerUrl: '',
    links: [],
    outcomes: [],
    dependencies: [],
    order: n,
    row: null,
    tall: false,
    ...extra,
  }) as Item;
const board = (items: Item[], giveWay: string | null = null) => {
  const p = pack(items, lane, () => ['all'], 'list', 'separate', scale, { board: true, giveWay });
  return Object.fromEntries(p.groups[0].items.map((x) => [x.item.id, x.row]));
};

describe('team board rows', () => {
  it('puts unplaced initiatives one per row, in order, below any placed ones', () => {
    const a = item('2026-10-01', '2026-10-15');
    const b = item('2026-10-15', '2026-10-29');
    const c = item('2026-11-05', '2026-11-19', { row: 1 });
    expect(wantedRows([a, b, c])).toEqual(new Map([[c.id, 1], [a.id, 2], [b.id, 3]]));
  });

  it('treats a missing row (an item from an older version) as not placed', () => {
    const a = item('2026-10-01', '2026-11-19', { row: undefined as unknown as null });
    const b = item('2026-10-15', '2026-12-03', { row: undefined as unknown as null, tall: undefined as unknown as boolean });
    expect(wantedRows([a, b])).toEqual(new Map([[a.id, 0], [b.id, 1]]));
    expect(board([a, b])).toEqual({ [a.id]: 0, [b.id]: 1 });
  });

  it('lets initiatives share a row when their dates do not clash (touching is fine)', () => {
    const a = item('2026-10-01', '2026-10-15', { row: 0 });
    const b = item('2026-10-15', '2026-10-29', { row: 0 });
    expect(board([a, b])).toEqual({ [a.id]: 0, [b.id]: 0 });
  });

  it('moves the one giving way to the next free row without pushing anyone', () => {
    const a = item('2026-10-01', '2026-11-19', { row: 0 });
    const b = item('2026-10-15', '2026-12-03', { row: 1 });
    const moved = item('2026-09-10', '2026-10-29', { row: 0 });
    expect(board([a, b, moved], moved.id)).toEqual({ [a.id]: 0, [b.id]: 1, [moved.id]: 2 });
  });

  it('keeps rows left empty on purpose', () => {
    const a = item('2026-10-01', '2026-10-15', { row: 0 });
    const b = item('2026-10-01', '2026-10-15', { row: 3 });
    expect(board([a, b])).toEqual({ [a.id]: 0, [b.id]: 3 });
  });

  it('gives a tall initiative two rows, moving a clashing one below it down', () => {
    const tall = item('2026-10-01', '2026-11-19', { row: 0, tall: true });
    const under = item('2026-10-15', '2026-10-29', { row: 1 });
    const beside = item('2026-12-03', '2026-12-17', { row: 1 });
    expect(board([tall, under, beside])).toEqual({ [tall.id]: 0, [under.id]: 2, [beside.id]: 1 });
  });

  it('closes up the gaps between rows in a grouped lane', () => {
    const a = item('2026-10-01', '2026-10-15', { row: 2 });
    const b = item('2026-10-01', '2026-10-15', { row: 7 });
    const p = pack([a, b], lane, () => ['all'], 'list', 'separate', scale);
    expect(Object.fromEntries(p.groups[0].items.map((x) => [x.item.id, x.row]))).toEqual({ [a.id]: 0, [b.id]: 1 });
    expect(p.groups[0].rowValues).toEqual([2, 7]);
  });
});

describe('opening an umbrella in packed lanes', () => {
  const lanes = (items: Item[], open: Item[] = [], parts: Record<string, Item[]> = {}) => {
    const expand = new Map(open.map((u) => [u.id, parts[u.id]]));
    const p = pack(items, lane, () => ['all'], 'packed', 'separate', scale, { expand });
    return Object.fromEntries(p.groups[0].items.map((x) => [x.item.id, x.nested ? `${x.row} nested` : x.row]));
  };

  it('keeps the umbrella on its line and moves the lines below it down to make room for its parts', () => {
    const first = item('2026-09-01', '2026-10-01');
    const umbrella = item('2026-10-08', '2026-12-01');
    const beside = item('2026-12-10', '2027-01-20');
    const under = item('2026-09-15', '2026-11-20');
    const lowest = item('2026-10-20', '2027-01-10');
    const a = item('2026-10-08', '2026-11-01', { parentId: umbrella.id });
    const b = item('2026-10-20', '2026-12-01', { parentId: umbrella.id });
    const all = [first, umbrella, beside, under, lowest];
    expect(lanes(all)).toEqual({ [first.id]: 0, [umbrella.id]: 0, [beside.id]: 0, [under.id]: 1, [lowest.id]: 2 });
    expect(lanes(all, [umbrella], { [umbrella.id]: [a, b] })).toEqual({
      [first.id]: 0,
      [umbrella.id]: 0,
      [beside.id]: 0,
      [a.id]: '1 nested',
      [b.id]: '2 nested',
      [under.id]: 3,
      [lowest.id]: 4,
    });
  });

  it('shares the new lines between open umbrellas side by side and stacks the ones below', () => {
    const left = item('2026-09-01', '2026-10-01');
    const right = item('2026-11-01', '2026-12-01');
    const low = item('2026-09-01', '2026-12-01');
    const l1 = item('2026-09-01', '2026-10-01', { parentId: left.id });
    const r1 = item('2026-11-01', '2026-11-20', { parentId: right.id });
    const r2 = item('2026-11-10', '2026-12-01', { parentId: right.id });
    const l2 = item('2026-09-01', '2026-12-01', { parentId: low.id });
    expect(lanes([left, right, low], [left, right, low], { [left.id]: [l1], [right.id]: [r1, r2], [low.id]: [l2] })).toEqual({
      [left.id]: 0,
      [right.id]: 0,
      [l1.id]: '1 nested',
      [r1.id]: '1 nested',
      [r2.id]: '2 nested',
      [low.id]: 3,
      [l2.id]: '4 nested',
    });
  });
});

describe('compact rows (a strategic bet)', () => {
  it('puts an open umbrella’s parts a line each, in date order, even when they would fit side by side', () => {
    const umbrella = item('2026-10-01', '2026-12-01');
    const a = item('2026-10-01', '2026-10-29', { parentId: umbrella.id });
    const b = item('2026-10-29', '2026-12-01', { parentId: umbrella.id });
    const p = pack([umbrella], lane, () => ['all'], 'packed', 'separate', scale, { expand: new Map([[umbrella.id, [a, b]]]), gap: 0, oneEach: true });
    expect(Object.fromEntries(p.groups[0].items.map((x) => [x.item.id, x.row]))).toEqual({ [umbrella.id]: 0, [a.id]: 1, [b.id]: 2 });
  });
});

describe('a bar being dragged', () => {
  it('draws the dragged initiative as geometry with an override would, and keeps every other bar as it was', () => {
    const tags: GroupDef[] = [
      { id: 'a', label: 'A', color: null },
      { id: 'b', label: 'B', color: null },
    ];
    const dragged = item('2026-10-01', '2026-10-29', { tags: ['a', 'b'] });
    const others = [item('2026-10-15', '2026-11-12', { tags: ['a'] }), item('2026-11-12', '2026-12-10', { tags: ['b'] })];
    const items = [dragged, ...others];
    // Shown in two lanes (one per tag), with every phase, so both of its bars and all of its spans move.
    const moved: Item = { ...dragged, phases: { discovery: { start: '2026-10-15', end: '2026-10-29' }, implementation: { start: '2026-10-29', end: '2026-12-10' } } };
    for (const mode of ['packed', 'list'] as const) {
      const m = metricsFor(mode);
      const packing = pack(items, tags, (i) => i.tags, mode, 'separate', scale);
      const layout = geometry(packing, scale, m, mode, 'separate', new Set(), true, null);
      const drawn = withOverride(layout, moved, 'separate', scale);
      expect(drawn).toEqual(geometry(packing, scale, m, mode, 'separate', new Set(), true, new Map([[moved.id, moved]])));
      expect(drawn.blocks.filter((b) => b.item.id !== moved.id)).toEqual(layout.blocks.filter((b) => b.item.id !== moved.id));
      for (const b of drawn.blocks) if (b.item.id !== moved.id) expect(layout.blocks).toContain(b);
      expect(drawn.byId.get(moved.id)?.item).toBe(moved);
      // Nothing to change: the very same layout.
      expect(withOverride(layout, dragged, 'separate', scale)).toBe(layout);
    }
  });
});
