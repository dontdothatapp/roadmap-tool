import { fmtRange, fromDay, isoWeek, toDay } from './dates.ts';
import type { ISODate, PhaseKey, Span, SprintSettings } from './types.ts';

export interface Sprint {
  /** 0 = the sprint starting on the anchor date; negative before it. */
  index: number;
  number: number;
  /** Day number of the first day. */
  start: number;
  /** Day number after the last day (exclusive). */
  end: number;
  /** "Sprint · week 42" (or "Sprint 25" with sequence naming) */
  label: string;
  /** The sprint type, e.g. "Sprint" or "Brilliant Basics". */
  kind: string;
  /** "W42", "BB46" */
  code: string;
  /** The type's prefix on its own, "W" or "BB": what's left of the code where there's no room for it. */
  prefix: string;
  highlight: boolean;
  weeks: number;
}

/**
 * Turns a repeating cadence (e.g. 2 weeks, 2 weeks, 1 week "Brilliant Basics", starting Thursdays)
 * into concrete sprints, in both directions from the anchor.
 */
export class SprintCalendar {
  readonly settings: SprintSettings;
  private readonly anchor: number;
  private readonly offsets: number[];
  private readonly cycleDays: number;
  private readonly cache = new Map<number, Sprint>();

  constructor(settings: SprintSettings) {
    this.settings = settings;
    this.anchor = toDay(settings.anchor);
    this.offsets = [];
    let acc = 0;
    for (const entry of settings.pattern) {
      this.offsets.push(acc);
      acc += entry.weeks * 7;
    }
    this.cycleDays = acc;
  }

  get patternLength(): number {
    return this.settings.pattern.length;
  }

  /** Index of the sprint containing `day`. */
  indexOf(day: number): number {
    const rel = day - this.anchor;
    const cycle = Math.floor(rel / this.cycleDays);
    const within = rel - cycle * this.cycleDays;
    let pos = 0;
    for (let i = this.offsets.length - 1; i >= 0; i--) {
      if (within >= this.offsets[i]) {
        pos = i;
        break;
      }
    }
    return cycle * this.offsets.length + pos;
  }

  get(index: number): Sprint {
    const hit = this.cache.get(index);
    if (hit) return hit;
    const n = this.offsets.length;
    const cycle = Math.floor(index / n);
    const pos = index - cycle * n;
    const entry = this.settings.pattern[pos];
    const start = this.anchor + cycle * this.cycleDays + this.offsets[pos];
    const byWeek = this.settings.naming !== 'sequence';
    const number = byWeek ? isoWeek(start) : index + this.settings.firstNumber;
    const sprint: Sprint = {
      index,
      number,
      start,
      end: start + entry.weeks * 7,
      label: byWeek ? `${entry.label} · week ${number}` : `${entry.label} ${number}`,
      kind: entry.label,
      code: `${entry.short}${number}`,
      prefix: entry.short,
      highlight: entry.highlight,
      weeks: entry.weeks,
    };
    this.cache.set(index, sprint);
    return sprint;
  }

  at(day: number): Sprint {
    return this.get(this.indexOf(day));
  }

  /** Sprints overlapping the half-open day range [from, to). */
  between(from: number, to: number): Sprint[] {
    const out: Sprint[] = [];
    if (to <= from) return out;
    const last = this.indexOf(to - 1);
    for (let i = this.indexOf(from); i <= last; i++) out.push(this.get(i));
    return out;
  }

  /** The sprint boundary closest to `day`. */
  nearestBoundary(day: number): number {
    const s = this.at(day);
    return day - s.start <= s.end - day ? s.start : s.end;
  }

  /** Sprint indexes [first, lastExclusive) covered by a span, snapping partial sprints outward. */
  spanIndexes(span: Span): [number, number] {
    const a = this.indexOf(toDay(span.start));
    const b = this.indexOf(toDay(span.end) - 1) + 1;
    return [a, Math.max(a + 1, b)];
  }

  spanFromIndexes(first: number, lastExclusive: number): Span {
    const end = Math.max(first + 1, lastExclusive);
    return { start: fromDay(this.get(first).start), end: fromDay(this.get(end - 1).end) };
  }

  /** Moves a span by whole sprints, keeping the number of sprints it covers. */
  shiftSpan(span: Span, sprints: number): Span {
    const [a, b] = this.spanIndexes(span);
    return this.spanFromIndexes(a + sprints, b + sprints);
  }

  /** "W42" or "W42–BB46" */
  spanCode(span: Span): string {
    const [a, b] = this.spanIndexes(span);
    const first = this.get(a).code;
    if (b - a === 1) return first;
    return `${first}–${this.get(b - 1).code}`;
  }

  /** "W42–W44 · Oct 15 – Nov 11" */
  describeSpan(span: Span): string {
    return `${this.spanCode(span)} · ${fmtRange(toDay(span.start), toDay(span.end))}`;
  }

  sprintCount(span: Span): number {
    const [a, b] = this.spanIndexes(span);
    return b - a;
  }
}

const calendars = new WeakMap<SprintSettings, SprintCalendar>();

/** Calendars are cached per settings object, so calling this in render paths is cheap. */
export function calendarFor(settings: SprintSettings): SprintCalendar {
  let cal = calendars.get(settings);
  if (!cal) {
    cal = new SprintCalendar(settings);
    calendars.set(settings, cal);
  }
  return cal;
}

/** Two 2-week sprints and a 1-week Brilliant Basics, starting Thursdays; a cycle starts Oct 1, 2026: W40, W42, BB44. */
export const DEFAULT_SPRINTS: SprintSettings = {
  anchor: '2026-10-01',
  pattern: [
    { weeks: 2, label: 'Sprint', short: 'W', highlight: false },
    { weeks: 2, label: 'Sprint', short: 'W', highlight: false },
    { weeks: 1, label: 'Brilliant Basics', short: 'BB', highlight: true },
  ],
  naming: 'week',
  firstNumber: 1,
};

export interface ItemSpans {
  phases: Partial<Record<PhaseKey, Span>>;
}

/** Earliest start and latest end over all phases, as day numbers. */
export function overallDays(item: ItemSpans): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const span of Object.values(item.phases)) {
    if (!span) continue;
    start = Math.min(start, toDay(span.start));
    end = Math.max(end, toDay(span.end));
  }
  return Number.isFinite(start) ? { start, end } : null;
}

export function overallSpan(item: ItemSpans): Span | null {
  const o = overallDays(item);
  return o ? { start: fromDay(o.start), end: fromDay(o.end) } : null;
}

/** The span that matters for "when will this be delivered": implementation if planned, otherwise the whole item. */
export function deliverySpan(item: ItemSpans): Span | null {
  return item.phases.implementation ?? overallSpan(item);
}

/** When dependents can start using this item's output: the end of implementation. */
export function deliveryEndDay(item: ItemSpans): number | null {
  const s = deliverySpan(item);
  return s ? toDay(s.end) : null;
}

/** When an item needs its dependencies delivered: the start of implementation (or its start if it has no implementation phase). */
export function needStartDay(item: ItemSpans): number | null {
  const s = deliverySpan(item);
  return s ? toDay(s.start) : null;
}

export function isoToday(): ISODate {
  return fromDay(Math.floor(Date.now() / 86_400_000));
}
