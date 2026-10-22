import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayDay } from '../../shared/dates.ts';
import {
  collectDrivers,
  driverChanges,
  figuresOf,
  formatImpact,
  impactMatrix,
  landingSteps,
  monthNo,
  monthPeriod,
  quarterPeriod,
  totalsOf,
  monthStart,
  type Driver,
  type DriverChange,
  type Period,
} from '../../shared/impact.ts';
import { rollUp, umbrellaOf } from '../../shared/parts.ts';
import type { RoadmapState } from '../../shared/types.ts';
import { FilterButton, SearchField, ViewHeader } from '../components/Toolbar.tsx';
import { Empty, Figures, Segmented, StatusPill } from '../components/ui.tsx';
import { applyFilters } from '../lib/model.ts';
import { usePersistentState } from '../lib/persist.ts';
import { openItem, useApp, useRoadmap, useVersions } from '../store.ts';

type PeriodKind = 'quarter' | 'month';

type Matrix = ReturnType<typeof impactMatrix>;

/** Comparing two versions: the older one's and today's. */
interface Pair<T> {
  before: T;
  after: T;
}

export function ImpactView() {
  // Umbrellas carry the shared outcomes and land when their last part does.
  const raw = useRoadmap();
  const state = useMemo(() => rollUp(raw), [raw]);
  const filters = useApp((s) => s.filters);
  const fy = state.settings.fiscalYearStartMonth;
  const stages = state.settings.funnelStages;
  const [kind, setKind] = usePersistentState<PeriodKind>('impact-period', 'quarter');
  const [offset, setOffset] = useState(0);
  const items = useMemo(() => applyFilters(Object.values(state.items), state, filters), [state, filters]);
  const drivers = useMemo(() => collectDrivers(state, items), [state, items]);
  // While an older version is open or compared with, each figure reads "then → now" (the older version, today).
  const versions = useVersions();
  const pair = useMemo((): Pair<Driver[]> | null => {
    if (!versions) return null;
    const driversOf = (raw: RoadmapState) => {
      const s = rollUp(raw);
      return s === state ? drivers : collectDrivers(s, applyFilters(Object.values(s.items), s, filters));
    };
    return { before: driversOf(versions.before), after: driversOf(versions.after) };
  }, [versions, state, drivers, filters]);

  const now = todayDay();
  const current = kind === 'quarter' ? quarterPeriod(now, fy) : monthPeriod(monthNo(now));
  const periods = useMemo(() => {
    // Quarters: last, this and the next two. Months: last month, this one and the next four.
    const out: Period[] = [];
    if (kind === 'quarter') {
      let q = quarterPeriod(monthStart(monthNo(now) + offset * 3), fy);
      q = quarterPeriod(monthStart(q.first - 1), fy);
      for (let i = 0; i < 4; i++) {
        out.push(q);
        q = quarterPeriod(monthStart(q.last + 1), fy);
      }
    } else {
      const first = monthNo(now) + offset * 6 - 1;
      for (let i = 0; i < 6; i++) out.push(monthPeriod(first + i));
    }
    return out;
  }, [kind, offset, now, fy]);
  const matrix = useMemo(() => impactMatrix(drivers, periods), [drivers, periods]);
  const matrices = useMemo((): Pair<Matrix> | null => {
    if (!pair) return null;
    const of = (list: Driver[]) => (list === drivers ? matrix : impactMatrix(list, periods));
    return { before: of(pair.before), after: of(pair.after) };
  }, [pair, drivers, matrix, periods]);

  const defaultStage = stages.find((s) => s.id === 'bottom')?.id ?? stages[0]?.id;
  const [selected, setSelected] = useState<{ p: string; stage: string } | null>(null);
  const sel = selected && periods.some((p) => p.key === selected.p) ? selected : { p: current.key, stage: selected?.stage ?? defaultStage };
  const selPeriod = periods.find((p) => p.key === sel.p) ?? current;
  const selStage = stages.find((s) => s.id === sel.stage);
  const selDrivers = matrix.get(sel.p)?.get(sel.stage)?.drivers ?? [];
  const selChanges = matrices && {
    before: matrices.before.get(sel.p)?.get(sel.stage)?.drivers ?? [],
    after: matrices.after.get(sel.p)?.get(sel.stage)?.drivers ?? [],
  };

  return (
    <div className="view">
      <ViewHeader
        title="Expected impact"
        sub="What each period should move in the funnel, and which initiatives drive it. Impact shows from the month it lands (the end of implementation unless an outcome says otherwise), following any ramp-up."
        controls={
          <Segmented<PeriodKind>
            label="Period"
            size="sm"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setOffset(0);
            }}
            options={[
              { value: 'quarter', label: 'Quarters' },
              { value: 'month', label: 'Months' },
            ]}
          />
        }
      >
        <SearchField />
        <FilterButton />
      </ViewHeader>
      {(pair ? pair.before.length + pair.after.length : drivers.length) === 0 ? (
        <Empty title="No expected outcomes yet">Open an initiative and add an expected outcome: the funnel stage, the change you expect and when it lands.</Empty>
      ) : (
        <div className="impact-layout">
          <div className="impact-matrix-wrap">
            <div className="impact-matrix" style={{ gridTemplateColumns: `minmax(120px, 160px) repeat(${periods.length}, minmax(${kind === 'quarter' ? 150 : 110}px, 1fr))` }}>
              <div className="im-corner">
                <button type="button" className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label={kind === 'quarter' ? 'Earlier quarters' : 'Earlier months'}>
                  <ChevronLeft size={16} />
                </button>
                <button type="button" className="icon-btn" onClick={() => setOffset((o) => o + 1)} aria-label={kind === 'quarter' ? 'Later quarters' : 'Later months'}>
                  <ChevronRight size={16} />
                </button>
              </div>
              {periods.map((p) => (
                <div key={p.key} className={`im-qhead${p.key === current.key ? ' is-current' : ''}`}>
                  {p.label}
                  {p.key === current.key && <span className="im-now">now</span>}
                </div>
              ))}
              {stages.map((stage) => (
                <Row key={stage.id} stage={stage} periods={periods} matrix={matrix} matrices={matrices} sel={sel} onSelect={setSelected} />
              ))}
            </div>
          </div>
          <aside className="side-panel impact-detail" aria-label="Drivers">
            <div className="side-head">
              <h2>
                <span className="impact-stage" style={{ '--c': selStage?.color ?? '#888' } as React.CSSProperties}>
                  {selStage?.name ?? 'Stage'}
                </span>{' '}
                in {selPeriod.label}
              </h2>
            </div>
            <div className="side-body">
              <DriverDetail drivers={selDrivers} changes={selChanges} />
            </div>
          </aside>
        </div>
      )}
      <p className="muted sm impact-note">
        Each period counts the impact gained in it: an outcome that ramps up over several months is spread across them. Totals add up estimates with the same unit; they’re a planning
        signal, not a forecast.
      </p>
    </div>
  );
}

function Row({
  stage,
  periods,
  matrix,
  matrices,
  sel,
  onSelect,
}: {
  stage: { id: string; name: string; color: string };
  periods: Period[];
  /** The version shown. */
  matrix: Matrix;
  /** Comparing: the older version's and today's, for "then → now" figures. */
  matrices: Pair<Matrix> | null;
  sel: { p: string; stage: string };
  onSelect: (s: { p: string; stage: string }) => void;
}) {
  const state = useRoadmap();
  return (
    <>
      <div className="im-stage" style={{ '--c': stage.color } as React.CSSProperties}>
        <span className="im-stage-bar" />
        {stage.name}
      </div>
      {periods.map((p) => {
        const cell = matrix.get(p.key)?.get(stage.id);
        const now = matrices ? matrices.after.get(p.key)?.get(stage.id) : cell;
        const was = matrices?.before.get(p.key)?.get(stage.id);
        const figures = figuresOf(now?.totals ?? [], matrices ? (was?.totals ?? []) : null);
        const isSel = sel.p === p.key && sel.stage === stage.id;
        const teams = cell ? [...new Set(cell.drivers.map((d) => d.item.teamId))] : [];
        const any = cell ?? now ?? was;
        return (
          <button
            key={p.key}
            type="button"
            className={`im-cell${isSel ? ' is-selected' : ''}${any ? '' : ' is-empty'}`}
            style={{ '--c': stage.color } as React.CSSProperties}
            onClick={() => onSelect({ p: p.key, stage: stage.id })}
          >
            {any ? (
              <>
                {figures.map((f) => (
                  <span key={f.unit} className="im-total">
                    <strong>
                      <Figures figures={[f]} />
                    </strong>
                  </span>
                ))}
                {figures.length === 0 && <span className="muted sm">Impact not estimated</span>}
                {cell && (
                  <span className="im-foot">
                    <span className="im-teams">
                      {teams.map((t) => (
                        <span key={t} className="im-team-dot" style={{ background: state.teams[t]?.color }} title={state.teams[t]?.name} />
                      ))}
                    </span>
                    {cell.drivers.length} initiative{cell.drivers.length > 1 ? 's' : ''}
                  </span>
                )}
              </>
            ) : (
              <span className="im-none">—</span>
            )}
          </button>
        );
      })}
    </>
  );
}

/** What one initiative's outcome gains in the period: "+2%", or "—" when it gains nothing there. */
const gained = (d: Driver | null) => (d ? formatImpact(d.outcome.impact === null ? null : d.outcome.impact * d.share, d.outcome.unit) : '—');

function DriverDetail({ drivers, changes }: { drivers: Driver[]; changes: Pair<Driver[]> | null }) {
  const state = useRoadmap();
  // Comparing: every initiative in either version, today's first, then the ones that no longer count here.
  const rows: DriverChange[] = changes
    ? driverChanges(changes.after, changes.before)
    : drivers.map((d) => ({ key: `${d.item.id}-${d.outcome.id}`, now: d, was: null }));
  if (rows.length === 0) return <p className="muted sm">Nothing is expected to move this stage in this period. Pick another cell.</p>;
  const totals = figuresOf(totalsOf(changes?.after ?? drivers), changes && totalsOf(changes.before));
  // Each team's part of the movement: its initiatives' shares in this period.
  const byTeam = new Map<string, number>();
  for (const d of drivers) byTeam.set(d.item.teamId, (byTeam.get(d.item.teamId) ?? 0) + d.share);
  const weightSum = [...byTeam.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="drivers">
      <div className="driver-totals">
        {totals.map((t) => (
          <div key={t.unit} className="driver-total">
            <strong>
              <Figures figures={[t]} />
            </strong>
            <span className="muted sm"> {t.unit === '%' ? 'relative' : t.unit === 'pp' ? 'percentage points' : 'absolute'}</span>
          </div>
        ))}
      </div>
      {byTeam.size > 0 && (
        <>
          <div className="team-share" aria-label="Share by team">
            {[...byTeam.entries()].map(([teamId, w]) => (
              <span
                key={teamId}
                className="team-share-seg"
                style={{ flex: w, background: state.teams[teamId]?.color }}
                title={`${state.teams[teamId]?.name}: ${Math.round((w / weightSum) * 100)}% of the initiatives moving this`}
              />
            ))}
          </div>
          <div className="team-share-legend">
            {[...byTeam.keys()].map((teamId) => (
              <span key={teamId}>
                <span className="im-team-dot" style={{ background: state.teams[teamId]?.color }} />
                {state.teams[teamId]?.name}
              </span>
            ))}
          </div>
        </>
      )}
      <div className="driver-list">
        {rows.map((c) => {
          const d = (c.now ?? c.was)!;
          const value = gained(c.now);
          const was = changes ? gained(c.was) : value;
          const partial = !!c.now && d.share < 0.999 && d.outcome.impact !== null;
          // Leadership reads the umbrella: it's the title, and the part that holds the outcome is the detail under it.
          const umbrella = umbrellaOf(state, d.item);
          const track = state.tracks[umbrella?.trackId ?? ''] ?? state.tracks[d.item.trackId ?? ''];
          const team = state.teams[d.item.teamId];
          const when = landingSteps(d.item, d.outcome);
          return (
            <button
              key={c.key}
              type="button"
              className={`driver${c.now ? '' : ' is-gone'}`}
              // An initiative only in the other version can't be opened in the one shown.
              disabled={!state.items[d.item.id]}
              onClick={() => openItem(d.item.id)}
            >
              {track && <span className="driver-track">{track.name}</span>}
              <span className="driver-value">
                {was !== value && <span className="driver-was">{was} →</span>}
                <span className="driver-impact">{value}</span>
                {partial && (
                  <span className="driver-when" title={`${Math.round(d.share * 100)}% of the full impact is gained in this period`}>
                    of {formatImpact(d.outcome.impact, d.outcome.unit)}
                  </span>
                )}
                {when ? (
                  <span className="driver-when" title={when.explicit ? undefined : 'Lands at the end of implementation'}>
                    {when.from}
                    {when.full && <span>{when.full}</span>}
                  </span>
                ) : (
                  <span className="driver-when">when built</span>
                )}
              </span>
              <span className="driver-main">
                <span className="driver-title">
                  {(umbrella ?? d.item).title}
                  {!umbrella && d.item.status !== 'planned' && <StatusPill status={d.item.status} />}
                </span>
                {umbrella && (
                  <span className="driver-part">
                    {d.item.title}
                    {d.item.status !== 'planned' && <StatusPill status={d.item.status} />}
                  </span>
                )}
              </span>
              {team && (
                <span className="driver-team">
                  <span className="im-team-dot" style={{ background: team.color }} />
                  {team.name}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
