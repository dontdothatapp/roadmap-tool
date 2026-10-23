import { describe, expect, it } from 'vitest';
import { BOARD_COLORS, DEFAULT_BOARD_COLOR, boardColorOf, pinUmbrellaColors, umbrellaColors } from '../src/shared/colors.ts';
import { applyOps, emptyState } from '../src/shared/engine.ts';
import type { Item, Op, RoadmapState } from '../src/shared/types.ts';

const create = (id: string, data: Partial<Item> = {}): Op => ({ kind: 'create', entity: 'item', id, data: { title: id, teamId: 't', ...data } });
const apply = (s: RoadmapState, ops: Op[]) => applyOps(s, ops).state;

describe('team board colours', () => {
  const base = apply(emptyState(), [
    create('solo'),
    create('picked', { color: 'sky' }),
    create('a'),
    create('a1', { parentId: 'a' }),
    create('b'),
    create('b1', { parentId: 'b' }),
    create('b2', { parentId: 'b' }),
  ]);

  it('gives initiatives on their own the default, or the colour picked for them', () => {
    expect(boardColorOf(base, base.items.solo).id).toBe(DEFAULT_BOARD_COLOR);
    expect(boardColorOf(base, base.items.picked).id).toBe('sky');
  });

  it('gives each umbrella its own colour, worn by all its parts', () => {
    const colors = umbrellaColors(base);
    expect(colors.get('a')).not.toBe(colors.get('b'));
    expect(colors.get('a')).not.toBe(DEFAULT_BOARD_COLOR);
    expect(boardColorOf(base, base.items.b1).id).toBe(colors.get('b'));
    expect(boardColorOf(base, base.items.b2).id).toBe(colors.get('b'));
    expect(boardColorOf(base, base.items.a).id).toBe(colors.get('a'));
  });

  it('pins a colour on an umbrella when it forms, one no other umbrella uses', () => {
    const next = apply(base, [create('c'), create('c1', { parentId: 'c' })]);
    const ops = pinUmbrellaColors(base, next);
    expect(ops).toHaveLength(1);
    const pinned = (ops[0] as { patch: Partial<Item> }).patch.color!;
    expect([...umbrellaColors(base).values(), DEFAULT_BOARD_COLOR]).not.toContain(pinned);
    // The other umbrellas keep theirs.
    const after = apply(next, ops);
    expect(umbrellaColors(after).get('a')).toBe(umbrellaColors(base).get('a'));
    expect(umbrellaColors(after).get('b')).toBe(umbrellaColors(base).get('b'));
    expect(boardColorOf(after, after.items.c1).id).toBe(pinned);
    // Nothing new formed: nothing to pin.
    expect(pinUmbrellaColors(after, apply(after, [create('d')]))).toEqual([]);
  });

  it('has a deeper shade of each colour for umbrella tags, readable on white', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const c of BOARD_COLORS) expect(1.05 / (luminance(c.ink) + 0.05), c.id).toBeGreaterThanOrEqual(4.5);
  });

  it('drops colours it does not know', () => {
    expect(apply(base, [create('odd', { color: 'chartreuse-ish' })]).items.odd.color).toBeNull();
  });
});
