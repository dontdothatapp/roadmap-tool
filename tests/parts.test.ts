import { describe, expect, it } from 'vitest';
import { applyOps, emptyState } from '../src/shared/engine.ts';
import { hasParts, isPart, linkOps, linkedOutcomes, onePagerOf, partLabel, partsOf, rollUp, umbrellaOf } from '../src/shared/parts.ts';
import type { Item, Op } from '../src/shared/types.ts';

const create = (id: string, data: Partial<Item>): Op => ({ kind: 'create', entity: 'item', id, data: { title: id, teamId: 't', ...data } });
const state = applyOps(emptyState(), [
  create('chat', { title: 'One-click checkout', phases: { implementation: { start: '2026-01-01', end: '2026-01-15' } } }),
  create('disc', { title: 'One-click-checkout: Discovery', parentId: 'chat', phases: { discovery: { start: '2026-04-23', end: '2026-05-14' }, ux: { start: '2026-05-14', end: '2026-05-28' } } }),
  create('core', { title: 'Core flow', parentId: 'chat', phases: { implementation: { start: '2026-05-28', end: '2026-06-11' } } }),
  create('post', { title: 'Post release', parentId: 'chat', phases: { implementation: { start: '2026-07-16', end: '2026-08-27' } } }),
  create('idea', { title: 'Later idea', parentId: 'chat', phases: {} }),
  // A part of a part doesn't count: one level only.
  create('nested', { title: 'Nested', parentId: 'core', phases: { implementation: { start: '2026-09-03', end: '2026-09-17' } } }),
  create('orphan', { title: 'Orphan', parentId: 'gone', phases: {} }),
]).state;

describe('initiative parts', () => {
  it('finds the parts of an umbrella, in date order, one level deep', () => {
    expect(partsOf(state, 'chat').map((p) => p.id)).toEqual(['disc', 'core', 'post', 'idea']);
    expect(hasParts(state, 'core')).toBe(false);
    expect(umbrellaOf(state, state.items.nested)).toBeNull();
    expect(umbrellaOf(state, state.items.orphan)).toBeNull();
    expect(isPart(state, state.items.disc)).toBe(true);
  });

  it('gives an umbrella the dates of its parts, phase by phase', () => {
    const rolled = rollUp(state);
    expect(rolled.items.chat.phases).toEqual({
      discovery: { start: '2026-04-23', end: '2026-05-14' },
      ux: { start: '2026-05-14', end: '2026-05-28' },
      implementation: { start: '2026-05-28', end: '2026-08-27' },
    });
    // Parts and everything else are untouched; rolling up twice changes nothing.
    expect(rolled.items.core).toBe(state.items.core);
    expect(rollUp(rolled)).toBe(rolled);
    expect(state.items.chat.phases.implementation?.start).toBe('2026-01-01');
  });

  it('puts the umbrella in front of a part’s name unless it already starts with it', () => {
    expect(partLabel(state.items.chat, state.items.core)).toEqual({ prefix: 'One-click checkout', title: 'Core flow' });
    expect(partLabel(state.items.chat, state.items.disc).prefix).toBeNull();
  });

  it('never makes an item its own umbrella', () => {
    const self = applyOps(emptyState(), [create('x', { parentId: 'x' })]).state;
    expect(self.items.x.parentId).toBeNull();
  });

  it('shares the umbrella’s one-pager with its parts, moving a part’s own up when the umbrella has none', () => {
    const base = applyOps(emptyState(), [
      create('u', { title: 'Umbrella' }),
      create('p', { title: 'Part', onePagerUrl: 'https://docs.example.com/part', links: [] }),
      create('u2', { title: 'Umbrella with doc', onePagerUrl: 'https://docs.example.com/umbrella' }),
    ]).state;
    const moved = applyOps(base, linkOps(base.items.p, base.items.u)).state;
    expect(moved.items.u.onePagerUrl).toBe('https://docs.example.com/part');
    expect(moved.items.p.onePagerUrl).toBe('');
    expect(onePagerOf(moved, moved.items.p)).toEqual({ url: 'https://docs.example.com/part', from: moved.items.u });
    // The umbrella already has one: the part's stays with it, as a link.
    const kept = applyOps(base, linkOps(base.items.p, base.items.u2)).state;
    expect(kept.items.u2.onePagerUrl).toBe('https://docs.example.com/umbrella');
    expect(kept.items.p.links.map((l) => [l.label, l.url])).toEqual([['One-pager (this part)', 'https://docs.example.com/part']]);
  });

  it('shows outcomes on both sides: a part sees its umbrella’s, an umbrella sees its parts’', () => {
    const o = (id: string, stageId: string) => ({ id, stageId, impact: 2, unit: '%' });
    const s2 = applyOps(emptyState(), [
      create('u', { title: 'Umbrella', outcomes: [o('shared', 'bottom')] as unknown as Item['outcomes'] }),
      create('a', { title: 'A', parentId: 'u', outcomes: [o('own', 'mid')] as unknown as Item['outcomes'] }),
      create('b', { title: 'B', parentId: 'u' }),
    ]).state;
    expect(linkedOutcomes(s2, s2.items.u).map((l) => [l.owner.id, l.outcome.id])).toEqual([['u', 'shared'], ['a', 'own']]);
    expect(linkedOutcomes(s2, s2.items.a).map((l) => [l.owner.id, l.outcome.id])).toEqual([['u', 'shared'], ['a', 'own']]);
    expect(linkedOutcomes(s2, s2.items.b).map((l) => l.outcome.id)).toEqual(['shared']);
  });
});
