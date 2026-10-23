import { describe, expect, it } from 'vitest';
import { fmtDays, fromDay, isoWeek, quarterOf, toDay, weekday } from '../src/shared/dates.ts';
import { MemoryHistory, RoadmapCore, applyOps, applyUpdates, defaultSettings, emptyState, entitiesOf, invertOps, setEntity, stateAt, stateFromEntities } from '../src/shared/engine.ts';
import { SECOND_CALENDAR, migrateFirstCalendar, migrateSecondCalendar, migrateSprintCalendar } from '../src/server/migrations.ts';
import { DEFAULT_SPRINTS, SprintCalendar, calendarFor } from '../src/shared/sprints.ts';
import { generateDemo } from '../src/shared/seed.ts';
import { diffStates } from '../src/shared/diff.ts';
import { collectDrivers, driverChanges, driversIn, figureText, figuresOf, impactMatrix, landingText, monthNo, monthPeriod, quarterPeriod, shareIn, stageFigures } from '../src/shared/impact.ts';
import { describeChange } from '../src/shared/describe.ts';
import type { Item, Op, Settings, Track } from '../src/shared/types.ts';

const cal = new SprintCalendar(DEFAULT_SPRINTS);

describe('sprint calendar', () => {
  it('follows the 2-2-1 cadence starting on Thursdays, named by week', () => {
    const s0 = cal.get(0);
    expect(fromDay(s0.start)).toBe('2026-10-01');
    expect(weekday(s0.start)).toBe(4);
    expect(s0.code).toBe('W40');
    expect(cal.get(1).start - s0.start).toBe(14);
    expect(cal.get(1).code).toBe('W42');
    expect(fromDay(cal.get(1).start)).toBe('2026-10-15');
    expect(cal.get(2).weeks).toBe(1);
    expect(cal.get(2).code).toBe('BB44');
    expect(cal.get(2).kind).toBe('Brilliant Basics');
    expect(fromDay(cal.get(2).start)).toBe('2026-10-29');
    expect(fromDay(cal.get(3).start)).toBe('2026-11-05');
    expect(cal.get(3).code).toBe('W45');
    // The sprints before: BB39 is Sep 24–30.
    expect(cal.get(-1).code).toBe('BB39');
    expect(fromDay(cal.get(-1).start)).toBe('2026-09-24');
    expect(fromDay(cal.get(-1).end - 1)).toBe('2026-09-30');
    for (let i = -20; i < 40; i++) {
      expect(weekday(cal.get(i).start)).toBe(4);
      expect(cal.get(i).end).toBe(cal.get(i + 1).start);
      expect(cal.get(i).number).toBe(isoWeek(cal.get(i).start));
    }
  });

  it('can number sprints one after another instead', () => {
    const seq = new SprintCalendar({ ...DEFAULT_SPRINTS, naming: 'sequence', firstNumber: 25 });
    expect(seq.get(0).number).toBe(25);
    expect(seq.get(2).code).toBe('BB27');
    expect(seq.get(-1).number).toBe(24);
  });

  it('finds the sprint for any day, before and after the anchor', () => {
    for (let i = -10; i < 30; i++) {
      const s = cal.get(i);
      expect(cal.indexOf(s.start)).toBe(i);
      expect(cal.indexOf(s.end - 1)).toBe(i);
    }
  });

  it('shifts spans by whole sprints', () => {
    const span = cal.spanFromIndexes(3, 5);
    const moved = cal.shiftSpan(span, 2);
    expect(cal.spanIndexes(moved)).toEqual([5, 7]);
    expect(cal.spanCode(moved)).toBe('BB49–W50');
  });

  it('snaps to the nearest boundary', () => {
    const s = cal.get(4);
    expect(cal.nearestBoundary(s.start + 3)).toBe(s.start);
    expect(cal.nearestBoundary(s.end - 2)).toBe(s.end);
  });

  it('names a sprint\'s days for the header, the last one included', () => {
    expect(fmtDays(toDay('2026-10-01'), toDay('2026-10-15'))).toBe('1–14');
    expect(fmtDays(toDay('2026-10-29'), toDay('2026-11-05'))).toBe('29–4');
  });
});

describe('ISO weeks', () => {
  it('numbers weeks the ISO way', () => {
    expect(isoWeek(toDay('2026-10-15'))).toBe(42);
    expect(isoWeek(toDay('2026-01-01'))).toBe(1);
    expect(isoWeek(toDay('2027-01-01'))).toBe(53);
    expect(isoWeek(toDay('2024-12-30'))).toBe(1);
    expect(isoWeek(toDay('2027-01-04'))).toBe(1);
  });
});

describe('moving off earlier built-in calendars', () => {
  const firstSettings = {
    ...defaultSettings(),
    sprints: {
      anchor: '2026-01-01',
      pattern: [
        { weeks: 2, label: 'Sprint', short: 'S', highlight: false },
        { weeks: 2, label: 'Sprint', short: 'S', highlight: false },
        { weeks: 1, label: 'Brilliant Basics', short: 'BB', highlight: true },
      ],
      firstNumber: 1,
    },
  } as unknown as Settings;
  const secondSettings = { ...defaultSettings(), sprints: { ...SECOND_CALENDAR } } as Settings;
  const withItems = (settings: Settings, items: Record<string, Partial<Item>>) =>
    applyOps(
      { ...emptyState(), settings },
      Object.entries(items).map(([id, data]): Op => ({ kind: 'create', entity: 'item', id, data: { title: id, teamId: 't', ...data } })),
    ).state;

  it('moves the first calendar to week naming and keeps every initiative in the same sprint', () => {
    const history = new MemoryHistory();
    const core = new RoadmapCore(withItems(firstSettings, { a: { phases: { implementation: { start: '2026-10-08', end: '2026-10-22' } } } }), history);
    expect(migrateFirstCalendar(core)).toBe(1);
    expect(core.state.settings.sprints).toEqual(SECOND_CALENDAR);
    expect(core.state.items.a.phases.implementation).toEqual({ start: '2026-10-15', end: '2026-10-29' });
    expect(history.changes.length).toBe(2);
    expect(migrateFirstCalendar(core)).toBeNull();
  });

  it('moves the second calendar to cycles from Oct 1, moving dates that now fall mid-sprint to the next edge', () => {
    const history = new MemoryHistory();
    const core = new RoadmapCore(
      withItems(secondSettings, {
        // Old W42: still exactly W42.
        a: { phases: { implementation: { start: '2026-10-15', end: '2026-10-29' } } },
        // Old W44 then BB46: the 3 weeks from Oct 29 become BB44 then W45.
        b: { phases: { discovery: { start: '2026-10-29', end: '2026-11-12' }, implementation: { start: '2026-11-12', end: '2026-11-19' } } },
        // Old W42–W44 ends Nov 12, mid-W45 now: it ends with W45 instead.
        c: { phases: { ux: { start: '2026-10-15', end: '2026-11-12' } } },
        // Old BB41 then W42: the BB41 week is part of W40 now.
        d: { phases: { discovery: { start: '2026-10-08', end: '2026-10-15' }, implementation: { start: '2026-10-15', end: '2026-10-29' } } },
        e: { phases: {} },
      }),
      history,
    );
    expect(migrateSecondCalendar(core)).toBe(3);
    expect(core.state.settings.sprints).toEqual(DEFAULT_SPRINTS);
    const now = calendarFor(core.state.settings.sprints);
    expect(core.state.items.a.phases.implementation).toEqual({ start: '2026-10-15', end: '2026-10-29' });
    expect(now.spanCode(core.state.items.a.phases.implementation!)).toBe('W42');
    const code = (id: string, p: 'discovery' | 'ux' | 'implementation') => now.spanCode(core.state.items[id].phases[p]!);
    expect(core.state.items.b.phases.discovery).toEqual({ start: '2026-10-29', end: '2026-11-05' });
    expect(core.state.items.b.phases.implementation).toEqual({ start: '2026-11-05', end: '2026-11-19' });
    expect([code('b', 'discovery'), code('b', 'implementation')]).toEqual(['BB44', 'W45']);
    expect(core.state.items.c.phases.ux).toEqual({ start: '2026-10-15', end: '2026-11-19' });
    expect(code('c', 'ux')).toBe('W42–W45');
    expect([code('d', 'discovery'), code('d', 'implementation')]).toEqual(['W40', 'W42']);
    expect(core.state.items.d.phases.implementation).toEqual({ start: '2026-10-15', end: '2026-10-29' });
    expect(history.changes.length).toBe(4);
    expect(migrateSecondCalendar(core)).toBeNull();
  });

  it('takes a roadmap on the first calendar all the way to the current one', () => {
    const core = new RoadmapCore(withItems(firstSettings, { a: { phases: { implementation: { start: '2026-10-08', end: '2026-10-22' } } } }), new MemoryHistory());
    expect(migrateSprintCalendar(core)).toHaveLength(2);
    expect(core.state.settings.sprints).toEqual(DEFAULT_SPRINTS);
    expect(calendarFor(core.state.settings.sprints).spanCode(core.state.items.a.phases.implementation!)).toBe('W42');
    expect(migrateSprintCalendar(core)).toEqual([]);
  });

  it('leaves a customised calendar alone', () => {
    const custom1 = { ...firstSettings, sprints: { ...firstSettings.sprints, anchor: '2026-01-08' } } as Settings;
    const custom2 = { ...secondSettings, sprints: { ...SECOND_CALENDAR, naming: 'sequence' } } as Settings;
    for (const settings of [custom1, custom2]) {
      const core = new RoadmapCore({ ...emptyState(), settings }, new MemoryHistory());
      expect(migrateSprintCalendar(core)).toEqual([]);
      expect(core.state.settings).toEqual(settings);
    }
  });
});

describe('items saved by earlier versions', () => {
  // Saved before rows and two-row bars existed: no row or tall at all.
  const old = { id: 'a', title: 'A', teamId: 't', phases: { implementation: { start: '2026-10-15', end: '2026-10-29' } }, order: 3 };

  it('get the newer fields when loaded', () => {
    const state = stateFromEntities([{ entity: 'item', id: 'a', value: old as unknown as Item }]);
    expect(state.items.a.row).toBeNull();
    expect(state.items.a.tall).toBe(false);
    expect(state.items.a.order).toBe(3);
  });

  it('get them in time travel too', () => {
    const current = stateFromEntities([{ entity: 'item', id: 'a', value: { ...old, row: 2 } as unknown as Item }]);
    const past = stateAt(current, [{ entity: 'item', entityId: 'a', before: old as unknown as Item }]);
    expect(past.items.a.row).toBeNull();
    expect(past.items.a.tall).toBe(false);
  });

  it('bring strategic bets saved before own views up to date too', () => {
    const bet = { id: 'b', name: 'Conversion', color: '#4d7c0f', order: 0, description: '' };
    const state = stateFromEntities([{ entity: 'track', id: 'b', value: bet as unknown as Track }]);
    expect(state.tracks.b.ownView).toBe(false);
    expect(state.tracks.b.name).toBe('Conversion');
    expect(state.items).toEqual({});
  });
});

describe('expected impact over time', () => {
  const item = { id: 'x', title: 'X', phases: {}, outcomes: [] } as unknown as Item;
  const outcome = (ramp: number[], landsBy = '2026-07-01') =>
    ({ id: 'o', stageId: 'bottom', metric: '', impact: 10, unit: '%', confidence: 'medium', landsBy, ramp, note: '' }) as Item['outcomes'][number];
  const jul = monthNo(toDay('2026-07-01'));

  it('ramps up month by month and never goes back down', () => {
    const o = outcome([50, 85]);
    expect([jul - 1, jul, jul + 1, jul + 2, jul + 6].map((m) => shareIn(o, jul, m))).toEqual([0, 0.5, 0.85, 1, 1]);
    expect(shareIn(outcome([60, 40]), jul, jul + 1)).toBe(0.6);
  });

  it('credits each period with the impact gained in it, adding up to the full impact once', () => {
    const o = outcome([50, 85]);
    const d = { item: { ...item, outcomes: [o] }, outcome: o, landing: jul, explicit: true, share: 1 };
    const months = [0, 1, 2, 3].map((k) => driversIn([d], monthPeriod(jul + k))[0]?.share ?? 0);
    expect(months.map((m) => Math.round(m * 100))).toEqual([50, 35, 15, 0]);
    expect(driversIn([d], quarterPeriod(toDay('2026-08-15'), 1))[0].share).toBe(1);
    // Landing in September: half shows in Q3, the rest in Q4.
    const sep = outcome([50, 85], '2026-09-01');
    const late = { ...d, outcome: sep, landing: monthNo(toDay('2026-09-01')) };
    expect(driversIn([late], quarterPeriod(toDay('2026-08-15'), 1))[0].share).toBe(0.5);
    expect(driversIn([late], quarterPeriod(toDay('2026-11-15'), 1))[0].share).toBe(0.5);
  });

  it('says when it lands', () => {
    expect(landingText(item, outcome([50, 85]))).toMatch(/^from Jul.*, full by Sep/);
    expect(landingText(item, outcome([]))).toMatch(/^from Jul/);
    expect(landingText(item, { ...outcome([]), landsBy: null })).toBe('when built');
  });

  it('reads "then → now" against an older version, only where a figure changed', () => {
    expect(figuresOf([{ unit: '%', sum: 5 }]).map(figureText)).toEqual(['+5%']);
    // Changed, gone since, new since, unchanged.
    const now = [{ unit: '%' as const, sum: 5 }, { unit: 'pp' as const, sum: 1 }];
    const was = [{ unit: '%' as const, sum: 3 }, { unit: 'abs' as const, sum: 200 }, { unit: 'pp' as const, sum: 1 }];
    expect(figuresOf(now, was).map(figureText)).toEqual(['+3% → +5%', '+1 pp', '+200 → —']);
    expect(figuresOf([], [{ unit: '%', sum: 2 }]).map(figureText)).toEqual(['+2% → —']);
    expect(figuresOf([{ unit: '%', sum: 2 }], []).map(figureText)).toEqual(['— → +2%']);
  });

  it('adds up an initiative’s outcomes per funnel stage, in the order of the stages', () => {
    const stages = [
      { id: 'top', name: 'Top', color: '#000' },
      { id: 'bottom', name: 'Bottom', color: '#000' },
    ];
    const o = (id: string, stageId: string, impact: number | null) => ({ ...outcome([]), id, stageId, impact });
    const lines = stageFigures(stages, [o('a', 'bottom', 2), o('b', 'bottom', 3), o('c', 'top', null)]);
    expect(lines.map((l) => [l.stage.id, l.figures.map(figureText)])).toEqual([
      ['top', []],
      ['bottom', ['+5%']],
    ]);
    // Against the outcomes it had before: a stage it no longer moves still shows, as gone.
    const compared = stageFigures(stages, [o('a', 'bottom', 4)], [o('a', 'bottom', 2), o('d', 'top', 1)]);
    expect(compared.map((l) => [l.stage.id, l.figures.map(figureText)])).toEqual([
      ['top', ['+1% → —']],
      ['bottom', ['+2% → +4%']],
    ]);
    expect(stageFigures(stages, [])).toEqual([]);
  });

  it('matches a period’s drivers across two versions', () => {
    const d = (itemId: string, impact: number) => {
      const o = { ...outcome([]), impact };
      return { item: { ...item, id: itemId }, outcome: o, landing: jul, explicit: true, share: 1 };
    };
    const changes = driverChanges([d('kept', 5), d('new', 1)], [d('gone', 2), d('kept', 3)]);
    expect(changes.map((c) => [c.key, c.now?.outcome.impact ?? null, c.was?.outcome.impact ?? null])).toEqual([
      ['kept-o', 5, 3],
      ['new-o', 1, null],
      ['gone-o', null, 2],
    ]);
  });
});

describe('quarters', () => {
  it('uses calendar quarters by default', () => {
    expect(quarterOf(toDay('2026-10-20')).label).toBe('Q4 2026');
    expect(fromDay(quarterOf(toDay('2026-10-20')).start)).toBe('2026-10-01');
  });
  it('supports fiscal years', () => {
    const q = quarterOf(toDay('2026-10-20'), 4);
    expect(q.label).toBe('Q3 FY27');
    expect(fromDay(q.start)).toBe('2026-10-01');
    expect(fromDay(q.end)).toBe('2027-01-01');
  });
});

function makeCore() {
  const history = new MemoryHistory();
  const core = new RoadmapCore(emptyState(), history);
  return { history, core };
}

describe('engine', () => {
  it('normalises items and strips unsafe links', () => {
    const { state } = applyOps(emptyState(), [
      { kind: 'create', entity: 'item', id: 'a', data: { title: '  Hello ', teamId: 't', onePagerUrl: 'javascript:alert(1)', links: [{ label: 'x', url: 'example.com' }] } },
    ]);
    const item = state.items.a;
    expect(item.title).toBe('Hello');
    expect(item.onePagerUrl).toBe('');
    expect(item.links[0].url).toBe('https://example.com');
  });

  it('inverts ops for undo', () => {
    const s1 = applyOps(emptyState(), [{ kind: 'create', entity: 'item', id: 'a', data: { title: 'A', teamId: 't' } }]).state;
    const ops: Op[] = [{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'B', status: 'done' } }];
    const inv = invertOps(s1, ops);
    const s2 = applyOps(s1, ops).state;
    const s3 = applyOps(s2, inv).state;
    expect(s3.items.a).toEqual(s1.items.a);
    const del: Op[] = [{ kind: 'delete', entity: 'item', id: 'a' }];
    const restored = applyOps(applyOps(s1, del).state, invertOps(s1, del)).state;
    expect(restored.items.a).toEqual(s1.items.a);
  });

  // A state object never changes once it exists: the client's undo, the WeakMap caches in parts.ts and colors.ts
  // and React all rely on it. Frozen inputs make any write to them throw.
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
  }
  function sample() {
    return deepFreeze(
      applyOps(emptyState(), [
        { kind: 'create', entity: 'team', id: 't', data: { name: 'T' } },
        { kind: 'create', entity: 'track', id: 'k', data: { name: 'K' } },
        { kind: 'create', entity: 'item', id: 'a', data: { title: 'A', teamId: 't', trackId: 'k' } },
        { kind: 'create', entity: 'item', id: 'b', data: { title: 'B', teamId: 't' } },
      ]).state,
    );
  }

  it('never changes the state it is given, and hands it back when nothing changes', () => {
    const s = sample();
    const copy = structuredClone(s);
    const { state, applied } = applyOps(s, [
      { kind: 'update', entity: 'item', id: 'a', patch: { title: 'A1' } },
      { kind: 'update', entity: 'item', id: 'a', patch: { row: 2 } },
      { kind: 'create', entity: 'item', id: 'c', data: { title: 'C', teamId: 't' } },
      { kind: 'delete', entity: 'item', id: 'b' },
      { kind: 'update', entity: 'settings', id: 'settings', patch: { name: 'Plan' } },
    ]);
    expect(s).toEqual(copy);
    expect(applied).toHaveLength(5);
    expect(state.items.a).toMatchObject({ title: 'A1', row: 2 });
    expect(Object.keys(state.items).sort()).toEqual(['a', 'c']);
    expect(state.settings.name).toBe('Plan');
    // Collections nothing touched are shared, not copied.
    expect(state.teams).toBe(s.teams);
    expect(state.tracks).toBe(s.tracks);
    // Ops that change nothing leave the very same object.
    expect(applyOps(s, [{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A' } }]).state).toBe(s);
    expect(applyOps(s, [{ kind: 'delete', entity: 'item', id: 'nope' }]).state).toBe(s);
    expect(applyUpdates(s, [])).toBe(s);
    // A batch with an invalid op applies nothing.
    expect(() => applyOps(s, [{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'X' } }, { kind: 'update', entity: 'item', id: 'gone', patch: {} }])).toThrow();
    expect(s).toEqual(copy);
  });

  it('applies incoming updates and loads stored rows in one pass, as one at a time would', () => {
    const s = sample();
    const updates = [
      { entity: 'item' as const, id: 'a', value: { ...s.items.a, title: 'A2' } },
      { entity: 'item' as const, id: 'b', value: null },
      { entity: 'team' as const, id: 'u', value: { ...s.teams.t, id: 'u', name: 'U' } },
      { entity: 'settings' as const, id: 'settings', value: { ...s.settings, name: 'Next' } },
    ];
    let oneByOne = s;
    for (const u of updates) oneByOne = setEntity(oneByOne, u.entity, u.id, u.value);
    expect(applyUpdates(s, updates)).toEqual(oneByOne);
    expect(applyUpdates(s, updates).tracks).toBe(s.tracks);
    const demo = generateDemo(new Date('2026-10-20T12:00:00')).state;
    expect(stateFromEntities(entitiesOf(demo))).toEqual(demo);
  });

  it('undoes a batch that changes the same initiative several times', () => {
    const s = sample();
    const ops: Op[] = [
      { kind: 'update', entity: 'item', id: 'a', patch: { title: 'A1', status: 'at_risk' } },
      { kind: 'update', entity: 'item', id: 'a', patch: { title: 'A2', row: 4 } },
      { kind: 'create', entity: 'item', id: 'c', data: { title: 'C', teamId: 't' } },
      { kind: 'update', entity: 'item', id: 'c', patch: { title: 'C1' } },
      { kind: 'delete', entity: 'item', id: 'b' },
      { kind: 'create', entity: 'item', id: 'b', data: { title: 'B again', teamId: 't' } },
      { kind: 'update', entity: 'team', id: 't', patch: { name: 'T1' } },
    ];
    const inverse = invertOps(s, ops);
    const done = applyOps(s, ops).state;
    expect(done.items.a.title).toBe('A2');
    expect(applyOps(done, inverse).state).toEqual(s);
    // An op that can't apply doesn't stop the inverse of the others being worked out.
    expect(() => invertOps(s, [{ kind: 'update', entity: 'item', id: 'gone', patch: { title: 'x' } }, ...ops])).not.toThrow();
  });

  it('reconstructs any point in time', () => {
    const { core, history } = makeCore();
    core.submit([{ kind: 'create', entity: 'item', id: 'a', data: { title: 'A', teamId: 't' } }], { actor: 'x', clientId: null, now: new Date('2026-01-01T10:00:00Z') });
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A2' } }], { actor: 'y', clientId: null, now: new Date('2026-01-02T10:00:00Z') });
    core.submit([{ kind: 'create', entity: 'item', id: 'b', data: { title: 'B', teamId: 't' } }], { actor: 'y', clientId: null, now: new Date('2026-01-03T10:00:00Z') });
    const atDay1 = stateAt(core.state, history.changesAfter('2026-01-01T12:00:00.000Z'));
    expect(atDay1.items.a.title).toBe('A');
    expect(atDay1.items.b).toBeUndefined();
    const before = stateAt(core.state, history.changesAfter('2025-12-31T00:00:00.000Z'));
    expect(Object.keys(before.items)).toEqual([]);
  });

  it('collapses rapid edits by the same person into one history entry', () => {
    const { core, history } = makeCore();
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
    core.submit([{ kind: 'create', entity: 'item', id: 'a', data: { title: 'A', teamId: 't' } }], { actor: 'x', clientId: null, now: t(0) });
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A1' } }], { actor: 'x', clientId: null, now: t(1) });
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A2' } }], { actor: 'x', clientId: null, now: t(2) });
    expect(history.changes).toHaveLength(1);
    expect(history.changes[0].action).toBe('create');
    expect((history.changes[0].after as Item).title).toBe('A2');
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A3' } }], { actor: 'other', clientId: null, now: t(3) });
    expect(history.changes).toHaveLength(2);
  });

  it('does not merge edits across a snapshot', () => {
    const { core, history } = makeCore();
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
    core.submit([{ kind: 'create', entity: 'item', id: 'a', data: { title: 'A', teamId: 't' } }], { actor: 'x', clientId: null, now: t(0) });
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A1' } }], { actor: 'x', clientId: null, now: t(20) });
    history.snapshotTimes.push(t(21).toISOString());
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A2' } }], { actor: 'x', clientId: null, now: t(22) });
    expect(history.changes).toHaveLength(3);
    const atSnap = stateAt(core.state, history.changesAfter(t(21).toISOString()));
    expect(atSnap.items.a.title).toBe('A1');
  });

  it('counts every batch that changes the roadmap, even one that leaves no trace in history', () => {
    const { core, history } = makeCore();
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m));
    core.submit([{ kind: 'create', entity: 'item', id: 'a', data: { title: 'A', teamId: 't' } }], { actor: 'x', clientId: null, now: t(0) });
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'B' } }], { actor: 'x', clientId: null, now: t(20) });
    core.submit([{ kind: 'create', entity: 'item', id: 'b', data: { title: 'Other', teamId: 't' } }], { actor: 'y', clientId: null, now: t(21) });
    expect(core.version).toBe(3);
    const lastSeq = history.changes.at(-1)!.seq;
    // Edited back to where it was: the earlier entry goes and nothing replaces it, so the newest seq stays put.
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A' } }], { actor: 'x', clientId: null, now: t(22) });
    expect(history.changes.at(-1)!.seq).toBe(lastSeq);
    expect(core.version).toBe(4);
    // A batch that changes nothing is not a new version.
    core.submit([{ kind: 'update', entity: 'item', id: 'a', patch: { title: 'A' } }], { actor: 'x', clientId: null, now: t(23) });
    expect(core.version).toBe(4);
  });
});

describe('demo data', () => {
  const now = new Date('2026-10-20T12:00:00');
  const demo = generateDemo(now);

  it('builds a consistent roadmap with history', () => {
    expect(Object.keys(demo.state.teams)).toHaveLength(5);
    expect(Object.keys(demo.state.items).length).toBeGreaterThan(15);
    expect(demo.changes.every((c) => c.ts < now.toISOString())).toBe(true);
    // replaying history backwards to before the first change gives an empty roadmap
    const start = stateAt(demo.state, demo.changes);
    expect(Object.keys(start.items)).toHaveLength(0);
  });

  it('shows what moved since the planning baseline', () => {
    const changesAfter = demo.changes.filter((c) => c.ts > demo.snapshots[0].ts);
    const baseline = stateAt(demo.state, changesAfter);
    const diff = diffStates(baseline, demo.state, cal);
    expect(diff.byId.get('payments-api')?.slip).toBe(2);
    expect(diff.byId.get('co-marketing')?.kind).toBe('removed');
    expect(diff.byId.get('review-prompts')?.kind).toBe('added');
    // Expected outcomes changed since then count too.
    const item = demo.state.items['payments-api'];
    const later = { ...demo.state, items: { ...demo.state.items, [item.id]: { ...item, outcomes: [...item.outcomes, { ...demo.state.items['cart-emails'].outcomes[0], id: 'new' }] } } };
    expect(diffStates(baseline, later, cal).outcomeChanges).toBe(diff.outcomeChanges + 1);
  });

  it('describes changes in plain language', () => {
    const c = demo.changes.find((x) => x.entityId === 'payments-api' && x.action === 'update')!;
    const d = describeChange(c, demo.state, cal);
    expect(d.verb).toBe('rescheduled');
    expect(d.details.join(' ')).toMatch(/Implementation: .* \(\+2 sprints\)/);
  });

  it('rolls up expected impact by quarter and funnel stage', () => {
    const drivers = collectDrivers(demo.state);
    let q = quarterPeriod(toDay('2026-07-01'), 1);
    const quarters = [];
    for (let i = 0; i < 6; i++) {
      quarters.push(q);
      q = quarterPeriod(toDay(fromDay(toDay('2026-07-01'))) + 92 * (i + 1), 1);
    }
    const matrix = impactMatrix(drivers, quarters);
    const cells = [...matrix.values()].flatMap((m) => [...m.values()]);
    expect(cells.length).toBeGreaterThan(2);
    expect(cells.flatMap((c) => c.totals).some((t) => t.unit === '%' && t.sum > 0)).toBe(true);
  });
});
