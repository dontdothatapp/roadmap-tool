import { memo, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MONTHS_LONG, MONTHS_SHORT, dayOf, fmtDays, fmtRange, quarterOf, toDay, ymd } from '../../shared/dates.ts';
import { epdLine } from '../../shared/describe.ts';
import { driversIn, figureText, figuresOf, formatImpact, landingText, monthNo, totalsOf, type Driver, type Figure } from '../../shared/impact.ts';
import { deliveryEndDay, needStartDay, type SprintCalendar } from '../../shared/sprints.ts';
import { linkedOutcomes, partsOf, rollUp, umbrellaOf } from '../../shared/parts.ts';
import { PHASES, PHASE_LABELS, type FunnelStage, type Item, type RoadmapState } from '../../shared/types.ts';
import { dependencyInfo } from '../lib/model.ts';
import { Figures, StatusPill } from '../components/ui.tsx';
import type { Layout, Scale } from './geometry.ts';

/** The header's upper tier (months or quarters) without expected impact, and its lower tier (sprints or months). */
export const TOP_TIER_H = 24;
export const LOWER_TIER_H = 34;

interface Cell {
  key: string;
  x: number;
  w: number;
  /** The days the cell stands for (it can be cut off at the edges of the timeline). */
  start: number;
  end: number;
  /** The period's full name ("October 2026"), for tooltips and the impact header. */
  label: string;
  /** What the cell shows, when it differs from `label`: a month without its year, a sprint's code. */
  short?: string;
  /** A quieter second part: the year after January, a sprint's days under its code. */
  note?: string;
  title?: string;
  highlight?: boolean;
}

function clip(scale: Scale, start: number, end: number) {
  const a = Math.max(start, scale.start);
  const b = Math.min(end, scale.end);
  return { x: scale.x(a), w: scale.x(b) - scale.x(a) };
}

/**
 * Months, named in full over sprints (the year only where one starts, so it isn't repeated on every month), or
 * short under quarters.
 */
function monthCells(scale: Scale, longLabels: boolean): Cell[] {
  const out: Cell[] = [];
  let { y, m } = ymd(scale.start);
  for (;;) {
    const start = dayOf(y, m);
    if (start >= scale.end) break;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const end = dayOf(ny, nm);
    const { x, w } = clip(scale, start, end);
    const label = `${MONTHS_LONG[m - 1]} ${y}`;
    const short = longLabels ? (w > 80 ? MONTHS_LONG[m - 1] : MONTHS_SHORT[m - 1]) : w > 26 ? MONTHS_SHORT[m - 1] : '';
    const note = longLabels && (m === 1 || out.length === 0) && w > 64 ? String(y) : undefined;
    out.push({ key: `m${y}-${m}`, x, w, start, end, label, short, note });
    y = ny;
    m = nm;
  }
  return out;
}

function quarterCells(scale: Scale, fy: number): Cell[] {
  const out: Cell[] = [];
  let q = quarterOf(scale.start, fy);
  while (q.start < scale.end) {
    const { x, w } = clip(scale, q.start, q.end);
    out.push({ key: q.key, x, w, start: q.start, end: q.end, label: q.label, short: w > 50 ? q.label : '' });
    q = quarterOf(q.end, fy);
  }
  return out;
}

/** Zoomed in enough for sprints to be the header's lower tier (months above them); otherwise months under quarters. */
const atSprintScale = (scale: Scale) => scale.px >= 2.5;

export function useSprintScale(scale: Scale) {
  return atSprintScale(scale);
}

/** The header's upper tier: months when zoomed in to sprints, quarters further out. */
function periodCells(scale: Scale, fy: number): Cell[] {
  return atSprintScale(scale) ? monthCells(scale, true) : quarterCells(scale, fy);
}

/** Expected impact to show in the header, period by period (Leadership): the drivers and the funnel stages they move. */
export interface HeaderOutcomes {
  /** Today's drivers (the version shown, when there is nothing to compare with). */
  drivers: Driver[];
  /** An older version's drivers, while one is open or compared with: each figure then reads "then → now". */
  was?: Driver[] | null;
  stages: FunnelStage[];
}

export interface PeriodImpact {
  stage: FunnelStage;
  /** One per unit: "+3%", or "+3%" and "+1 pp" when a stage moves in more than one unit. */
  figures: Figure[];
  initiatives: number;
}

export interface HeaderImpact {
  byCell: Map<string, PeriodImpact[]>;
  /** Lines of impact the header makes room for: the most any period has, up to four. */
  lines: number;
  /** The figures say what an older version expected, where it differs. */
  comparing: boolean;
}

export const IMPACT_LINE_H = 16;

/** The impact gained in each period of the header's upper tier (ramp-ups spread month by month), per funnel stage. */
export function headerImpact(scale: Scale, fy: number, outcomes: HeaderOutcomes): HeaderImpact {
  const byCell = new Map<string, PeriodImpact[]>();
  let lines = 0;
  for (const cell of periodCells(scale, fy)) {
    const period = { key: cell.key, label: cell.label, first: monthNo(cell.start), last: monthNo(cell.end - 1) };
    const drivers = driversIn(outcomes.drivers, period);
    const was = outcomes.was ? driversIn(outcomes.was, period) : null;
    const impact = outcomes.stages.flatMap((stage) => {
      const mine = drivers.filter((d) => d.outcome.stageId === stage.id);
      const totals = totalsOf(mine);
      const before = was && totalsOf(was.filter((d) => d.outcome.stageId === stage.id));
      if (totals.length === 0 && !before?.length) return [];
      return [{ stage, figures: figuresOf(totals, before), initiatives: new Set(mine.map((d) => d.item.id)).size }];
    });
    byCell.set(cell.key, impact);
    lines = Math.max(lines, Math.min(4, impact.length));
  }
  return { byCell, lines, comparing: !!outcomes.was };
}

/** Height of the header's upper tier: the period's name, plus its impact when shown. */
export const topTierH = (impact: HeaderImpact | null) => TOP_TIER_H + (impact?.lines ? impact.lines * IMPACT_LINE_H + 6 : 0);

/**
 * The timeline's header: months over sprints, or quarters over months when zoomed out. Like a printed calendar,
 * each sprint is a block of its own with its code and its days under the month ("W42" over "15–28"), centred,
 * so it reads as belonging to its column; where we are is the red today line's job, so no sprint is singled out.
 */
export const TimelineHeader = memo(function TimelineHeader({
  scale,
  cal,
  fy,
  impact,
}: {
  scale: Scale;
  cal: SprintCalendar;
  fy: number;
  impact: HeaderImpact | null;
}) {
  const sprintScale = useSprintScale(scale);
  const topH = topTierH(impact);
  const { top, bottom } = useMemo(() => {
    const top = periodCells(scale, fy);
    const bottom: Cell[] = sprintScale
      ? cal.between(scale.start, scale.end).map((s) => {
          const { x, w } = clip(scale, s.start, s.end);
          return {
            key: `s${s.index}`,
            x,
            w,
            start: s.start,
            end: s.end,
            label: s.code,
            short: w >= 32 ? s.code : w >= 18 ? s.prefix : '',
            note: w >= 36 ? fmtDays(s.start, s.end) : undefined,
            title: `${s.label} · ${fmtRange(s.start, s.end, true)}`,
            highlight: s.highlight,
          };
        })
      : monthCells(scale, false);
    return { top, bottom };
  }, [scale, cal, fy, sprintScale]);

  return (
    <div className="tl-tiers" style={{ width: scale.width }}>
      <div className={`tl-tier top${impact?.lines ? ' with-impact' : ''}`} style={{ height: topH }}>
        {top.map((c) => {
          const shown = impact?.byCell.get(c.key) ?? [];
          const lines = impact ? shown.slice(0, impact.lines) : [];
          return (
            <div
              key={c.key}
              className="tl-cell"
              style={{ left: c.x, width: c.w }}
              title={
                impact
                  ? shown.length
                    ? `Expected impact in ${c.label}${impact.comparing ? ', then → now' : ''}:\n${shown.map((i) => `${i.stage.name} ${i.figures.map(figureText).join(' · ')}${i.initiatives ? ` (${i.initiatives} initiative${i.initiatives === 1 ? '' : 's'})` : ''}`).join('\n')}`
                    : `No expected impact in ${c.label}`
                  : undefined
              }
            >
              <span className="tl-period">
                {c.short}
                {c.note && <span className="tl-period-note"> {c.note}</span>}
              </span>
              {lines.length > 0 && (
                <span className="tl-impact">
                  {lines.map((i) => (
                    <span key={i.stage.id} className="tl-impact-line" style={{ '--c': i.stage.color } as React.CSSProperties}>
                      <strong>
                        <Figures figures={i.figures} />
                      </strong>
                      <span className="tl-impact-name">{i.stage.name}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="tl-tier bottom" style={{ top: topH }}>
        {bottom.map((c) => (
          <div key={c.key} className={`tl-cell${c.highlight ? ' is-highlight' : ''}`} style={{ left: c.x, width: c.w }} title={c.title ?? c.label}>
            <span className="tl-block-label">
              {c.short && <span className="tl-block-name">{c.short}</span>}
              {c.note && <span className="tl-block-note">{c.note}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

export const TimelineGrid = memo(function TimelineGrid({
  scale,
  cal,
  fy,
  today,
  height,
}: {
  scale: Scale;
  cal: SprintCalendar;
  fy: number;
  today: number;
  height: number;
}) {
  const sprintScale = useSprintScale(scale);
  const { columns, lines, quarters } = useMemo(() => {
    const sprints = cal.between(scale.start, scale.end);
    // Shaded sprint types (e.g. Brilliant Basics) only when zoomed in enough for them to read as columns, not stripes.
    const columns = sprints.filter((s) => s.highlight && scale.px >= 3).map((s) => ({ key: s.index, ...clip(scale, s.start, s.end) }));
    const lines = sprintScale ? sprints.map((s) => ({ key: `s${s.index}`, x: scale.x(s.start) })) : monthCells(scale, false).map((c) => ({ key: c.key, x: c.x }));
    const quarters = quarterCells(scale, fy).map((q) => ({ key: q.key, x: q.x }));
    return { columns, lines, quarters };
  }, [scale, cal, fy, sprintScale]);

  return (
    <div className="tl-grid" style={{ height }}>
      {columns.map((c) => (
        <div key={c.key} className="tl-col is-highlight" style={{ left: c.x, width: c.w }} />
      ))}
      {lines.map((l) => (
        <div key={l.key} className="tl-line" style={{ left: l.x }} />
      ))}
      {quarters.map((q) => (
        <div key={q.key} className="tl-line is-quarter" style={{ left: q.x }} />
      ))}
      <div className="tl-today" style={{ left: scale.x(today) }} />
    </div>
  );
});

export function DependencyLayer({
  layout,
  state,
  width,
  focusId,
  showAll,
}: {
  layout: Layout;
  state: RoadmapState;
  width: number;
  focusId: string | null;
  showAll: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const arrows = useMemo(() => {
    const out: { key: string; d: string; tone: 'ok' | 'conflict'; active: boolean; title: string }[] = [];
    // Where views show umbrellas, a part's arrows start or end at its umbrella's bar; whether one lands too late
    // still depends on the part's own dates.
    const blockOf = (item: Item) => layout.byId.get(item.id) ?? (umbrellaOf(state, item) ? layout.byId.get(item.parentId!) : undefined);
    for (const from of Object.values(state.items)) {
      for (const dep of from.dependencies) {
        const target = dep.itemId ? state.items[dep.itemId] : undefined;
        if (!target) continue;
        const b = blockOf(from);
        const p = blockOf(target);
        if (!b || !p || b === p) continue;
        const active = focusId === b.item.id || focusId === p.item.id || focusId === from.id || focusId === target.id;
        if (!showAll && !active) continue;
        const ready = deliveryEndDay(target);
        const needed = needStartDay(from);
        const conflict = ready !== null && needed !== null && ready > needed;
        const { x: x1, y: y1 } = p.outPoint;
        const { x: x2, y: y2 } = b.inPoint;
        const span = x2 - x1;
        const k = span > 24 ? Math.max(18, span / 2) : 48;
        const d = `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2 - 2},${y2}`;
        out.push({
          key: `${from.id}-${dep.id}`,
          d,
          tone: conflict ? 'conflict' : 'ok',
          active,
          title: `${from.title} needs ${target.title}${conflict ? ' — lands too late' : ''}`,
        });
      }
    }
    return out.sort((a, b) => Number(a.active) - Number(b.active) || (a.tone === 'conflict' ? 1 : 0) - (b.tone === 'conflict' ? 1 : 0));
  }, [layout, state, focusId, showAll]);

  return (
    <svg className={`tl-deps${focusId ? ' has-focus' : ''}`} width={width} height={layout.height}>
      <defs>
        {(['ok', 'conflict', 'active'] as const).map((t) => (
          <marker key={t} id={`${uid}-${t}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0.5 L7.5,4 L0,7.5 z" className={`dep-head ${t}`} />
          </marker>
        ))}
      </defs>
      {arrows.map((a) => (
        <path
          key={a.key}
          d={a.d}
          className={`dep ${a.tone}${a.active ? ' active' : ''}`}
          markerEnd={`url(#${uid}-${a.active && a.tone !== 'conflict' ? 'active' : a.tone})`}
        >
          <title>{a.title}</title>
        </path>
      ))}
    </svg>
  );
}

/** `hint`: what a click does, when it isn't opening the details (an umbrella that opens in place). */
export function HoverCard({ item, state, cal, rect, hint }: { item: Item; state: RoadmapState; cal: SprintCalendar; rect: DOMRect; hint?: string }) {
  const team = state.teams[item.teamId];
  const track = item.trackId ? state.tracks[item.trackId] : null;
  const width = 340;
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
  const below = rect.bottom + 10 + 260 < window.innerHeight;
  const style = below ? { left, top: rect.bottom + 8 } : { left, bottom: window.innerHeight - rect.top + 8 };
  const deps = item.dependencies.map((d) => dependencyInfo(state, item, d, (day) => cal.indexOf(day)));
  const conflicts = deps.filter((d) => d.conflict);
  const stages = new Map(state.settings.funnelStages.map((s) => [s.id, s]));
  const umbrella = umbrellaOf(state, item);
  const parts = partsOf(state, item.id);
  // With the linked ones: a part's umbrella's, an umbrella's parts'.
  const outcomes = linkedOutcomes(state, item);
  return createPortal(
    <div className="hovercard" style={{ ...style, width }} role="tooltip">
      <div className="hc-top">
        <span className="team-chip" style={{ '--c': team?.color ?? '#888' } as React.CSSProperties}>
          {team?.name ?? 'No team'}
        </span>
        {track && <span className="hc-track">{track.name}</span>}
        {item.status !== 'planned' && <StatusPill status={item.status} />}
      </div>
      {umbrella && <div className="hc-umbrella">Part of {umbrella.title}</div>}
      <div className="hc-title">{item.title}</div>
      {parts.length > 0 && (
        <div className="hc-parts">
          {parts.length} parts:{' '}
          {parts
            .slice(0, 4)
            .map((part) => part.title)
            .join(' · ')}
          {parts.length > 4 && ` · +${parts.length - 4} more`}
        </div>
      )}
      <div className="hc-phases">
        {PHASES.filter((p) => item.phases[p]).map((p) => {
          const span = item.phases[p]!;
          return (
            <div key={p} className="hc-phase">
              <span className={`phase-swatch ${p}`} style={{ '--c': team?.color ?? '#888' } as React.CSSProperties} />
              <span className="hc-phase-name">{PHASE_LABELS[p]}</span>
              <span className="mono">{cal.spanCode(span)}</span>
              <span className="hc-dim">{fmtRange(toDay(span.start), toDay(span.end))}</span>
            </div>
          );
        })}
        {PHASES.every((p) => !item.phases[p]) && <div className="hc-dim">Not scheduled yet</div>}
      </div>
      {item.description && <p className="hc-desc">{item.description}</p>}
      {outcomes.length > 0 && (
        <div className="hc-outcomes">
          {outcomes.slice(0, 3).map(({ owner, outcome: o }) => (
            <div key={`${owner.id}-${o.id}`}>
              {stages.get(o.stageId)?.name ?? 'Funnel'} <strong>{formatImpact(o.impact, o.unit)}</strong>
              <span className="hc-dim">
                {' '}
                · {landingText(rollUp(state).items[owner.id] ?? owner, o)}
                {owner.id !== item.id && ` · ${owner.title}`}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="hc-foot">
        {team && epdLine(team) && <span>{epdLine(team)}</span>}
        {deps.length > 0 && <span>{deps.length === 1 ? '1 connection' : `${deps.length} connections`}</span>}
        {conflicts.length > 0 && <span className="hc-warn">{conflicts.length === 1 ? '1 lands too late' : `${conflicts.length} land too late`}</span>}
      </div>
      {hint && <div className="hc-hint">{hint}</div>}
    </div>,
    document.body,
  );
}
