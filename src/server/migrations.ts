import { fromDay, toDay } from '../shared/dates.ts';
import type { RoadmapCore } from '../shared/engine.ts';
import { DEFAULT_SPRINTS, SprintCalendar } from '../shared/sprints.ts';
import { PHASES, type Item, type Op, type SprintSettings } from '../shared/types.ts';
import { stableEqual } from '../shared/util.ts';

const ACTOR = 'Roadmap Anywhere';

/** The calendar the first version shipped with: cycles from Thursday Jan 1, 2026, numbered S1, S2, BB3… */
const FIRST_CALENDAR = {
  anchor: '2026-01-01',
  pattern: [
    { weeks: 2, label: 'Sprint', short: 'S', highlight: false },
    { weeks: 2, label: 'Sprint', short: 'S', highlight: false },
    { weeks: 1, label: 'Brilliant Basics', short: 'BB', highlight: true },
  ],
  firstNumber: 1,
};

/** The second: week-numbered, but with cycles from Thursday Oct 15, 2026 (W42, W44, BB46), so the BB weeks sat a sprint late. */
export const SECOND_CALENDAR: SprintSettings = { ...DEFAULT_SPRINTS, anchor: '2026-10-15' };

/**
 * The first calendar ran one week ahead of the second, so a roadmap still on the untouched first calendar
 * moves to the second with week-numbered sprints, and every initiative moves one week later to stay in the
 * same sprint. Recorded in History as one change. Returns the number of initiatives moved, or null when
 * nothing needed to change.
 */
export function migrateFirstCalendar(core: RoadmapCore): number | null {
  const sp = core.state.settings.sprints as Partial<SprintSettings>;
  if (sp.naming !== undefined) return null;
  if (!stableEqual({ anchor: sp.anchor, pattern: sp.pattern, firstNumber: sp.firstNumber }, FIRST_CALENDAR)) return null;

  const ops: Op[] = [{ kind: 'update', entity: 'settings', id: 'settings', patch: { sprints: { ...SECOND_CALENDAR } } }];
  let moved = 0;
  for (const item of Object.values(core.state.items)) {
    const phases: Item['phases'] = {};
    for (const p of PHASES) {
      const span = item.phases[p];
      if (span) phases[p] = { start: fromDay(toDay(span.start) + 7), end: fromDay(toDay(span.end) + 7) };
    }
    if (Object.keys(phases).length === 0) continue;
    ops.push({ kind: 'update', entity: 'item', id: item.id, patch: { phases } });
    moved++;
  }
  core.submit(ops, { actor: ACTOR, clientId: null });
  return moved;
}

/**
 * The real cadence: cycles from Thursday Oct 1, 2026 (W40, W42, BB44, then W45…). Every other sprint edge of the
 * second calendar is still an edge; the rest (where its BB weeks began) now fall mid-sprint and move one week
 * later to the next edge, so no end date moves earlier. Every date maps the same way, so phases that touched
 * still touch. A phase that only covered one of those BB weeks would vanish that way; it gets the sprint that
 * week is now part of instead, and the phase that led into it ends where it starts. Recorded in History as one
 * change. Returns the number of initiatives moved, or null when the roadmap isn't on the untouched second calendar.
 */
export function migrateSecondCalendar(core: RoadmapCore): number | null {
  if (!stableEqual(core.state.settings.sprints, SECOND_CALENDAR)) return null;
  const cal = new SprintCalendar(DEFAULT_SPRINTS);
  // Nearest sprint edge; a date halfway between two goes to the later one.
  const snap = (day: number) => {
    const s = cal.at(day);
    return day - s.start < s.end - day ? s.start : s.end;
  };

  const ops: Op[] = [{ kind: 'update', entity: 'settings', id: 'settings', patch: { sprints: { ...DEFAULT_SPRINTS } } }];
  let moved = 0;
  for (const item of Object.values(core.state.items)) {
    const old = PHASES.filter((p) => item.phases[p]).map((p) => ({ p, start: toDay(item.phases[p]!.start), end: toDay(item.phases[p]!.end) }));
    const next = old.map((o) => ({ p: o.p, start: snap(o.start), end: snap(o.end) }));
    next.forEach((n, i) => {
      if (n.end > n.start) return;
      const sprint = cal.at(old[i].start);
      n.start = sprint.start;
      n.end = Math.max(n.end, sprint.end);
      next.forEach((m, j) => {
        if (j !== i && old[j].end <= old[i].start && m.end > n.start && m.start < n.start) m.end = n.start;
      });
    });
    const phases: Item['phases'] = {};
    for (const n of next) phases[n.p] = { start: fromDay(n.start), end: fromDay(n.end) };
    if (next.every((n, i) => n.start === old[i].start && n.end === old[i].end)) continue;
    ops.push({ kind: 'update', entity: 'item', id: item.id, patch: { phases } });
    moved++;
  }
  core.submit(ops, { actor: ACTOR, clientId: null });
  return moved;
}

/** Brings a roadmap on an earlier built-in calendar up to the current one. Returns a log line per step taken. */
export function migrateSprintCalendar(core: RoadmapCore): string[] {
  const log: string[] = [];
  const first = migrateFirstCalendar(core);
  if (first !== null) log.push(`Moved to week-numbered sprints and shifted ${first} initiatives by one week to keep their sprints.`);
  const second = migrateSecondCalendar(core);
  if (second !== null) {
    log.push(`Moved to the sprint calendar with cycles from Thursday Oct 1, 2026 (W40, W42, BB44); ${second} initiatives had dates moved to the nearest sprint edge.`);
  }
  return log;
}
