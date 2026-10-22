import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarRange, ChevronLeft, ChevronRight, ChevronsRight, GripVertical, Inbox, Plus } from 'lucide-react';
import { fmtRange, todayDay } from '../../shared/dates.ts';
import { formatImpact } from '../../shared/impact.ts';
import { hasParts, partLabel, rollUp, umbrellaOf } from '../../shared/parts.ts';
import { PHASES, PHASE_LABELS, type Item, type PhaseKey, type Team } from '../../shared/types.ts';
import { FilterButton, SearchField, TimelineControls, ViewHeader, useTimelineShortcuts } from '../components/Toolbar.tsx';
import { StatusDot, StatusPill } from '../components/ui.tsx';
import { allDependencies, applyFilters, groupsFor, newItemPatch, outcomesOf, sortedTeams } from '../lib/model.ts';
import { usePersistentState } from '../lib/persist.ts';
import { createItem, navigate, openItem, setPrefs, updateItem, useApp, useCalendar, useReadOnly, useRoadmap } from '../store.ts';
import { ITEM_DRAG_TYPE, Timeline } from '../timeline/Timeline.tsx';

export function TeamView() {
  const state = useRoadmap();
  const readOnly = useReadOnly();
  const prefs = useApp((s) => s.prefs.team);
  const filters = useApp((s) => s.filters);
  const compare = useApp((s) => s.compare);
  const teamId = useApp((s) => s.route.teamId);
  const todayToken = useTimelineShortcuts('team');
  // One side panel at a time, closed by default: the sprint overview or the backlog.
  const [panel, setPanel] = usePersistentState<'sprint' | 'backlog' | null>('team-panel', null);
  const teams = sortedTeams(state);
  const team = teamId ? state.teams[teamId] : undefined;

  // The team plans parts, not the umbrellas they belong to (those are what leadership reads).
  const teamItems = useMemo(() => Object.values(state.items).filter((i) => i.teamId === teamId && !hasParts(state, i.id)), [state, teamId]);
  const items = useMemo(() => applyFilters(teamItems, state, filters, { ignoreTeams: true }), [teamItems, state, filters]);
  const scheduled = useMemo(() => items.filter((i) => Object.keys(i.phases).length > 0), [items]);
  const unscheduled = useMemo(() => items.filter((i) => Object.keys(i.phases).length === 0), [items]);
  const { groups, groupsOf } = useMemo(() => groupsFor(state, prefs.groupBy, scheduled), [state, prefs.groupBy, scheduled]);
  const newItemDefaults = useCallback(
    (groupId: string) => ({ teamId: teamId ?? undefined, ...(newItemPatch(prefs.groupBy, groupId, groups) ?? {}) }) as Partial<Item>,
    [teamId, prefs.groupBy, groups],
  );

  if (!team) {
    return (
      <div className="view">
        <ViewHeader title="Team" sub="Add a team in Settings to get started." />
      </div>
    );
  }

  return (
    <div className="view" style={{ '--c': team.color } as React.CSSProperties}>
      <ViewHeader
        title={<TeamPicker team={team} teams={teams} />}
        sub="Your plan, sprint by sprint. Tasks live in Jira; this is the layer above. Drag bars onto any row (several can share one); drag a bar’s bottom edge for two rows. Ideas without dates wait in the backlog."
        controls={
          <>
            <TimelineControls view="team" groupOptions={['none', 'umbrella', 'track', 'stage', 'tag']} />
            <button
              type="button"
              className={`btn sm${panel === 'sprint' ? ' is-active' : ''}`}
              onClick={() => setPanel((p) => (p === 'sprint' ? null : 'sprint'))}
              aria-pressed={panel === 'sprint'}
              aria-label="Sprint overview"
              title="Sprint overview"
            >
              <CalendarRange size={14} /> <span className="btn-label">Sprint overview</span>
            </button>
            <button
              type="button"
              className={`btn sm${panel === 'backlog' ? ' is-active' : ''}`}
              onClick={() => setPanel((p) => (p === 'backlog' ? null : 'backlog'))}
              aria-pressed={panel === 'backlog'}
              aria-label="Backlog"
              title="Backlog: ideas not on the roadmap yet"
            >
              <Inbox size={14} /> <span className="btn-label">Backlog</span>
              {unscheduled.length > 0 && <span className="badge" title="Ideas not on the roadmap yet">{unscheduled.length}</span>}
            </button>
          </>
        }
      >
        <SearchField />
        <FilterButton hideTeams />
      </ViewHeader>

      <div className="split">
        <div className="timeline-card">
          <Timeline
            state={state}
            items={scheduled}
            groups={groups}
            groupsOf={groupsOf}
            groupBy={prefs.groupBy}
            mode="list"
            phaseMode={prefs.phaseMode}
            pxPerDay={prefs.pxPerDay}
            onZoom={(pxPerDay) => setPrefs('team', { pxPerDay })}
            colorBy="board"
            showDeps={false}
            compare={compare?.state ?? null}
            readOnly={readOnly}
            collapsed={prefs.collapsed}
            onToggleGroup={(id) => setPrefs('team', { collapsed: prefs.collapsed.includes(id) ? prefs.collapsed.filter((c) => c !== id) : [...prefs.collapsed, id] })}
            newItemDefaults={newItemDefaults}
            todayToken={todayToken}
          />
        </div>
        {panel === 'sprint' && <SprintPanel teamItems={teamItems} teamId={team.id} onClose={() => setPanel(null)} />}
        {panel === 'backlog' && <BacklogPanel items={unscheduled} teamId={team.id} onClose={() => setPanel(null)} />}
      </div>
    </div>
  );
}

/** The view title doubles as the team switcher, so it works with the sidebar collapsed too. Next to it: the team's owners. */
function TeamPicker({ team, teams }: { team: Team; teams: Team[] }) {
  const owners = (
    [
      ['PM', team.pm],
      ['EM', team.em],
      ['UX', team.ux],
    ] as const
  ).filter(([, name]) => name);
  return (
    <span className="team-title">
      <span className="team-title-dot" />
      <select
        id="team-picker"
        className="team-select"
        value={team.id}
        onChange={(e) => navigate({ view: 'team', teamId: e.target.value, itemId: null })}
        aria-label="Team"
        title={owners.length ? owners.map(([role, name]) => `${role}: ${name}`).join('\n') : undefined}
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {owners.length > 0 && (
        <span className="team-epd" title={owners.map(([role, name]) => `${role}: ${name}`).join('\n')}>
          {owners.map(([role, name]) => (
            <span key={role}>
              <span className="team-epd-role">{role}</span> {name.split(' ')[0]}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function SprintPanel({ teamItems, teamId, onClose }: { teamItems: Item[]; teamId: string; onClose: () => void }) {
  const state = useRoadmap();
  const cal = useCalendar();
  const current = cal.indexOf(todayDay());
  const [index, setIndex] = useState(current);
  const sprint = cal.get(index);

  const byPhase = useMemo(() => {
    const out: Record<PhaseKey, { item: Item; starts: boolean; ends: boolean }[]> = { discovery: [], ux: [], implementation: [] };
    for (const item of teamItems) {
      for (const p of PHASES) {
        const span = item.phases[p];
        if (!span) continue;
        const [a, b] = cal.spanIndexes(span);
        if (index >= a && index < b) out[p].push({ item, starts: index === a, ends: index === b - 1 });
      }
    }
    for (const p of PHASES) out[p].sort((x, y) => x.item.order - y.item.order);
    return out;
  }, [teamItems, cal, index]);

  // Umbrellas take their dates from their parts.
  const deps = useMemo(() => allDependencies(rollUp(state), (d) => cal.indexOf(d)), [state, cal]);
  const incoming = deps.filter((d) => d.targetTeamId === teamId && d.from.teamId !== teamId && d.dep.status !== 'done');
  const outgoing = deps.filter((d) => d.from.teamId === teamId && d.dep.status !== 'done');

  const label = index === current ? 'Current sprint' : index === current + 1 ? 'Next sprint' : index < current ? 'Past sprint' : 'Upcoming sprint';
  return (
    <aside className="side-panel sprint-panel" aria-label="Sprint overview">
      <div className="side-head">
        <div className="focus-nav">
          <button type="button" className="icon-btn" onClick={() => setIndex((i) => i - 1)} aria-label="Previous sprint">
            <ChevronLeft size={16} />
          </button>
          <div className="focus-sprint-name">
            <span className="mono">{sprint.code}</span>
            <span className="focus-sprint-kind">{sprint.kind}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setIndex((i) => i + 1)} aria-label="Next sprint">
            <ChevronRight size={16} />
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide sprint overview">
          <ChevronsRight size={16} />
        </button>
      </div>
      <div className="focus-sprint-meta">
        <span className={index === current ? 'is-now' : ''}>{label}</span>
        <span>{fmtRange(sprint.start, sprint.end, true)}</span>
        {index !== current && (
          <button type="button" className="link-btn sm" onClick={() => setIndex(current)}>
            Back to now
          </button>
        )}
      </div>
      <div className="side-body">
        {PHASES.map((p) => (
          <section key={p} className="focus-col">
            <div className="focus-col-head">
              <span className={`phase-swatch ${p}`} />
              {PHASE_LABELS[p]}
              <span className="focus-count">{byPhase[p].length}</span>
            </div>
            {byPhase[p].length === 0 && <div className="focus-empty">Nothing in {p === 'ux' ? 'UX' : PHASE_LABELS[p].toLowerCase()}</div>}
            {byPhase[p].map(({ item, starts, ends }) => (
              <button key={item.id} type="button" className="focus-item" onClick={() => openItem(item.id)}>
                <StatusDot status={item.status} />
                <span className="focus-item-title">{item.title}</span>
                {starts && <span className="focus-tag start">starts</span>}
                {ends && <span className="focus-tag end">ends</span>}
              </button>
            ))}
          </section>
        ))}

        <section className="focus-col">
          <div className="focus-col-head">
            Others need from us <span className="focus-count">{incoming.length}</span>
          </div>
          {incoming.length === 0 && <div className="focus-empty">No open requests</div>}
          {incoming.map((d) => (
            <button key={`${d.from.id}-${d.dep.id}`} type="button" className={`focus-item${d.conflict ? ' is-conflict' : ''}`} onClick={() => openItem(d.target?.id ?? d.from.id)}>
              {d.conflict && <AlertTriangle size={13} />}
              <span className="focus-item-title">
                <span className="muted">{state.teams[d.from.teamId]?.name}: </span>
                {d.target ? d.target.title : d.dep.note || d.from.title}
              </span>
            </button>
          ))}
        </section>

        <section className="focus-col">
          <div className="focus-col-head">
            We need from others <span className="focus-count">{outgoing.length}</span>
          </div>
          {outgoing.length === 0 && <div className="focus-empty">No open dependencies</div>}
          {outgoing.map((d) => (
            <button key={`${d.from.id}-${d.dep.id}`} type="button" className={`focus-item${d.conflict ? ' is-conflict' : ''}`} onClick={() => openItem(d.from.id)}>
              {d.conflict && <AlertTriangle size={13} />}
              <span className="focus-item-title">
                <span className="muted">{d.targetTeamId ? state.teams[d.targetTeamId]?.name : ''}: </span>
                {d.target?.title ?? (d.dep.note || 'unplanned')}
              </span>
            </button>
          ))}
        </section>

      </div>
    </aside>
  );
}

/** Ideas the team hasn't put on the roadmap yet: add them quickly, see what they'd move, drag them onto the roadmap. */
function BacklogPanel({ items, teamId, onClose }: { items: Item[]; teamId: string; onClose: () => void }) {
  const readOnly = useReadOnly();
  const cal = useCalendar();
  const [title, setTitle] = useState('');
  // Newest first: the latest ideas are the ones being talked about.
  const sorted = [...items].sort((a, b) => b.order - a.order);
  const next = cal.get(cal.indexOf(todayDay()) + 1);
  const add = () => {
    const t = title.trim();
    if (!t) return;
    createItem({ teamId, title: t, phases: {} }, { open: false });
    setTitle('');
  };
  return (
    <aside className="side-panel backlog-panel" aria-label="Backlog">
      <div className="side-head">
        <h2 className="backlog-title">
          <Inbox size={15} /> Backlog <span className="focus-count">{items.length}</span>
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide the backlog">
          <ChevronsRight size={16} />
        </button>
      </div>
      {!readOnly && (
        <div className="backlog-add">
          <Plus size={14} />
          <input
            className="backlog-input"
            value={title}
            placeholder="Add an idea, then Enter"
            aria-label="New backlog idea"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              } else if (e.key === 'Escape') setTitle('');
            }}
          />
        </div>
      )}
      <div className="side-body backlog-list">
        {items.length === 0 && <p className="muted sm">Nothing here yet. Ideas that aren’t on the roadmap yet live here.</p>}
        {sorted.map((item) => (
          <BacklogRow
            key={item.id}
            item={item}
            readOnly={readOnly}
            nextCode={next.code}
            onSchedule={() => updateItem(item.id, { phases: { implementation: cal.spanFromIndexes(next.index, next.index + 1) } }, `Scheduled “${item.title}” in ${next.code}`, { undoToast: true })}
          />
        ))}
        {items.length > 0 && !readOnly && <p className="muted sm backlog-hint">Drag an idea onto the roadmap to put it in that sprint and row.</p>}
      </div>
    </aside>
  );
}

function BacklogRow({ item, readOnly, nextCode, onSchedule }: { item: Item; readOnly: boolean; nextCode: string; onSchedule: () => void }) {
  const state = useRoadmap();
  const stages = new Map(state.settings.funnelStages.map((s) => [s.id, s]));
  const umbrella = umbrellaOf(state, item);
  const named = umbrella ? partLabel(umbrella, item) : null;
  const outcomes = outcomesOf(state, item);
  return (
    <div
      className="backlog-row"
      draggable={!readOnly}
      onDragStart={(e) => {
        e.dataTransfer.setData(ITEM_DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      {!readOnly && <GripVertical size={14} className="backlog-grip" aria-hidden="true" />}
      <div className="backlog-main">
        <button type="button" className="backlog-name" onClick={() => openItem(item.id)}>
          {named?.prefix && <span className="backlog-parent">{named.prefix}</span>}
          {item.title}
        </button>
        {(outcomes.length > 0 || item.status !== 'planned') && (
          <div className="backlog-meta">
            {item.status !== 'planned' && <StatusPill status={item.status} />}
            {outcomes.map((o) => {
              const stage = stages.get(o.stageId);
              return (
                <span key={o.id} className="oc-tag" style={{ '--c': stage?.color ?? '#888' } as React.CSSProperties}>
                  <span className="oc-dot" />
                  {stage?.name ?? 'Funnel'}
                  {o.impact !== null && <strong>{formatImpact(o.impact, o.unit)}</strong>}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {!readOnly && (
        <button type="button" className="link-btn sm backlog-schedule" onClick={onSchedule} title={`Put it on the roadmap in ${nextCode} (one sprint)`}>
          {nextCode} <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}
