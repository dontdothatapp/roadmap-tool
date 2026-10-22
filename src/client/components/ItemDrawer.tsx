import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, Copy, CopyPlus, FileText, Link2, Plus, Trash2, TrendingUp, X } from 'lucide-react';
import { BOARD_COLORS, DEFAULT_BOARD_COLOR, boardColor, boardColorOf } from '../../shared/colors.ts';
import { fmtRange, relativeTime, toDay, todayDay, fromDay } from '../../shared/dates.ts';
import { describeChange, epdLine } from '../../shared/describe.ts';
import { formatImpact, landingMonth, landingText, monthLabel, monthNo, monthStart } from '../../shared/impact.ts';
import { hasParts, linkOps, linkedOutcomes, partsOf, rollUp, umbrellaOf } from '../../shared/parts.ts';
import { overallSpan, type SprintCalendar } from '../../shared/sprints.ts';
import {
  DEPENDENCY_STATUSES,
  DEPENDENCY_STATUS_LABELS,
  IMPACT_UNITS,
  PHASES,
  PHASE_LABELS,
  type Dependency,
  type ID,
  type Item,
  type Link,
  type Op,
  type Outcome,
  type PhaseKey,
  type RoadmapState,
  type Span,
} from '../../shared/types.ts';
import { displayName, uid } from '../../shared/util.ts';
import { useHistoryRows } from '../lib/historyRows.ts';
import { allTags, dependencyInfo, sortedTeams, sortedTracks } from '../lib/model.ts';
import {
  closeItem,
  createItem,
  deleteItem,
  dispatch,
  duplicateItem,
  openItem,
  setPhase,
  toast,
  updateItem,
  useApp,
  useCalendar,
  useReadOnly,
  useRoadmap,
} from '../store.ts';
import { Avatar, ConfirmButton, Popover, StatusPill } from './ui.tsx';

// --- small editing primitives ------------------------------------------------------------

function CommitText({
  value,
  onCommit,
  multiline = false,
  wrap = false,
  placeholder,
  id,
  className = 'input',
  disabled,
  autoFocus,
  list,
  type = 'text',
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  /** Several lines; Enter adds a line break and ⌘/Ctrl+Enter saves. */
  multiline?: boolean;
  /** One line that wraps visually (titles); Enter saves. */
  wrap?: boolean;
  placeholder?: string;
  id: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  list?: string;
  type?: string;
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  // The value this edit started from. Only a real change from it is saved, so focusing a field
  // and leaving it never writes back an old value over someone else's newer change.
  const base = useRef(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const textarea = multiline || wrap;
  // Latest values for saving an in-progress edit when the field goes away (drawer closed, other item opened).
  const latest = useRef({ v, onCommit });
  latest.current = { v, onCommit };
  useEffect(
    () => () => {
      const { v: draft, onCommit: save } = latest.current;
      if (focused.current && draft !== base.current) save(draft);
    },
    [],
  );
  useEffect(() => {
    // Follow outside changes unless the person has started typing here.
    if (!focused.current || v === base.current) {
      setV(value);
      base.current = value;
    }
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (el && textarea) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    }
  }, [v, textarea]);
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocus]);
  const props = {
    id,
    ref,
    value: v,
    disabled,
    placeholder,
    className,
    'aria-label': ariaLabel,
    onFocus: () => {
      focused.current = true;
      base.current = value;
    },
    onBlur: () => {
      focused.current = false;
      if (v !== base.current) onCommit(v);
      base.current = value;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(wrap ? e.target.value.replace(/\n/g, ' ') : e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setV(base.current);
        e.stopPropagation();
        requestAnimationFrame(() => ref.current?.blur());
      }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ref.current?.blur();
      }
    },
  };
  return textarea ? <textarea rows={1} {...props} /> : <input type={type} list={list} {...props} />;
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="dr-section">
      <div className="dr-section-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// --- drawer ----------------------------------------------------------------------------------

export function ItemDrawer({ id }: { id: ID }) {
  const state = useRoadmap();
  const readOnly = useReadOnly();
  const cal = useCalendar();
  const focusTitle = useApp((s) => s.focusTitle === id);
  const item = state.items[id];

  useEffect(() => {
    if (focusTitle) useApp.setState({ focusTitle: null });
  }, [focusTitle]);

  if (!item) {
    return (
      <aside className="drawer" aria-label="Initiative details">
        <div className="dr-head">
          <span className="muted">Not found</span>
          <button type="button" className="icon-btn" onClick={closeItem} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="dr-body">
          <p className="muted">{readOnly ? 'This initiative didn’t exist at that point in time.' : 'This initiative was deleted.'}</p>
        </div>
      </aside>
    );
  }

  const team = state.teams[item.teamId];
  // An umbrella's dates come from its parts; a part shares its umbrella's outcomes.
  const rolled = rollUp(state);
  const shown = rolled.items[item.id] ?? item;
  const umbrella = umbrellaOf(state, item);
  const isUmbrella = hasParts(state, item.id);
  const patch = (p: Partial<Item>, label?: string) => updateItem(item.id, p, label);

  return (
    <aside className="drawer" aria-label={`Details of ${item.title}`} style={{ '--c': team?.color ?? '#888' } as React.CSSProperties}>
      <div className="dr-head">
        <div className="dr-head-left">
          <span className="dr-team-bar" />
          <select
            id="dr-team"
            className="select ghost strong"
            value={item.teamId}
            disabled={readOnly}
            onChange={(e) => patch({ teamId: e.target.value }, `Moved “${item.title}” to ${state.teams[e.target.value]?.name}`)}
            aria-label="Team"
            title={team && epdLine(team) ? `Owned by ${epdLine(team)}` : undefined}
          >
            {!team && <option value={item.teamId}>Deleted team</option>}
            {sortedTeams(state, true).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dr-head-right">
          <button
            type="button"
            className="icon-btn"
            title="Copy link"
            aria-label="Copy link"
            onClick={() => {
              const url = location.href;
              navigator.clipboard?.writeText(url).then(
                () => toast('Link copied'),
                () => toast(url),
              );
            }}
          >
            <Link2 size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={closeItem} aria-label="Close" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="dr-body">
        {umbrella && (
          <div className="dr-umbrella">
            Part of{' '}
            <button type="button" className="link-btn" onClick={() => openItem(umbrella.id)}>
              {umbrella.title}
            </button>
          </div>
        )}
        <CommitText
          id="dr-title"
          className="dr-title"
          value={item.title}
          wrap
          autoFocus={focusTitle}
          disabled={readOnly}
          onCommit={(title) => patch({ title }, `Renamed “${item.title}”`)}
          ariaLabel="Title"
        />

        {/* The roadmap shows where work stands; only done and at risk are flagged. */}
        <div className="dr-flags">
          <button
            type="button"
            className={`flag-btn is-done${item.status === 'done' ? ' is-on' : ''}`}
            aria-pressed={item.status === 'done'}
            disabled={readOnly}
            onClick={() => patch({ status: item.status === 'done' ? 'planned' : 'done' }, item.status === 'done' ? `Reopened “${item.title}”` : `Marked “${item.title}” as done`)}
          >
            <Check size={14} /> {item.status === 'done' ? 'Done' : 'Mark as done'}
          </button>
          <button
            type="button"
            className={`flag-btn is-risk${item.status === 'at_risk' ? ' is-on' : ''}`}
            aria-pressed={item.status === 'at_risk'}
            disabled={readOnly}
            onClick={() => patch({ status: item.status === 'at_risk' ? 'planned' : 'at_risk' }, item.status === 'at_risk' ? `“${item.title}” is no longer at risk` : `Marked “${item.title}” at risk`)}
          >
            <AlertTriangle size={14} /> {item.status === 'at_risk' ? 'At risk' : 'Mark at risk'}
          </button>
        </div>

        <div className="dr-props">
          <label htmlFor="dr-track">Strategic bet</label>
          <select id="dr-track" className="select" value={item.trackId ?? ''} disabled={readOnly} onChange={(e) => patch({ trackId: e.target.value || null })}>
            <option value="">No strategic bet</option>
            {sortedTracks(state).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <label htmlFor="dr-tags">Tags</label>
          <TagInput item={item} state={state} readOnly={readOnly} />

          {!isUmbrella && (
            <>
              <label htmlFor="dr-parent">Part of</label>
              <PartOfField item={item} state={state} readOnly={readOnly} />
            </>
          )}

          <label htmlFor="dr-color">Colour</label>
          <ColorField item={item} state={state} readOnly={readOnly} />
        </div>

        {isUmbrella ? (
          <Section title="Parts" aside={<ScheduleSummary item={shown} cal={cal} />}>
            <PartsEditor item={item} state={state} cal={cal} readOnly={readOnly} />
          </Section>
        ) : (
          <Section title="Schedule" aside={<ScheduleSummary item={item} cal={cal} />}>
            <ScheduleEditor item={item} cal={cal} readOnly={readOnly} />
            {!umbrella && !readOnly && Object.keys(item.phases).length > 0 && (
              <button type="button" className="link-btn sm split-btn" onClick={() => splitIntoParts(item)} title="Plan it as iterations, releases or parallel streams under this name">
                <Plus size={13} /> Split into parts
              </button>
            )}
          </Section>
        )}

        <Section title="Description">
          <CommitText
            id="dr-desc"
            className="input textarea"
            multiline
            value={item.description}
            placeholder="What is it and why does it matter? Keep it short; the one-pager has the details."
            disabled={readOnly}
            onCommit={(description) => patch({ description })}
          />
        </Section>

        <Section title="One-pager & links">
          {/* The one-pager belongs to the umbrella: a part shows and edits its umbrella's. */}
          <OnePagerRow
            target={umbrella ?? item}
            readOnly={readOnly}
            note={
              umbrella ? (
                <>
                  Shared by all parts of{' '}
                  <button type="button" className="link-btn sm" onClick={() => openItem(umbrella.id)}>
                    {umbrella.title}
                  </button>
                </>
              ) : isUmbrella ? (
                `Shared with its ${partsOf(state, item.id).length} parts`
              ) : null
            }
          />
          {umbrella && item.onePagerUrl && (
            // A one-pager the part had before it was linked: still its own, until it's removed or moved.
            <OnePagerRow target={item} readOnly={readOnly} note="This part’s own one-pager, from before it was linked" />
          )}
          <LinksEditor item={item} readOnly={readOnly} />
        </Section>

        <Section title="Expected outcomes">
          <OutcomesEditor item={item} state={state} readOnly={readOnly} />
        </Section>

        <Section title="Dependencies">
          <DependenciesEditor item={shown} state={rolled} cal={cal} readOnly={readOnly} />
        </Section>

        <Section title="Activity">
          <ItemActivity key={item.id} item={item} state={state} cal={cal} readOnly={readOnly} />
        </Section>
      </div>

      {!readOnly && (
        <div className="dr-foot">
          <button type="button" className="btn ghost" onClick={() => duplicateItem(item.id)}>
            <CopyPlus size={14} /> Duplicate
          </button>
          <ConfirmButton onConfirm={() => deleteItem(item.id)} confirmLabel="Click again to delete">
            <Trash2 size={14} /> Delete
          </ConfirmButton>
        </div>
      )}
    </aside>
  );
}

function ScheduleSummary({ item, cal }: { item: Item; cal: SprintCalendar }) {
  const span = overallSpan(item);
  if (!span) return <span className="muted sm">Not scheduled</span>;
  const weeks = Math.round((toDay(span.end) - toDay(span.start)) / 7);
  return (
    <span className="muted sm">
      <span className="mono">{cal.spanCode(span)}</span> · {weeks} week{weeks === 1 ? '' : 's'}
    </span>
  );
}

function sprintOptions(cal: SprintCalendar, include: number[]) {
  const now = cal.indexOf(todayDay());
  let from = now - 15;
  let to = now + 45;
  for (const i of include) {
    from = Math.min(from, i - 3);
    to = Math.max(to, i + 3);
  }
  const out = [];
  for (let i = from; i <= to; i++) out.push(cal.get(i));
  return out;
}

/** Where a newly added phase goes: one sprint, right after the phases before it, or right before the ones after it. */
function defaultPhaseSpan(item: Item, phase: PhaseKey, cal: SprintCalendar): Span {
  const order = PHASES.indexOf(phase);
  const before = PHASES.slice(0, order).map((p) => item.phases[p]).filter(Boolean);
  const after = PHASES.slice(order + 1).map((p) => item.phases[p]).filter(Boolean);
  let start: number;
  if (before.length) start = cal.spanIndexes(before[before.length - 1]!)[1];
  else if (after.length) start = cal.spanIndexes(after[0]!)[0] - 1;
  else start = cal.indexOf(todayDay()) + 1;
  return cal.spanFromIndexes(start, start + 1);
}

/** Two lines: the phases (pick one, or add a missing one), then the sprints of the picked phase. */
function ScheduleEditor({ item, cal, readOnly }: { item: Item; cal: SprintCalendar; readOnly: boolean }) {
  const present = PHASES.filter((p) => item.phases[p]);
  const fallback: PhaseKey = present.includes('implementation') ? 'implementation' : (present[0] ?? 'implementation');
  const [picked, setPicked] = useState<PhaseKey | null>(null);
  const selected = picked && item.phases[picked] ? picked : fallback;
  const span = item.phases[selected];
  return (
    <div className="schedule">
      <div className="ph-chips" role="tablist" aria-label="Phases">
        {PHASES.map((p) => {
          const s = item.phases[p];
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={!!s && p === selected}
              className={`ph-chip${s ? ' is-set' : ''}${s && p === selected ? ' is-selected' : ''}`}
              disabled={!s && readOnly}
              title={s ? `${PHASE_LABELS[p]}: ${cal.describeSpan(s)}` : `Add ${PHASE_LABELS[p]} (one sprint)`}
              onClick={() => {
                if (!s) setPhase(item.id, p, defaultPhaseSpan(item, p, cal));
                setPicked(p);
              }}
            >
              <span className="ph-chip-top">
                {s ? <span className={`phase-swatch ${p}`} /> : <Plus size={12} />}
                <span className="ph-chip-name">{PHASE_LABELS[p]}</span>
              </span>
              <span className={`ph-chip-code${s ? ' mono' : ''}`}>{s ? cal.spanCode(s) : 'Add one sprint'}</span>
            </button>
          );
        })}
      </div>
      {span ? (
        <div className="ph-range">
          <SprintRangePicker
            span={span}
            cal={cal}
            label={PHASE_LABELS[selected]}
            disabled={readOnly}
            onChange={(next) => setPhase(item.id, selected, next)}
          />
          {!readOnly && (
            <button
              type="button"
              className="icon-btn xs"
              onClick={() => setPhase(item.id, selected, null)}
              aria-label={`Remove ${PHASE_LABELS[selected]}`}
              title={`Remove ${PHASE_LABELS[selected]}`}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ) : (
        <p className="muted sm ph-empty">Not on the roadmap yet (it’s in the team’s backlog). Pick a phase above to schedule it.</p>
      )}
    </div>
  );
}

/** One control for both ends of a phase: click the first sprint, then the last (or stop after one for a single sprint). */
function SprintRangePicker({
  span,
  cal,
  label,
  disabled,
  onChange,
}: {
  span: Span;
  cal: SprintCalendar;
  label: string;
  disabled: boolean;
  onChange: (span: Span) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [a, b] = cal.spanIndexes(span);
  const now = cal.indexOf(todayDay());
  const options = sprintOptions(cal, [a, b - 1]);
  const close = () => {
    setOpen(false);
    setFirst(null);
    setHover(null);
  };
  useEffect(() => {
    if (open) listRef.current?.querySelector('.is-start')?.scrollIntoView({ block: 'center' });
  }, [open]);
  // While choosing the last sprint, show the range it would make.
  const [lo, hi] = first !== null ? [Math.min(first, hover ?? first), Math.max(first, hover ?? first) + 1] : [a, b];
  const count = b - a;
  return (
    <>
      <button
        type="button"
        ref={setAnchorEl}
        className={`range-btn${open ? ' is-open' : ''}`}
        disabled={disabled}
        aria-label={`${label}: ${cal.describeSpan(span)}. Change sprints`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="mono range-codes">
          {cal.get(a).code}
          {count > 1 && (
            <>
              <ArrowRight size={12} /> {cal.get(b - 1).code}
            </>
          )}
        </span>
        <span className="range-dates">{fmtRange(cal.get(a).start, cal.get(b - 1).end)}</span>
        <span className="range-count">
          {count} sprint{count === 1 ? '' : 's'}
        </span>
      </button>
      <Popover anchor={anchorEl} open={open} onClose={close} width={280}>
        <div className="range-pop">
          <div className="range-hint">{first === null ? `${label}: pick the first sprint` : 'Now the last sprint (or close for just one)'}</div>
          <div className="range-list" ref={listRef} onPointerLeave={() => setHover(null)}>
            {options.map((s) => {
              const inRange = s.index >= lo && s.index < hi;
              return (
                <button
                  key={s.index}
                  type="button"
                  className={`range-opt${inRange ? ' is-in' : ''}${s.index === lo ? ' is-start' : ''}${s.index === hi - 1 ? ' is-end' : ''}${s.highlight ? ' is-hl' : ''}`}
                  onPointerEnter={() => setHover(s.index)}
                  onClick={() => {
                    if (first === null) {
                      // One sprint right away; a second click stretches it.
                      setFirst(s.index);
                      onChange(cal.spanFromIndexes(s.index, s.index + 1));
                    } else {
                      onChange(cal.spanFromIndexes(Math.min(first, s.index), Math.max(first, s.index) + 1));
                      close();
                    }
                  }}
                >
                  <span className="mono range-opt-code">{s.code}</span>
                  <span className="range-opt-dates">{fmtRange(s.start, s.end)}</span>
                  {s.index === now && <span className="range-now">now</span>}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
    </>
  );
}

/** Turns a standalone initiative into an umbrella: its dates become its first part. */
function splitIntoParts(item: Item) {
  const id = uid();
  dispatch(
    [
      {
        kind: 'create',
        entity: 'item',
        id,
        data: { title: 'Part 1', teamId: item.teamId, trackId: item.trackId, tags: item.tags, phases: item.phases, row: item.row, tall: item.tall, parentId: item.id, order: item.order },
      },
      { kind: 'update', entity: 'item', id: item.id, patch: { phases: {} } },
    ],
    `Split “${item.title}” into parts`,
    { undoToast: true },
  );
}

/** Umbrellas to choose from: initiatives that aren't parts themselves, the item's own team first. */
function umbrellaChoices(state: RoadmapState, item: Item): Item[] {
  return Object.values(state.items)
    .filter((i) => i.id !== item.id && !i.parentId && !state.teams[i.teamId]?.archived)
    .sort((a, b) => Number(b.teamId === item.teamId) - Number(a.teamId === item.teamId) || a.title.localeCompare(b.title));
}

/** Which initiative this is a part of: an existing one, or a new umbrella named after it (its outcomes move up). */
/** The initiative's colour on the team board. A part wears its umbrella's, so picking one there recolours them all. */
function ColorField({ item, state, readOnly }: { item: Item; state: RoadmapState; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const umbrella = umbrellaOf(state, item);
  const target = umbrella ?? item;
  const family = !!umbrella || hasParts(state, item.id);
  const current = boardColorOf(state, item);
  const pick = (id: string) => {
    setOpen(false);
    // On its own, the default is no colour at all (so it follows the default if that ever changes).
    const color = !family && id === DEFAULT_BOARD_COLOR ? null : id;
    if (color === target.color) return;
    const name = boardColor(id).name.toLowerCase();
    updateItem(target.id, { color }, umbrella ? `Coloured “${umbrella.title}” and its parts ${name}` : `Coloured “${item.title}” ${name}`);
  };
  const note = umbrella ? `shared by ${umbrella.title}` : family ? 'worn by its parts' : current.id === DEFAULT_BOARD_COLOR ? 'default' : null;
  return (
    <>
      <button
        ref={anchor}
        id="dr-color"
        type="button"
        className="color-field"
        disabled={readOnly}
        aria-haspopup="true"
        aria-expanded={open}
        title="Its colour on the team board"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="color-swatch" style={{ background: current.hex }} />
        <span>{current.name}</span>
        {note && <span className="muted">· {note}</span>}
      </button>
      <Popover anchor={anchor.current} open={open} onClose={() => setOpen(false)} width={236}>
        <div className="color-grid" role="listbox" aria-label="Colour on the team board">
          {BOARD_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === current.id}
              className={`color-option${c.id === current.id ? ' is-on' : ''}`}
              style={{ background: c.hex }}
              title={c.id === DEFAULT_BOARD_COLOR ? `${c.name} (default)` : c.name}
              aria-label={c.name}
              onClick={() => pick(c.id)}
            >
              {c.id === current.id && <Check size={14} />}
            </button>
          ))}
        </div>
        <p className="color-note">{family ? 'All parts of an umbrella share its colour.' : 'Initiatives on their own share the default; umbrellas get a colour each.'}</p>
      </Popover>
    </>
  );
}

function PartOfField({ item, state, readOnly }: { item: Item; state: RoadmapState; readOnly: boolean }) {
  const [naming, setNaming] = useState<string | null>(null);
  const umbrella = umbrellaOf(state, item);
  const choices = umbrellaChoices(state, item);
  const link = (parentId: ID | null) => {
    const target = parentId ? state.items[parentId] : null;
    if (target) dispatch(linkOps(item, target), `Made “${item.title}” part of “${target.title}”`);
    else updateItem(item.id, { parentId: null }, `“${item.title}” is its own initiative again`);
  };
  const create = (name: string) => {
    const title = name.trim();
    setNaming(null);
    if (!title) return;
    const id = uid();
    const ops: Op[] = [
      {
        kind: 'create',
        entity: 'item',
        id,
        data: { title, teamId: item.teamId, trackId: item.trackId, tags: item.tags, outcomes: item.outcomes, onePagerUrl: item.onePagerUrl, phases: {}, order: item.order - 0.5 },
      },
      // The shared things move up to the umbrella: its expected outcomes and its one-pager.
      { kind: 'update', entity: 'item', id: item.id, patch: { parentId: id, ...(item.outcomes.length ? { outcomes: [] } : {}), ...(item.onePagerUrl ? { onePagerUrl: '' } : {}) } },
    ];
    dispatch(ops, `Made “${item.title}” part of the new initiative “${title}”`, { undoToast: true });
  };
  if (naming !== null) {
    return (
      <div className="partof-new">
        <input
          id="dr-parent"
          className="input"
          autoFocus
          value={naming}
          aria-label="Name of the new umbrella initiative"
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create(naming);
            else if (e.key === 'Escape') {
              e.stopPropagation();
              setNaming(null);
            }
          }}
        />
        <button type="button" className="btn sm primary" onClick={() => create(naming)}>
          Create
        </button>
        <button type="button" className="btn sm ghost" onClick={() => setNaming(null)}>
          Cancel
        </button>
      </div>
    );
  }
  const team = (i: Item) => (i.teamId === item.teamId ? '' : ` (${state.teams[i.teamId]?.name ?? 'other team'})`);
  return (
    <select
      id="dr-parent"
      className="select"
      value={umbrella?.id ?? ''}
      disabled={readOnly}
      onChange={(e) => {
        const v = e.target.value;
        // Suggest the name before a colon: "One-click checkout: Core flow" → "One-click checkout".
        if (v === '__new') setNaming(item.title.includes(':') ? item.title.split(':')[0].trim() : item.title);
        else link(v || null);
      }}
    >
      <option value="">Its own initiative</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
          {team(c)}
        </option>
      ))}
      <option value="__new">＋ New umbrella initiative…</option>
    </select>
  );
}

/** An umbrella's parts in date order, with a quick add (new parts wait in the team's backlog) and existing ones to link. */
function PartsEditor({ item, state, cal, readOnly }: { item: Item; state: RoadmapState; cal: SprintCalendar; readOnly: boolean }) {
  const [title, setTitle] = useState('');
  const parts = partsOf(state, item.id);
  const choices = umbrellaChoices(state, item).filter((c) => !hasParts(state, c.id));
  const add = () => {
    const t = title.trim();
    if (!t) return;
    createItem({ teamId: item.teamId, trackId: item.trackId, parentId: item.id, title: t, phases: {} }, { open: false });
    setTitle('');
  };
  return (
    <div className="parts">
      {parts.map((part) => {
        const span = overallSpan(part);
        const other = part.teamId !== item.teamId ? state.teams[part.teamId] : null;
        return (
          <div key={part.id} className="part-row">
            <span className="part-dot" style={{ background: state.teams[part.teamId]?.color }} />
            <button type="button" className="part-name" onClick={() => openItem(part.id)}>
              {part.title}
              {other && <span className="muted"> · {other.name}</span>}
            </button>
            {part.status !== 'planned' && <StatusPill status={part.status} />}
            <span className="part-when mono" title={span ? cal.describeSpan(span) : 'No dates yet: in the team’s backlog'}>
              {span ? cal.spanCode(span) : 'backlog'}
            </span>
            {!readOnly && (
              <button
                type="button"
                className="icon-btn xs"
                onClick={() => updateItem(part.id, { parentId: null }, `“${part.title}” is its own initiative again`)}
                aria-label={`Take ${part.title} out of ${item.title}`}
                title="Make it its own initiative"
              >
                <X size={13} />
              </button>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <>
          <div className="part-add">
            <Plus size={14} />
            <input
              value={title}
              placeholder="Add a part, then Enter (it waits in the backlog)"
              aria-label="New part"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </div>
          {choices.length > 0 && (
            <select
              className="select sm"
              value=""
              aria-label="Add an existing initiative as a part"
              onChange={(e) => {
                const part = state.items[e.target.value];
                if (part) dispatch(linkOps(part, item), `Made “${part.title}” part of “${item.title}”`);
              }}
            >
              <option value="">Add an existing initiative as a part…</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.teamId !== item.teamId ? ` (${state.teams[c.teamId]?.name ?? 'other team'})` : ''}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}

/** The one-pager link of `target` (the item itself, or the umbrella whose one-pager it shares). */
function OnePagerRow({ target, readOnly, note }: { target: Item; readOnly: boolean; note: React.ReactNode }) {
  return (
    <div className="onepager">
      <div className="link-row">
        <FileText size={15} className="muted" />
        <CommitText
          id={`dr-onepager-${target.id}`}
          className="input"
          type="url"
          value={target.onePagerUrl}
          placeholder="Link to the one-pager"
          disabled={readOnly}
          onCommit={(onePagerUrl) => updateItem(target.id, { onePagerUrl }, `Updated the one-pager of “${target.title}”`)}
        />
        {target.onePagerUrl && (
          <a className="icon-btn" href={target.onePagerUrl} target="_blank" rel="noreferrer noopener" title="Open the one-pager" aria-label="Open the one-pager">
            <ArrowUpRight size={16} />
          </a>
        )}
      </div>
      {note && <div className="muted sm onepager-note">{note}</div>}
    </div>
  );
}

function TagInput({ item, state, readOnly }: { item: Item; state: RoadmapState; readOnly: boolean }) {
  const [v, setV] = useState('');
  const all = allTags(state);
  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
    if (!tag || item.tags.includes(tag)) return;
    updateItem(item.id, { tags: [...item.tags, tag] }, `Tagged “${item.title}”`);
  };
  return (
    <div className="tag-input">
      {item.tags.map((t) => (
        <span key={t} className="tag">
          #{t}
          {!readOnly && (
            <button type="button" onClick={() => updateItem(item.id, { tags: item.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <>
          <input
            id="dr-tags"
            list="dr-tag-list"
            value={v}
            placeholder={item.tags.length ? 'Add…' : 'Add a tag'}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add(v);
                setV('');
              } else if (e.key === 'Backspace' && !v && item.tags.length) {
                updateItem(item.id, { tags: item.tags.slice(0, -1) });
              }
            }}
            onBlur={() => {
              if (v.trim()) add(v);
              setV('');
            }}
          />
          <datalist id="dr-tag-list">
            {all.filter((t) => !item.tags.includes(t)).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}

function LinksEditor({ item, readOnly }: { item: Item; readOnly: boolean }) {
  // A new link stays a local draft until it has a label or URL, so empty rows never reach the roadmap.
  const [draft, setDraft] = useState<Link | null>(null);
  const set = (links: Item['links']) => updateItem(item.id, { links }, `Updated links of “${item.title}”`);
  const isDraft = (id: string) => draft?.id === id && !item.links.some((l) => l.id === id);
  const rows = draft && isDraft(draft.id) ? [...item.links, draft] : item.links;
  const edit = (id: string, patch: Partial<Link>) => {
    if (isDraft(id)) {
      const next = { ...draft!, ...patch };
      if (next.label.trim() || next.url.trim()) set([...item.links, next]);
      setDraft(next);
    } else set(item.links.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const remove = (id: string) => {
    if (isDraft(id)) setDraft(null);
    else set(item.links.filter((x) => x.id !== id));
  };
  return (
    <div className="links">
      {rows.map((l) => (
        <div key={l.id} className="link-row">
          <Link2 size={15} className="muted" />
          <CommitText
            id={`dr-link-label-${l.id}`}
            className="input link-label"
            value={l.label}
            placeholder="Label"
            disabled={readOnly}
            autoFocus={isDraft(l.id) && !l.label && !l.url}
            onCommit={(label) => edit(l.id, { label })}
          />
          <CommitText
            id={`dr-link-url-${l.id}`}
            className="input"
            value={l.url}
            placeholder="https://"
            disabled={readOnly}
            onCommit={(url) => edit(l.id, { url })}
          />
          {l.url && (
            <a className="icon-btn" href={l.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${l.label || 'link'}`}>
              <ArrowUpRight size={15} />
            </a>
          )}
          {!readOnly && (
            <button type="button" className="icon-btn xs" onClick={() => remove(l.id)} aria-label="Remove link">
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      {!readOnly && !(draft && isDraft(draft.id)) && (
        <button type="button" className="btn ghost sm add-row" onClick={() => setDraft({ id: uid(), label: '', url: '' })}>
          <Plus size={13} /> Add a link (Jira epic, Figma, research…)
        </button>
      )}
    </div>
  );
}

/** Expected outcomes: the funnel stage (the metric), the change, the month it lands, and an optional ramp-up. */
function OutcomesEditor({ item, state, readOnly }: { item: Item; state: RoadmapState; readOnly: boolean }) {
  const stages = state.settings.funnelStages;
  const umbrella = umbrellaOf(state, item);
  const linked = linkedOutcomes(state, item);
  const fromParts = linked.filter((l) => l.owner.id !== item.id && !umbrella);
  // An umbrella's outcomes land when its parts' implementation ends: work with the dates it takes from them.
  const dated = rollUp(state).items[item.id] ?? item;
  const set = (outcomes: Outcome[]) => updateItem(item.id, { outcomes }, `Updated outcomes of “${item.title}”`);
  const edit = (i: number, p: Partial<Outcome>) => set(item.outcomes.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const now = monthNo(todayDay());
  const months = useMemo(() => {
    const out = new Set<number>();
    for (let k = -6; k <= 24; k++) out.add(now + k);
    // Always offer the months already chosen, even far in the past or future.
    for (const o of item.outcomes) if (o.landsBy) out.add(monthNo(toDay(o.landsBy)));
    return [...out].sort((a, b) => a - b);
  }, [now, item.outcomes]);
  return (
    <div className="outcomes">
      {umbrella && umbrella.outcomes.length > 0 && (
        <LinkedOutcomes
          title={
            <>
              Shared by{' '}
              <button type="button" className="link-btn sm" onClick={() => openItem(umbrella.id)}>
                {umbrella.title}
              </button>
            </>
          }
          links={linked.filter((l) => l.owner.id === umbrella.id)}
          state={state}
          showOwner={false}
        />
      )}
      {item.outcomes.length === 0 && !(umbrella && umbrella.outcomes.length > 0) && (
        <p className="muted sm">Which part of the funnel will this move, by how much, and from when? Outcomes roll up in the Impact view.</p>
      )}
      {item.outcomes.map((o, i) => {
        const stage = stages.find((s) => s.id === o.stageId);
        const built = landingMonth(dated, { ...o, landsBy: null });
        const landing = landingMonth(dated, o);
        return (
          <div key={o.id} className="outcome-card" style={{ '--c': stage?.color ?? '#888' } as React.CSSProperties}>
            <div className="outcome-row">
              <select id={`dr-oc-stage-${o.id}`} className="select sm oc-stage" value={o.stageId} disabled={readOnly} onChange={(e) => edit(i, { stageId: e.target.value })} aria-label="Funnel stage">
                {!stage && <option value={o.stageId}>Choose a stage</option>}
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <CommitText
                id={`dr-oc-impact-${o.id}`}
                className="input sm num"
                type="number"
                value={o.impact === null ? '' : String(o.impact)}
                placeholder="+2"
                disabled={readOnly}
                ariaLabel="Expected change"
                onCommit={(v) => edit(i, { impact: v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v) })}
              />
              <select id={`dr-oc-unit-${o.id}`} className="select sm" value={o.unit} disabled={readOnly} onChange={(e) => edit(i, { unit: e.target.value as Outcome['unit'] })} aria-label="Unit">
                {IMPACT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u === 'abs' ? 'absolute' : u === '%' ? '% relative' : 'pp'}
                  </option>
                ))}
              </select>
              {!readOnly && (
                <button type="button" className="icon-btn xs" onClick={() => set(item.outcomes.filter((_, j) => j !== i))} aria-label="Remove outcome">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="outcome-row">
              <select
                id={`dr-oc-lands-${o.id}`}
                className="select sm"
                value={o.landsBy ? String(monthNo(toDay(o.landsBy))) : ''}
                disabled={readOnly}
                aria-label="Lands in"
                onChange={(e) => edit(i, { landsBy: e.target.value ? fromDay(monthStart(Number(e.target.value))) : null })}
              >
                <option value="">Lands {built ? `${monthLabel(built.month)} (end of implementation)` : 'when built'}</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    Lands {monthLabel(m, true)}
                  </option>
                ))}
              </select>
              {o.ramp.length === 0 && !readOnly && (
                <button type="button" className="link-btn sm" onClick={() => edit(i, { ramp: [50] })} title="Impact that builds up over a few months">
                  <TrendingUp size={13} /> Ramp up
                </button>
              )}
            </div>
            {o.ramp.length > 0 && <RampEditor outcome={o} landing={landing?.month ?? null} readOnly={readOnly} onChange={(ramp) => edit(i, { ramp })} />}
            {o.impact !== null && (
              <div className="outcome-summary">
                <strong>{formatImpact(o.impact, o.unit)}</strong> {stage?.name ?? 'funnel'} · {landingText(dated, o)}
              </div>
            )}
          </div>
        );
      })}
      {fromParts.length > 0 && <LinkedOutcomes title="From its parts" links={fromParts} state={state} showOwner />}
      {!readOnly && (
        <button
          type="button"
          className="btn ghost sm add-row"
          onClick={() =>
            set([
              ...item.outcomes,
              { id: uid(), stageId: stages[stages.length > 2 ? 2 : 0]?.id ?? '', metric: '', impact: null, unit: '%', confidence: 'medium', landsBy: null, ramp: [], note: '' },
            ])
          }
        >
          <Plus size={13} /> {umbrella ? 'Add an outcome for this part only' : 'Add an expected outcome'}
        </button>
      )}
    </div>
  );
}

/** Outcomes held by a linked initiative (the umbrella, or its parts): shown here, edited there. */
function LinkedOutcomes({
  title,
  links,
  state,
  showOwner,
}: {
  title: React.ReactNode;
  links: { owner: Item; outcome: Outcome }[];
  state: RoadmapState;
  showOwner: boolean;
}) {
  const stages = new Map(state.settings.funnelStages.map((s) => [s.id, s]));
  const rolled = rollUp(state);
  return (
    <div className="linked-outcomes">
      <div className="linked-head">{title}</div>
      {links.map(({ owner, outcome }) => {
        const stage = stages.get(outcome.stageId);
        return (
          <div key={`${owner.id}-${outcome.id}`} className="linked-outcome" style={{ '--c': stage?.color ?? '#888' } as React.CSSProperties}>
            <strong>{formatImpact(outcome.impact, outcome.unit)}</strong> {stage?.name ?? 'Funnel'}
            <span className="muted"> · {landingText(rolled.items[owner.id] ?? owner, outcome)}</span>
            {showOwner && (
              <button type="button" className="link-btn sm linked-owner" onClick={() => openItem(owner.id)}>
                {owner.title}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Share of the full impact in the landing month and the months after it; full impact after the last one. */
function RampEditor({ outcome, landing, readOnly, onChange }: { outcome: Outcome; landing: number | null; readOnly: boolean; onChange: (ramp: number[]) => void }) {
  const ramp = outcome.ramp;
  const label = (k: number) => (landing === null ? `Month ${k + 1}` : monthLabel(landing + k));
  const last = ramp[ramp.length - 1] ?? 0;
  return (
    <div className="ramp">
      <span className="ramp-label">Ramp-up</span>
      {ramp.map((pct, k) => (
        <label key={k} className="ramp-step">
          <span>{label(k)}</span>
          <CommitText
            id={`dr-ramp-${outcome.id}-${k}`}
            className="input sm num ramp-input"
            type="number"
            value={String(pct)}
            disabled={readOnly}
            ariaLabel={`Share of the impact in ${label(k)}`}
            onCommit={(v) => {
              const n = Number(v);
              if (v.trim() === '' || Number.isNaN(n)) return;
              onChange(ramp.map((x, j) => (j === k ? Math.min(100, Math.max(0, Math.round(n))) : x)));
            }}
          />
          <span className="muted">%</span>
        </label>
      ))}
      <span className="ramp-step is-full">
        <span>{label(ramp.length)}</span> 100%
      </span>
      {!readOnly && (
        <span className="ramp-actions">
          {ramp.length < 12 && last < 100 && (
            <button type="button" className="icon-btn xs" onClick={() => onChange([...ramp, Math.min(95, last + 25)])} aria-label="Add a month to the ramp-up" title="Add a month">
              <Plus size={13} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn xs"
            onClick={() => onChange(ramp.slice(0, -1))}
            aria-label={ramp.length === 1 ? 'Remove the ramp-up' : 'Remove the last month'}
            title={ramp.length === 1 ? 'Full impact from the start' : 'Remove the last month'}
          >
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  );
}

function DependenciesEditor({ item, state, cal, readOnly }: { item: Item; state: RoadmapState; cal: SprintCalendar; readOnly: boolean }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const idx = (d: number) => cal.indexOf(d);
  const needs = item.dependencies.map((d) => dependencyInfo(state, item, d, idx));
  const neededBy = Object.values(state.items).flatMap((other) =>
    other.dependencies.filter((d) => d.itemId === item.id).map((d) => dependencyInfo(state, other, d, idx)),
  );
  const set = (dependencies: Dependency[], label?: string) => updateItem(item.id, { dependencies }, label ?? `Updated dependencies of “${item.title}”`);
  const edit = (depId: string, p: Partial<Dependency>) => set(item.dependencies.map((d) => (d.id === depId ? { ...d, ...p } : d)));

  return (
    <div className="deps">
      <div className="deps-sub">Needs from others</div>
      {needs.length === 0 && <p className="muted sm">Nothing yet. Add the items or teams this work can’t finish without.</p>}
      {needs.map((info) => {
        const t = info.targetTeamId ? state.teams[info.targetTeamId] : null;
        return (
          <div key={info.dep.id} className={`dep-card${info.conflict ? ' is-conflict' : ''}`}>
            <div className="dep-top">
              <span className="dep-team" style={{ '--c': t?.color ?? '#888' } as React.CSSProperties}>
                {t?.name ?? 'Unknown team'}
              </span>
              {info.target ? (
                <button type="button" className="link-btn" onClick={() => openItem(info.target!.id)}>
                  {info.target.title}
                </button>
              ) : info.dep.itemId ? (
                <span className="muted">Deleted initiative</span>
              ) : (
                <span className="muted">Not on their roadmap yet</span>
              )}
              {!readOnly && (
                <button type="button" className="icon-btn xs" onClick={() => set(item.dependencies.filter((d) => d.id !== info.dep.id))} aria-label="Remove dependency">
                  <X size={13} />
                </button>
              )}
            </div>
            {info.conflict && (
              <div className="dep-warn">
                <AlertTriangle size={13} /> Lands {info.lateBy} sprint{info.lateBy > 1 ? 's' : ''} after this needs it
              </div>
            )}
            <div className="dep-fields">
              <select id={`dr-dep-st-${info.dep.id}`} className="select sm" value={info.dep.status} disabled={readOnly} onChange={(e) => edit(info.dep.id, { status: e.target.value as Dependency['status'] })} aria-label="Agreement">
                {DEPENDENCY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DEPENDENCY_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <CommitText id={`dr-dep-note-${info.dep.id}`} className="input sm" value={info.dep.note} placeholder="What exactly is needed?" disabled={readOnly} onCommit={(note) => edit(info.dep.id, { note })} />
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <>
          <button type="button" ref={setAnchor} className="btn ghost sm add-row" onClick={() => setOpen(true)}>
            <Plus size={13} /> Add a dependency
          </button>
          <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={360}>
            <DependencyPicker
              item={item}
              state={state}
              onPick={(target) => {
                setOpen(false);
                const dep: Dependency = { id: uid(), itemId: target.itemId, teamId: target.teamId, note: '', status: 'open' };
                set([...item.dependencies, dep], `“${item.title}” now depends on ${target.label}`);
              }}
            />
          </Popover>
        </>
      )}

      <div className="deps-sub">Needed by</div>
      {neededBy.length === 0 && <p className="muted sm">No other initiative depends on this yet.</p>}
      {neededBy.map((info) => {
        const t = state.teams[info.from.teamId];
        return (
          <button key={`${info.from.id}-${info.dep.id}`} type="button" className={`dep-card as-link${info.conflict ? ' is-conflict' : ''}`} onClick={() => openItem(info.from.id)}>
            <div className="dep-top">
              <span className="dep-team" style={{ '--c': t?.color ?? '#888' } as React.CSSProperties}>
                {t?.name}
              </span>
              <span>{info.from.title}</span>
            </div>
            {info.conflict && (
              <div className="dep-warn">
                <AlertTriangle size={13} /> They need it {info.lateBy} sprint{info.lateBy > 1 ? 's' : ''} earlier
              </div>
            )}
            {info.dep.note && <div className="muted sm">{info.dep.note}</div>}
          </button>
        );
      })}
    </div>
  );
}

function DependencyPicker({ item, state, onPick }: { item: Item; state: RoadmapState; onPick: (t: { itemId: string | null; teamId: string | null; label: string }) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const taken = new Set(item.dependencies.map((d) => d.itemId ?? `team:${d.teamId}`));
  const items = Object.values(state.items)
    .filter((i) => i.id !== item.id && !taken.has(i.id) && (!needle || i.title.toLowerCase().includes(needle) || state.teams[i.teamId]?.name.toLowerCase().includes(needle)))
    .sort((a, b) => Number(a.teamId === item.teamId) - Number(b.teamId === item.teamId) || a.title.localeCompare(b.title))
    .slice(0, 30);
  const teams = sortedTeams(state).filter((t) => t.id !== item.teamId && !taken.has(`team:${t.id}`) && (!needle || t.name.toLowerCase().includes(needle)));
  return (
    <div className="picker">
      <input id="dep-picker" className="input" autoFocus placeholder="Search initiatives or teams" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-list">
        {items.length > 0 && <div className="picker-group">Initiatives</div>}
        {items.map((i) => (
          <button key={i.id} type="button" className="picker-item" onClick={() => onPick({ itemId: i.id, teamId: null, label: `“${i.title}”` })}>
            <span className="palette-dot" style={{ background: state.teams[i.teamId]?.color }} />
            <span className="picker-label">{i.title}</span>
            <span className="muted sm">{state.teams[i.teamId]?.name}</span>
          </button>
        ))}
        {teams.length > 0 && <div className="picker-group">A team (work not on their roadmap yet)</div>}
        {teams.map((t) => (
          <button key={t.id} type="button" className="picker-item" onClick={() => onPick({ itemId: null, teamId: t.id, label: t.name })}>
            <span className="palette-dot" style={{ background: t.color }} />
            <span className="picker-label">{t.name}</span>
          </button>
        ))}
        {items.length === 0 && teams.length === 0 && <div className="muted sm picker-empty">Nothing matches.</div>}
      </div>
    </div>
  );
}

function ItemActivity({ item, state, cal, readOnly }: { item: Item; state: RoadmapState; cal: SprintCalendar; readOnly: boolean }) {
  // Its newest 50 changes, then kept current as changes come in. Rendered with a key per initiative.
  const { rows: changes, loading } = useHistoryRows({ entityId: item.id, limit: 50, keep: (c) => c.entity === 'item' && c.entityId === item.id });
  if (loading) return <p className="muted sm">Loading…</p>;
  if (changes.length === 0) return <p className="muted sm">No history yet.</p>;
  return (
    <ol className="activity">
      {changes.map((c, i) => {
        const d = describeChange(c, state, cal);
        const isCurrent = i === 0;
        return (
          <li key={c.seq} className="activity-row">
            <Avatar name={c.actor} size={22} />
            <div className="activity-text">
              <div>
                <strong>{displayName(c.actor)}</strong> {d.verb} <span className="muted">· {relativeTime(c.ts)}</span>
              </div>
              {d.details.length > 0 && (
                <ul className="activity-details">
                  {d.details.map((t, j) => (
                    <li key={j}>{t}</li>
                  ))}
                </ul>
              )}
              {!readOnly && !isCurrent && c.after && (
                <button
                  type="button"
                  className="link-btn sm"
                  onClick={() => {
                    const after = c.after as Item;
                    const restore: Record<string, unknown> = { ...after };
                    delete restore.id;
                    dispatch([{ kind: 'update', entity: 'item', id: item.id, patch: restore }], `Restored “${item.title}” to ${relativeTime(c.ts)}`, { undoToast: true });
                  }}
                >
                  <Copy size={11} /> Restore this version
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
