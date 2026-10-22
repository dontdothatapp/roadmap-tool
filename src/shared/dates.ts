import type { ISODate } from './types.ts';

// All date math uses "day numbers": whole days since 1970-01-01 (UTC). This avoids time zone
// and daylight-saving surprises; an ISODate maps to exactly one day number.

const MS_PER_DAY = 86_400_000;

export function toDay(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDay(day: number): ISODate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Today's day number in the viewer's local calendar. */
export function todayDay(now: Date = new Date()): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
}

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromDay(toDay(value)) === value;
}

/** 0 = Sunday … 6 = Saturday. Day 0 (1970-01-01) was a Thursday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(day: number): number {
  const mondayBased = (weekday(day) + 6) % 7;
  const thursday = day - mondayBased + 3;
  const { y } = ymd(thursday);
  return 1 + Math.floor((thursday - dayOf(y, 1, 1)) / 7);
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function ymd(day: number): { y: number; m: number; d: number } {
  const dt = new Date(day * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function dayOf(y: number, m: number, d = 1): number {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** "Oct 8" */
export function fmtDay(day: number): string {
  const { m, d } = ymd(day);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

/** "Oct 8, 2026" */
export function fmtDayLong(day: number): string {
  const { y, m, d } = ymd(day);
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}

/** Inclusive human range for a half-open [start, end) span: "Oct 8 – Oct 21". */
export function fmtRange(start: number, endExclusive: number, withYear = false): string {
  const last = endExclusive - 1;
  const f = withYear ? fmtDayLong : fmtDay;
  return `${f(start)} – ${f(last)}`;
}

export interface Quarter {
  key: string;
  label: string;
  start: number;
  end: number;
}

/** Quarter containing `day`. With a fiscal year starting in a month other than January, labels read "Q1 FY27" (named after the year it ends). */
export function quarterOf(day: number, fyStartMonth = 1): Quarter {
  const { y, m } = ymd(day);
  const offset = (m - fyStartMonth + 12) % 12;
  const q = Math.floor(offset / 3) + 1;
  const fyStartYear = m >= fyStartMonth ? y : y - 1;
  const startMonthIndex = fyStartMonth - 1 + (q - 1) * 3; // may exceed 11
  const start = dayOf(fyStartYear + Math.floor(startMonthIndex / 12), (startMonthIndex % 12) + 1);
  const endMonthIndex = startMonthIndex + 3;
  const end = dayOf(fyStartYear + Math.floor(endMonthIndex / 12), (endMonthIndex % 12) + 1);
  const label =
    fyStartMonth === 1 ? `Q${q} ${fyStartYear}` : `Q${q} FY${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
  return { key: `${fyStartYear}-${fyStartMonth}-Q${q}`, label, start, end };
}

export function nextQuarter(q: Quarter, fyStartMonth = 1): Quarter {
  return quarterOf(q.end, fyStartMonth);
}

export function prevQuarter(q: Quarter, fyStartMonth = 1): Quarter {
  return quarterOf(q.start - 1, fyStartMonth);
}

/** "Oct 20, 14:05" in the viewer's local time. */
export function fmtTimestamp(ts: string, withYear = false): string {
  const dt = new Date(ts);
  const date = `${MONTHS_SHORT[dt.getMonth()]} ${dt.getDate()}${withYear ? `, ${dt.getFullYear()}` : ''}`;
  const time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${date}, ${time}`;
}

export function relativeTime(ts: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(ts).getTime()) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 90) return '1 min ago';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 5400) return '1 hour ago';
  if (diff < 86400) return `${Math.round(diff / 3600)} hours ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} days ago`;
  return fmtTimestamp(ts, true);
}
