import { MONTHS_SHORT, dayOf, quarterOf, toDay, todayDay, ymd } from './dates.ts';
import { deliveryEndDay } from './sprints.ts';
import type { FunnelStage, ID, ImpactUnit, Item, Outcome, RoadmapState } from './types.ts';

// Expected outcomes land in a month and can ramp up over the months after it (e.g. 50% in July, 85% in
// August, full from September). A period (a month or a quarter) is credited with the part of the impact
// gained during it, so across all periods an outcome adds up to its full impact exactly once.

/** A month as one number (year × 12 + month index), so months can be counted and compared. */
export type MonthNo = number;

export const monthNo = (day: number): MonthNo => {
  const { y, m } = ymd(day);
  return y * 12 + (m - 1);
};
export const monthStart = (n: MonthNo): number => dayOf(Math.floor(n / 12), (n % 12) + 1);

/** "Jul", or "Jul 2027" when asked or when it isn't the current year. */
export function monthLabel(n: MonthNo, withYear?: boolean): string {
  const year = Math.floor(n / 12);
  const show = withYear ?? year !== ymd(todayDay()).y;
  return `${MONTHS_SHORT[n % 12]}${show ? ` ${year}` : ''}`;
}

export interface Driver {
  item: Item;
  outcome: Outcome;
  /** Month the impact starts to show. */
  landing: MonthNo;
  /** True when the landing month comes from the outcome rather than the end of implementation. */
  explicit: boolean;
  /** Part of the full impact gained in the period the driver was collected for (0–1); 1 when not per period. */
  share: number;
}

export interface UnitTotal {
  unit: ImpactUnit;
  sum: number;
}

export interface ImpactCell {
  drivers: Driver[];
  totals: UnitTotal[];
}

/** A month or a quarter: its months, first to last. */
export interface Period {
  key: string;
  label: string;
  first: MonthNo;
  last: MonthNo;
}

export function landingMonth(item: Item, outcome: Outcome): { month: MonthNo; explicit: boolean } | null {
  if (outcome.landsBy) return { month: monthNo(toDay(outcome.landsBy)), explicit: true };
  const end = deliveryEndDay(item);
  return end === null ? null : { month: monthNo(end - 1), explicit: false };
}

/** Share of the full impact (0–1) showing in `month`. A ramp never goes back down. */
export function shareIn(outcome: Outcome, landing: MonthNo, month: MonthNo): number {
  const k = month - landing;
  if (k < 0) return 0;
  if (k >= outcome.ramp.length) return 1;
  return Math.max(...outcome.ramp.slice(0, k + 1)) / 100;
}

/** The part of the full impact gained during a period. */
export function gainedIn(outcome: Outcome, landing: MonthNo, period: Period): number {
  return shareIn(outcome, landing, period.last) - shareIn(outcome, landing, period.first - 1);
}

/** Every expected outcome on the roadmap with a landing month. Done items count too (they still moved the funnel). */
export function collectDrivers(state: RoadmapState, items: Item[] = Object.values(state.items)): Driver[] {
  const drivers: Driver[] = [];
  for (const item of items) {
    for (const outcome of item.outcomes) {
      const landing = landingMonth(item, outcome);
      if (!landing) continue;
      drivers.push({ item, outcome, landing: landing.month, explicit: landing.explicit, share: 1 });
    }
  }
  return drivers;
}

/** The drivers that move something in a period, each with the share gained in it. */
export function driversIn(drivers: Driver[], period: Period): Driver[] {
  return drivers
    .map((d) => ({ ...d, share: gainedIn(d.outcome, d.landing, period) }))
    .filter((d) => d.share > 0)
    .sort((a, b) => (b.outcome.impact ?? 0) * b.share - (a.outcome.impact ?? 0) * a.share);
}

/** Impact by unit (a stage's % and pp changes are summed separately), counting each driver's share. */
export function totalsOf(drivers: Pick<Driver, 'outcome' | 'share'>[]): UnitTotal[] {
  const map = new Map<ImpactUnit, UnitTotal>();
  for (const d of drivers) {
    if (d.outcome.impact === null) continue;
    const t = map.get(d.outcome.unit) ?? { unit: d.outcome.unit, sum: 0 };
    t.sum += d.outcome.impact * d.share;
    map.set(d.outcome.unit, t);
  }
  return [...map.values()].filter((t) => Math.abs(t.sum) > 1e-9).sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
}

/** period key → stage id → cell */
export function impactMatrix(drivers: Driver[], periods: Period[]): Map<string, Map<ID, ImpactCell>> {
  const out = new Map<string, Map<ID, ImpactCell>>();
  for (const period of periods) {
    const byStage = new Map<ID, Driver[]>();
    for (const d of driversIn(drivers, period)) byStage.set(d.outcome.stageId, [...(byStage.get(d.outcome.stageId) ?? []), d]);
    const cells = new Map<ID, ImpactCell>();
    for (const [stage, list] of byStage) cells.set(stage, { drivers: list, totals: totalsOf(list) });
    out.set(period.key, cells);
  }
  return out;
}

export function quarterPeriod(day: number, fy: number): Period {
  const q = quarterOf(day, fy);
  return { key: q.key, label: q.label, first: monthNo(q.start), last: monthNo(q.end - 1) };
}

export function monthPeriod(n: MonthNo): Period {
  return { key: `m${n}`, label: monthLabel(n), first: n, last: n };
}

export function formatImpact(value: number | null, unit: ImpactUnit): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const n = Number.isInteger(abs) ? String(abs) : abs.toFixed(abs < 10 ? 1 : 0);
  if (unit === '%') return `${sign}${n}%`;
  if (unit === 'pp') return `${sign}${n} pp`;
  return `${sign}${n}`;
}

// Looking at an older version of the roadmap (time travel or compare), expected impact reads "then → now": the
// older version's figure, then today's, wherever the two differ.

/** A total as it reads today and, when comparing with an older version, as it read then. */
export interface Figure {
  unit: ImpactUnit;
  /** "+5%"; "—" when comparing and nothing is expected now. */
  now: string;
  /** The older version's figure ("—" for nothing), only when comparing and it reads differently. */
  was: string | null;
}

/** Totals as figures: today's, each with the older version's beside it where it differs (given `was` totals). */
export function figuresOf(now: UnitTotal[], was?: UnitTotal[] | null): Figure[] {
  if (!was) return now.map((t) => ({ unit: t.unit, now: formatImpact(t.sum, t.unit), was: null }));
  const units = [...new Set([...now, ...was].map((t) => t.unit))];
  return units.map((unit) => {
    const today = formatImpact(now.find((t) => t.unit === unit)?.sum ?? null, unit);
    const then = formatImpact(was.find((t) => t.unit === unit)?.sum ?? null, unit);
    return { unit, now: today, was: then === today ? null : then };
  });
}

/** "+5%", or "+3% → +5%" when it changed. */
export const figureText = (f: Figure) => (f.was ? `${f.was} → ${f.now}` : f.now);

export interface StageFigures {
  stage: FunnelStage;
  /** Empty when the stage's outcomes have no estimate. */
  figures: Figure[];
}

/**
 * What an initiative is expected to move, stage by stage: its outcomes added up per unit, whenever they land.
 * Given the outcomes it had in an older version, each figure says what it was where it differs. Stages it has no
 * outcome for, in either version, are left out.
 */
export function stageFigures(stages: FunnelStage[], now: Outcome[], was?: Outcome[] | null): StageFigures[] {
  const total = (outcomes: Outcome[]) => totalsOf(outcomes.map((outcome) => ({ outcome, share: 1 })));
  return stages.flatMap((stage) => {
    const mine = now.filter((o) => o.stageId === stage.id);
    const before = was?.filter((o) => o.stageId === stage.id);
    if (mine.length === 0 && !before?.length) return [];
    return [{ stage, figures: figuresOf(total(mine), before ? total(before) : null) }];
  });
}

/** One initiative's outcome in a period, in an older version and today (null where that version doesn't have it there). */
export interface DriverChange {
  key: string;
  now: Driver | null;
  was: Driver | null;
}

/** Drivers of a period in two versions, matched by initiative and outcome: today's first, then the ones gone since. */
export function driverChanges(now: Driver[], was: Driver[]): DriverChange[] {
  const keyOf = (d: Driver) => `${d.item.id}-${d.outcome.id}`;
  const before = new Map(was.map((d) => [keyOf(d), d]));
  const out: DriverChange[] = now.map((d) => ({ key: keyOf(d), now: d, was: before.get(keyOf(d)) ?? null }));
  const kept = new Set(out.map((c) => c.key));
  for (const d of was) if (!kept.has(keyOf(d))) out.push({ key: keyOf(d), now: null, was: d });
  return out;
}

/** When an outcome shows, in short pieces ("from Jul", "full by Sep"); null for an initiative with no dates yet. */
export function landingSteps(item: Item, outcome: Outcome): { from: string; full: string | null; explicit: boolean } | null {
  const landing = landingMonth(item, outcome);
  if (!landing) return null;
  const full = outcome.ramp.findIndex((_, k) => shareIn(outcome, landing.month, landing.month + k) >= 1);
  const fullAt = full === -1 ? landing.month + outcome.ramp.length : landing.month + full;
  return { from: `from ${monthLabel(landing.month)}`, full: fullAt > landing.month ? `full by ${monthLabel(fullAt)}` : null, explicit: landing.explicit };
}

/** "from Jul", "from Jul, full by Sep", or "when built" for an initiative with no dates yet. */
export function landingText(item: Item, outcome: Outcome): string {
  const steps = landingSteps(item, outcome);
  if (!steps) return 'when built';
  const from = `${steps.from}${steps.explicit ? '' : ' (end of implementation)'}`;
  return steps.full ? `${from}, ${steps.full}` : from;
}
