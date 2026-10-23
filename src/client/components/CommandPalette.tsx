import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Camera, Flag, Moon, Plus, Search, Sun, Umbrella, Users } from 'lucide-react';
import { boardColorOf } from '../../shared/colors.ts';
import { partsOf, umbrellaOf } from '../../shared/parts.ts';
import { STATUS_LABELS, type Item, type RoadmapState } from '../../shared/types.ts';
import { matchesQuery, sortedTeams } from '../lib/model.ts';
import { createScheduledItem, navigate, openItem, setOverlay, setTheme, useApp, type ViewId } from '../store.ts';

interface Entry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  /** Shown before the hint: an initiative's umbrella. */
  meta?: React.ReactNode;
  color?: string;
  icon?: React.ReactNode;
  run: () => void;
}

const VIEW_ENTRIES: { id: ViewId; label: string }[] = [
  { id: 'leadership', label: 'Leadership overview' },
  { id: 'alignment', label: 'Cross-team alignment' },
  { id: 'team', label: 'Team roadmap' },
  { id: 'impact', label: 'Expected impact' },
  { id: 'history', label: 'History & snapshots' },
  { id: 'admin', label: 'Settings' },
];

export function CommandPalette() {
  const state = useApp((s) => s.travel?.state ?? s.live);
  const travel = useApp((s) => s.travel);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setOverlay(null);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    const needle = q.trim().toLowerCase();
    const items = Object.values(state.items)
      .filter((i) => matchesQuery(i, state, q))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(needle)) - Number(a.title.toLowerCase().startsWith(needle)) || a.title.localeCompare(b.title))
      .slice(0, needle ? 12 : 6);
    for (const i of items) {
      const team = state.teams[i.teamId];
      out.push({
        id: `i-${i.id}`,
        group: 'Initiatives',
        label: i.title,
        meta: <ItemMeta item={i} state={state} />,
        // The roadmap shows where work stands; only the two flags are worth repeating here.
        hint: [team?.name, i.status !== 'planned' ? STATUS_LABELS[i.status] : null].filter(Boolean).join(' · '),
        color: team?.color,
        run: () => openItem(i.id),
      });
    }
    for (const t of sortedTeams(state).filter((t) => !needle || t.name.toLowerCase().includes(needle))) {
      out.push({ id: `t-${t.id}`, group: 'Teams', label: `${t.name} roadmap`, color: t.color, icon: <Users size={14} />, run: () => navigate({ view: 'team', teamId: t.id, itemId: null }) });
    }
    const actions: Entry[] = [
      ...(travel ? [] : [{ id: 'a-new', group: 'Actions', label: 'New initiative', hint: 'N', icon: <Plus size={14} />, run: () => createScheduledItem() }]),
      { id: 'a-snap', group: 'Actions', label: 'Save a snapshot of the roadmap', icon: <Camera size={14} />, run: () => navigate({ view: 'history', itemId: null }) },
      { id: 'a-light', group: 'Actions', label: 'Light theme', icon: <Sun size={14} />, run: () => setTheme('light') },
      { id: 'a-dark', group: 'Actions', label: 'Dark theme', icon: <Moon size={14} />, run: () => setTheme('dark') },
      ...VIEW_ENTRIES.map((v) => ({ id: `v-${v.id}`, group: 'Go to', label: v.label, icon: <ArrowRight size={14} />, run: () => navigate({ view: v.id }) })),
      // Strategic bets with a view of their own.
      ...Object.values(state.tracks)
        .filter((t) => t.ownView)
        .map((t) => ({ id: `b-${t.id}`, group: 'Go to', label: `${t.name} (strategic bet)`, icon: <Flag size={14} />, run: () => navigate({ view: 'bet', betId: t.id, itemId: null }) })),
    ];
    out.push(...actions.filter((a) => !needle || a.label.toLowerCase().includes(needle)));
    return out;
  }, [q, state, travel]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (e: Entry | undefined) => {
    if (!e) return;
    close();
    e.run();
  };

  let lastGroup = '';
  return createPortal(
    <div className="modal-backdrop palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Search size={16} />
          <input
            id="palette-input"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search initiatives, teams, actions…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(entries.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(entries[index]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {entries.length === 0 && <div className="palette-empty">No matches for “{q}”.</div>}
          {entries.map((e, i) => {
            const header = e.group !== lastGroup ? e.group : null;
            lastGroup = e.group;
            return (
              <div key={e.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  data-index={i}
                  className={`palette-item${i === index ? ' is-active' : ''}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(e)}
                >
                  {e.color ? <span className="palette-dot" style={{ background: e.color }} /> : <span className="palette-icon">{e.icon}</span>}
                  <span className="palette-label">{e.label}</span>
                  {e.meta}
                  {e.hint && <span className="palette-hint">{e.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The umbrella an initiative is part of (or, for an umbrella, how many parts it has). */
function ItemMeta({ item, state }: { item: Item; state: RoadmapState }) {
  const umbrella = umbrellaOf(state, item);
  const parts = umbrella ? 0 : partsOf(state, item.id).length;
  if (!umbrella && !parts) return null;
  return (
    <span className="palette-meta">
      {umbrella && (
        <span className="palette-umbrella" style={{ '--u': boardColorOf(state, umbrella).ink } as CSSProperties} title={`Part of ${umbrella.title}`}>
          <Umbrella size={11} />
          {umbrella.title}
        </span>
      )}
      {parts > 0 && (
        <span className="palette-umbrella" style={{ '--u': boardColorOf(state, item).ink } as CSSProperties} title="An umbrella: its dates come from its parts">
          <Umbrella size={11} />
          {parts} part{parts === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}
