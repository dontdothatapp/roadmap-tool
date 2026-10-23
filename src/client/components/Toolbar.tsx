import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Crosshair, Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { STATUSES, STATUS_LABELS, type Status } from '../../shared/types.ts';
import { allTags, sortedTeams, sortedTracks, STATUS_COLORS } from '../lib/model.ts';
import { uiBus } from '../lib/bus.ts';
import { activeFilterCount, clearFilters, setFilters, setPrefs, useApp, useRoadmap, type ColorBy, type GroupBy, type PhaseMode, type TimelineView } from '../store.ts';
import { MAX_ZOOM, MIN_ZOOM } from '../timeline/Timeline.tsx';
import { TagPicker } from './TagPicker.tsx';
import { Popover, Segmented, Toggle } from './ui.tsx';

/**
 * One compact row per view: title, view controls, then search and filters on the right.
 * `sub` explains the view; it shows as a tooltip on the title to save vertical space.
 */
export function ViewHeader({ title, sub, controls, children }: { title: ReactNode; sub?: string; controls?: ReactNode; children?: ReactNode }) {
  return (
    <div className="view-bar">
      <h1 className="view-name" title={sub}>
        {title}
      </h1>
      {controls && <div className="controls">{controls}</div>}
      {children && <div className="view-tools">{children}</div>}
    </div>
  );
}

const ZOOMS = [
  { px: 9, label: 'Sprints' },
  { px: 4.5, label: 'Months' },
  { px: 2.2, label: 'Quarters' },
  { px: 1.1, label: 'Year' },
];

export function PhaseLegend() {
  return (
    <span className="phase-legend" aria-hidden="true">
      <span className="phase-swatch discovery" />
      Discovery
      <span className="phase-swatch ux" />
      UX
      <span className="phase-swatch implementation" />
      Implementation
    </span>
  );
}

/**
 * Phase display, zoom and "today" stay visible; grouping, colour and toggles live in the Display menu.
 * `extra` adds view-specific items to that menu.
 */
export function TimelineControls({
  view,
  groupOptions,
  colorOptions = false,
  depsToggle = false,
  extra,
}: {
  view: TimelineView;
  groupOptions?: GroupBy[];
  colorOptions?: boolean;
  depsToggle?: boolean;
  extra?: ReactNode;
}) {
  const prefs = useApp((s) => s.prefs[view]);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const closest = ZOOMS.reduce((a, b) => (Math.abs(Math.log(b.px / prefs.pxPerDay)) < Math.abs(Math.log(a.px / prefs.pxPerDay)) ? b : a));
  const zoomValue = Math.abs(Math.log(closest.px / prefs.pxPerDay)) < 0.2 ? closest.px : -1;
  const groupLabels: Record<GroupBy, string> = {
    none: 'No grouping',
    team: 'Team',
    track: 'Strategic bet',
    umbrella: 'Umbrella',
    stage: 'Funnel stage',
    tag: 'Tag',
  };
  const hasMenu = !!(groupOptions || colorOptions || depsToggle || extra);
  return (
    <>
      <Segmented<PhaseMode>
        label="Phases"
        size="sm"
        value={prefs.phaseMode}
        onChange={(phaseMode) => setPrefs(view, { phaseMode })}
        options={[
          { value: 'separate', label: 'Phases', title: 'Discovery, UX and Implementation on separate lines' },
          { value: 'combined', label: 'Combined', title: 'One bar from the first phase to the last' },
          {
            value: 'implementation',
            label: (
              <>
                <span className="lbl-long">Implementation</span>
                <span className="lbl-short">Impl.</span>
              </>
            ),
            title: 'Only the implementation phase',
          },
        ]}
      />
      <Segmented<number>
        label="Zoom"
        size="sm"
        value={zoomValue}
        onChange={(pxPerDay) => setPrefs(view, { pxPerDay })}
        options={ZOOMS.map((z) => ({ value: z.px, label: z.label }))}
      />
      <button type="button" className="icon-btn" onClick={() => uiBus.dispatchEvent(new Event('today'))} title="Scroll to today (T)" aria-label="Scroll to today">
        <Crosshair size={16} />
      </button>
      {hasMenu && (
        <>
          <button
            type="button"
            ref={setAnchor}
            className={`btn sm${open ? ' is-active' : ''}`}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="Display options"
            title="Display options"
          >
            <SlidersHorizontal size={14} />
            <span className="btn-label">Display</span>
          </button>
          <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={250}>
            <div className="display-menu">
              {groupOptions && (
                <label className="display-row" htmlFor={`${view}-group`}>
                  <span>Group by</span>
                  <select className="select sm" value={prefs.groupBy} onChange={(e) => setPrefs(view, { groupBy: e.target.value as GroupBy, collapsed: [] })} id={`${view}-group`}>
                    {groupOptions.map((g) => (
                      <option key={g} value={g}>
                        {groupLabels[g]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {colorOptions && (
                <label className="display-row" htmlFor={`${view}-color`}>
                  <span>Colour by</span>
                  <select className="select sm" value={prefs.colorBy} onChange={(e) => setPrefs(view, { colorBy: e.target.value as ColorBy })} id={`${view}-color`}>
                    <option value="team">Team</option>
                    <option value="track">Strategic bet</option>
                  </select>
                </label>
              )}
              {depsToggle && <Toggle id={`${view}-deps`} checked={prefs.showDeps} onChange={(showDeps) => setPrefs(view, { showDeps })} label="Show all dependency arrows" />}
              {extra}
            </div>
          </Popover>
        </>
      )}
    </>
  );
}

/**
 * A row for the display menu: open or close every umbrella in the view at once (`ids`: the umbrellas shown).
 * `label: null` leaves out the row's name, under a row that already says "Umbrellas".
 */
export function UmbrellaToggles({ view, ids, label = 'Umbrellas' }: { view: TimelineView; ids: string[]; label?: string | null }) {
  const expanded = useApp((s) => s.prefs[view].expanded);
  if (ids.length === 0) return null;
  const open = ids.filter((id) => expanded.includes(id)).length;
  return (
    <div className="display-row is-stacked">
      {label && <span>{label}</span>}
      <span className="display-btns">
        <button type="button" className="btn sm" disabled={open === ids.length} onClick={() => setPrefs(view, { expanded: [...new Set([...expanded, ...ids])] })}>
          Expand all
        </button>
        <button type="button" className="btn sm" disabled={open === 0} onClick={() => setPrefs(view, { expanded: expanded.filter((id) => !ids.includes(id)) })}>
          Collapse all
        </button>
      </span>
    </div>
  );
}

/** Wires the T / + / − shortcuts to the visible timeline. Returns a token that changes when "today" is requested. */
export function useTimelineShortcuts(view: TimelineView): number {
  const [token, setToken] = useState(0);
  useEffect(() => {
    const today = () => setToken((t) => t + 1);
    const zoom = (factor: number) => () => {
      const px = useApp.getState().prefs[view].pxPerDay;
      setPrefs(view, { pxPerDay: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(px * factor * 100) / 100)) });
    };
    const zin = zoom(1.35);
    const zout = zoom(1 / 1.35);
    uiBus.addEventListener('today', today);
    uiBus.addEventListener('in', zin);
    uiBus.addEventListener('out', zout);
    return () => {
      uiBus.removeEventListener('today', today);
      uiBus.removeEventListener('in', zin);
      uiBus.removeEventListener('out', zout);
    };
  }, [view]);
  return token;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function SearchField() {
  const q = useApp((s) => s.filters.q);
  const ref = useRef<HTMLInputElement>(null);
  return (
    // The whole field focuses the input, so it also works when narrow screens shrink it to its icon.
    <div className={`search-field${q ? ' has-value' : ''}`} onClick={() => ref.current?.focus()}>
      <Search size={14} />
      <input
        ref={ref}
        id="filter-search"
        value={q}
        onChange={(e) => setFilters({ q: e.target.value })}
        placeholder="Filter by name, team or #tag"
        aria-label="Filter initiatives"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setFilters({ q: '' });
            ref.current?.blur();
          }
        }}
      />
      {q && (
        <button type="button" className="icon-btn xs" onClick={() => setFilters({ q: '' })} aria-label="Clear filter">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function FilterButton({ hideTeams = false }: { hideTeams?: boolean }) {
  const filters = useApp((s) => s.filters);
  const state = useRoadmap();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const count = activeFilterCount({ ...filters, q: '', teams: hideTeams ? [] : filters.teams });
  const tags = allTags(state);
  return (
    <>
      <button type="button" ref={setAnchor} className={`btn${count ? ' is-active' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Filters" title="Filters">
        <Filter size={14} />
        <span className="btn-label">Filters</span>
        {count > 0 && <span className="badge">{count}</span>}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align="end" width={340}>
        <div className="filters">
          {!hideTeams && (
            <section>
              <h4>Teams</h4>
              <div className="chips">
                {sortedTeams(state).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip${filters.teams.includes(t.id) ? ' is-on' : ''}`}
                    style={{ '--c': t.color } as React.CSSProperties}
                    onClick={() => setFilters({ teams: toggle(filters.teams, t.id) })}
                  >
                    <span className="chip-dot" />
                    {t.name}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h4>Strategic bets</h4>
            <div className="chips">
              {sortedTracks(state).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip${filters.tracks.includes(t.id) ? ' is-on' : ''}`}
                  style={{ '--c': t.color } as React.CSSProperties}
                  onClick={() => setFilters({ tracks: toggle(filters.tracks, t.id) })}
                >
                  <span className="chip-dot" />
                  {t.name}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h4>Status</h4>
            <div className="chips">
              {STATUSES.map((s: Status) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${filters.statuses.includes(s) ? ' is-on' : ''}`}
                  style={{ '--c': STATUS_COLORS[s] } as React.CSSProperties}
                  onClick={() => setFilters({ statuses: toggle(filters.statuses, s) })}
                >
                  <span className="chip-dot" />
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </section>
          {tags.length > 0 && (
            <section>
              <h4>
                <label htmlFor="filter-tags">Tags</label>
              </h4>
              <TagPicker id="filter-tags" state={state} selected={filters.tags} placeholder="Any tag" onToggle={(t) => setFilters({ tags: toggle(filters.tags, t) })} />
            </section>
          )}
          <div className="filters-foot">
            <button type="button" className="btn ghost sm" onClick={clearFilters} disabled={activeFilterCount(filters) === 0}>
              Clear all filters
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}
