import { describe, expect, it } from 'vitest';
import { groupsFor, newItemPatch, normalizeTag, pickableInitiatives, regroupPatch, tagChoices } from '../src/client/lib/model.ts';
import { applyOps, emptyState } from '../src/shared/engine.ts';
import type { Item, Op } from '../src/shared/types.ts';

describe('newItemPatch', () => {
  it('puts a new initiative in the lane it was drawn in', () => {
    expect(newItemPatch('team', 'growth')).toEqual({ teamId: 'growth' });
    expect(newItemPatch('track', '__none')).toEqual({ trackId: null });
    expect(newItemPatch('tag', 't:payments')).toEqual({ tags: ['payments'] });
    const stage = newItemPatch('stage', 'bottom');
    expect(stage?.outcomes).toHaveLength(1);
    expect(stage?.outcomes?.[0]).toMatchObject({ stageId: 'bottom', metric: '', impact: null });
  });

  it('adds nothing for lanes it cannot fill in', () => {
    expect(newItemPatch('tag', '__none')).toBeNull();
    expect(newItemPatch('none', 'all')).toBeNull();
  });
});

describe('grouping the team view by umbrella', () => {
  const create = (id: string, data: Partial<Item> = {}): Op => ({ kind: 'create', entity: 'item', id, data: { title: id, teamId: 't', ...data } });
  const state = applyOps(emptyState(), [create('Zeta'), create('z1', { parentId: 'Zeta' }), create('Alpha'), create('a1', { parentId: 'Alpha' }), create('a2', { parentId: 'Alpha' }), create('solo')]).state;
  const items = ['z1', 'a1', 'a2', 'solo'].map((id) => state.items[id]);

  it('gives each umbrella a lane, by name, and one for the rest', () => {
    const { groups, groupsOf } = groupsFor(state, 'umbrella', items);
    expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Zeta', 'No umbrella']);
    expect(items.map((i) => groupsOf(i)[0])).toEqual(['Zeta', 'Alpha', 'Alpha', '__none']);
  });

  it('makes an initiative a part of the umbrella whose lane it moves to, or its own again', () => {
    expect(regroupPatch('umbrella', 'Alpha')).toEqual({ parentId: 'Alpha' });
    expect(regroupPatch('umbrella', '__none')).toEqual({ parentId: null });
    expect(newItemPatch('umbrella', 'Zeta')).toEqual({ parentId: 'Zeta' });
  });
});

describe('picking an umbrella', () => {
  const create = (id: string, data: Partial<Item> = {}): Op => ({ kind: 'create', entity: 'item', id, data: { title: id, teamId: 'a', ...data } });
  const state = applyOps(emptyState(), [
    { kind: 'create', entity: 'team', id: 'a', data: { name: 'A', order: 0 } },
    { kind: 'create', entity: 'team', id: 'b', data: { name: 'B', order: 1 } },
    create('Checkout redesign'),
    create('Billing'),
    create('Wallets'),
    create('w1', { parentId: 'Wallets' }),
    create('Checkout speed', { teamId: 'b' }),
  ]).state;
  const candidates = ['Checkout redesign', 'Billing', 'Wallets', 'Checkout speed'].map((id) => state.items[id]);
  const ids = (items: Item[]) => items.map((i) => i.id);

  it('keeps the team’s own apart from other teams’, umbrellas with parts first', () => {
    const { own, others } = pickableInitiatives(state, candidates, 'a', '');
    expect(ids(own)).toEqual(['Wallets', 'Billing', 'Checkout redesign']);
    expect(ids(others)).toEqual(['Checkout speed']);
  });

  it('matches every word typed, in any order and case', () => {
    expect(ids(pickableInitiatives(state, candidates, 'a', 'REDESIGN check').own)).toEqual(['Checkout redesign']);
    const { own, others } = pickableInitiatives(state, candidates, 'a', 'speed');
    expect(own).toEqual([]);
    expect(ids(others)).toEqual(['Checkout speed']);
  });
});

describe('picking tags', () => {
  const create = (id: string, tags: string[]): Op => ({ kind: 'create', entity: 'item', id, data: { title: id, teamId: 't', tags } });
  const state = applyOps(emptyState(), [create('a', ['payments', 'q4-launch']), create('b', ['payments']), create('c', ['mobile'])]).state;

  it('lists every tag in use by name, with how many initiatives carry it', () => {
    expect(tagChoices(state, '')).toEqual({
      tags: [
        { tag: 'mobile', count: 1 },
        { tag: 'payments', count: 2 },
        { tag: 'q4-launch', count: 1 },
      ],
      create: null,
    });
  });

  it('narrows to what is typed and offers a new tag unless it exists', () => {
    expect(tagChoices(state, 'pay').tags.map((t) => t.tag)).toEqual(['payments']);
    expect(tagChoices(state, 'pay').create).toBe('pay');
    expect(tagChoices(state, '#Launch Q4').tags.map((t) => t.tag)).toEqual(['q4-launch']);
    expect(tagChoices(state, 'Payments').create).toBeNull();
    expect(normalizeTag(' #Q4 launch ')).toBe('q4-launch');
  });
});
