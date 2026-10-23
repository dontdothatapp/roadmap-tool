import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Command,
  GitCompareArrows,
  History as HistoryIcon,
  LayoutDashboard,
  Moon,
  Network,
  Pin,
  PinOff,
  Redo2,
  Search,
  Settings as SettingsIcon,
  Sun,
  Target,
  Flag,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { fmtTimestamp } from '../shared/dates.ts';
import { diffStates } from '../shared/diff.ts';
import { calendarFor } from '../shared/sprints.ts';
import { displayName } from '../shared/util.ts';
import { CommandPalette } from './components/CommandPalette.tsx';
import { ItemDrawer } from './components/ItemDrawer.tsx';
import { Avatar, Kbd, Modal, Popover } from './components/ui.tsx';
import { CompareSummary } from './components/CompareSummary.tsx';
import { uiBus } from './lib/bus.ts';
import { useMediaQuery } from './lib/media.ts';
import { usePersistentState } from './lib/persist.ts';
import {
  api,
  boot,
  createScheduledItem,
  dismissToast,
  exitTravel,
  navigate,
  nudgeItem,
  redo,
  setName,
  setOverlay,
  setTheme,
  startCompare,
  stopCompare,
  undo,
  useApp,
  type ViewId,
} from './store.ts';
import { AdminView } from './views/AdminView.tsx';
import { AlignmentView } from './views/AlignmentView.tsx';
import { HistoryView } from './views/HistoryView.tsx';
import { ImpactView } from './views/ImpactView.tsx';
import { LeadershipView } from './views/LeadershipView.tsx';
import { BetView } from './views/BetView.tsx';
import { TeamView } from './views/TeamView.tsx';

const NAV: { id: ViewId; label: string; icon: typeof Users; hint: string }[] = [
  { id: 'leadership', label: 'Leadership', icon: LayoutDashboard, hint: 'The big picture by strategic bet' },
  { id: 'alignment', label: 'Alignment', icon: Network, hint: 'All teams side by side, with dependencies' },
  { id: 'team', label: 'Team', icon: Users, hint: 'One team’s plan, sprint by sprint' },
  { id: 'impact', label: 'Impact', icon: Target, hint: 'Expected outcomes by quarter and funnel stage' },
  { id: 'history', label: 'History', icon: HistoryIcon, hint: 'Every change, snapshots and time travel' },
];

export function App() {
  const phase = useApp((s) => s.phase);
  const loadError = useApp((s) => s.loadError);
  const view = useApp((s) => s.route.view);
  const itemId = useApp((s) => s.route.itemId);
  const overlay = useApp((s) => s.overlay);
  const needsName = useApp((s) => s.needsName);
  const theme = useApp((s) => s.theme);
  const [sidebarPinned, setSidebarPinned] = usePersistentState('sidebar-pinned', false);
  // On small screens the sidebar always floats, so the roadmap keeps the full width.
  const narrow = useMediaQuery('(max-width: 760px)');
  const docked = sidebarPinned && !narrow;

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  useGlobalShortcuts();

  if (phase === 'loading') {
    return (
      <div className="splash">
        <div className="brand-mark lg" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p>Loading the roadmap…</p>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="splash">
        <h1>Couldn’t load the roadmap</h1>
        <p>{loadError}</p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={`app${docked ? ' sb-docked' : ''}`}>
      <Sidebar docked={docked} canPin={!narrow} onTogglePin={() => setSidebarPinned((p) => !p)} />
      <div className="workspace">
        <Banners />
        <main className="main">
          {view === 'leadership' && <LeadershipView />}
          {view === 'alignment' && <AlignmentView />}
          {view === 'team' && <TeamView />}
          {view === 'bet' && <BetView />}
          {view === 'impact' && <ImpactView />}
          {view === 'history' && <HistoryView />}
          {view === 'admin' && <AdminView />}
        </main>
      </div>
      {itemId && <ItemDrawer key={itemId} id={itemId} />}
      {overlay === 'palette' && <CommandPalette />}
      {overlay === 'shortcuts' && <ShortcutsModal />}
      {(needsName || overlay === 'name') && <NamePrompt />}
      <Toasts />
    </div>
  );
}

/**
 * An icon rail that opens on hover (or keyboard focus) and floats over the roadmap.
 * Pinned, it stays open and takes its own column instead.
 */
function Sidebar({ docked, canPin, onTogglePin }: { docked: boolean; canPin: boolean; onTogglePin: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLElement>(null);
  const expanded = docked || hovered || menuOpen;
  const floating = expanded && !docked;

  const later = (open: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    // A short delay to open avoids flicker when the pointer just passes by; a longer one to close
    // forgives a pointer that slips off the edge.
    timer.current = setTimeout(() => setHovered(open), open ? 120 : 250);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The profile menu renders outside the sidebar, and React treats it as inside, so leaving via the
  // menu sends no leave event. When the menu closes, close the sidebar too unless the pointer is on it.
  useEffect(() => {
    if (!menuOpen && ref.current && !ref.current.matches(':hover')) later(false);
  }, [menuOpen]);

  // Touch: the first tap opens the floating sidebar; a tap outside closes it.
  useEffect(() => {
    if (!floating || menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setHovered(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [floating, menuOpen]);

  /** Navigating from the floating sidebar tucks it away again. */
  const go = (patch: Parameters<typeof navigate>[0]) => {
    navigate(patch);
    if (!docked) {
      if (timer.current) clearTimeout(timer.current);
      setHovered(false);
    }
  };

  const view = useApp((s) => s.route.view);
  const teamId = useApp((s) => s.route.teamId);
  const betId = useApp((s) => s.route.betId);
  const name = useApp((s) => s.live.settings.name);
  const { teams, tracks } = useApp((s) => s.travel?.state ?? s.live);
  const canUndo = useApp((s) => s.undoStack.length > 0 && !s.travel);
  const canRedo = useApp((s) => s.redoStack.length > 0 && !s.travel);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';
  const teamList = Object.values(teams)
    .filter((t) => !t.archived)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  // Strategic bets given a view of their own (in Settings) sit with the views, after Team.
  const betViews = Object.values(tracks)
    .filter((t) => t.ownView)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  return (
    <div className="sb-slot">
      <aside
        ref={ref}
        className={`sidebar${expanded ? '' : ' is-rail'}${floating ? ' is-floating' : ''}`}
        aria-label="Navigation"
        onPointerEnter={(e) => e.pointerType === 'mouse' && later(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && later(false)}
        onFocus={() => setHovered(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !e.currentTarget.matches(':hover')) setHovered(false);
        }}
      >
        <div className="sb-head">
          <button
            type="button"
            className="brand"
            onClick={() => (expanded ? go({ view: 'alignment', itemId: null }) : setHovered(true))}
            title={name}
          >
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="brand-name sb-label">{name}</span>
          </button>
          {canPin && (
            <button
              type="button"
              className={`icon-btn sb-pin${docked ? ' is-on' : ''}`}
              onClick={onTogglePin}
              title={docked ? 'Unpin: open the sidebar on hover instead' : 'Pin the sidebar open'}
              aria-label={docked ? 'Unpin sidebar' : 'Pin sidebar open'}
              aria-pressed={docked}
            >
              {docked ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          )}
        </div>

        <button type="button" className="sb-item sb-search" onClick={() => setOverlay('palette')} title={`Search (${mod} K)`}>
          <Search size={16} />
          <span className="sb-label">Search</span>
          <Kbd>{mod} K</Kbd>
        </button>

        <nav className="sb-nav" aria-label="Views">
          {NAV.map((n) => (
            <div key={n.id}>
              <button
                type="button"
                className={`sb-item${view === n.id ? ' is-active' : ''}`}
                onClick={() => go({ view: n.id })}
                title={expanded ? n.hint : `${n.label}: ${n.hint}`}
                aria-current={view === n.id ? 'page' : undefined}
              >
                <n.icon size={16} strokeWidth={2} />
                <span className="sb-label">{n.label}</span>
              </button>
              {n.id === 'team' && teamList.length > 0 && (
                <div className="sb-teams">
                  {teamList.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`sb-team${view === 'team' && teamId === t.id ? ' is-active' : ''}`}
                      style={{ '--c': t.color } as React.CSSProperties}
                      onClick={() => go({ view: 'team', teamId: t.id, itemId: null })}
                    >
                      <span className="sb-team-dot" />
                      <span className="sb-label">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {n.id === 'team' &&
                betViews.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`sb-item sb-bet${view === 'bet' && betId === t.id ? ' is-active' : ''}`}
                    style={{ '--c': t.color } as React.CSSProperties}
                    onClick={() => go({ view: 'bet', betId: t.id, itemId: null })}
                    title={expanded ? `Strategic bet: ${t.name}` : t.name}
                    aria-current={view === 'bet' && betId === t.id ? 'page' : undefined}
                  >
                    <Flag size={16} strokeWidth={2} />
                    <span className="sb-label">{t.name}</span>
                  </button>
                ))}
            </div>
          ))}
        </nav>

        {/* Below the views, so the rail and the open sidebar keep everything above in the same place. */}
        <div className="sb-actions">
          <button type="button" className="icon-btn sb-undo" onClick={undo} disabled={!canUndo} title={`Undo (${mod} Z)`} aria-label="Undo">
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-btn sb-undo" onClick={redo} disabled={!canRedo} title={`Redo (${mod} ⇧ Z)`} aria-label="Redo">
            <Redo2 size={16} />
          </button>
        </div>

        <div className="sb-foot">
          <button
            type="button"
            className={`sb-item${view === 'admin' ? ' is-active' : ''}`}
            onClick={() => go({ view: 'admin' })}
            title="Settings: teams, strategic bets, sprints, funnel"
          >
            <SettingsIcon size={16} />
            <span className="sb-label">Settings</span>
          </button>
          <Presence onMenuChange={setMenuOpen} />
        </div>
      </aside>
    </div>
  );
}

function Presence({ onMenuChange }: { onMenuChange: (open: boolean) => void }) {
  const presence = useApp((s) => s.presence);
  const me = useApp((s) => s.me);
  const connected = useApp((s) => s.connected);
  const theme = useApp((s) => s.theme);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  // The sidebar stays open while this menu is, even when the pointer moves onto the menu.
  useEffect(() => onMenuChange(open), [open, onMenuChange]);
  const others = [...new Map(presence.filter((p) => p.name !== me.name).map((p) => [p.name, p])).values()];
  return (
    <div className="presence">
      {others.length > 0 && (
        <div className="presence-others" title={others.map((p) => displayName(p.name)).join(', ') + (others.length === 1 ? ' is here' : ' are here')}>
          {others.slice(0, 4).map((p) => (
            <Avatar key={p.clientId} name={p.name} size={24} title={`${displayName(p.name)} is here`} />
          ))}
          {others.length > 4 && <span className="avatar more">+{others.length - 4}</span>}
          <span className="sb-label presence-note">{others.length === 1 ? 'also here' : `${others.length} others here`}</span>
        </div>
      )}
      <button type="button" ref={setAnchor} className="me-btn" onClick={() => setOpen((o) => !o)} aria-label="Your profile and appearance">
        <span className="me-avatar">
          <Avatar name={me.name || '?'} size={28} title={displayName(me.name)} />
          <span className={`conn-dot${connected ? '' : ' is-off'}`} title={connected ? 'Live: changes appear instantly' : 'Reconnecting…'} />
        </span>
        <span className="sb-label me-name">{displayName(me.name)}</span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={240}>
        <div className="menu">
          <div className="menu-head">
            <div className="menu-title">{displayName(me.name)}</div>
            <div className="menu-sub">{me.managed ? 'Signed in through your company login' : 'Shown on your changes in History'}</div>
          </div>
          {!me.managed && !api.demo && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                setOverlay('name');
              }}
            >
              Change your name
            </button>
          )}
          <div className="menu-sep" />
          <div className="menu-label">Appearance</div>
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} type="button" className={`menu-item${theme === t ? ' is-checked' : ''}`} onClick={() => setTheme(t)}>
              {t === 'dark' ? <Moon size={14} /> : t === 'light' ? <Sun size={14} /> : <Command size={14} />}
              {t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              setOverlay('shortcuts');
            }}
          >
            Keyboard shortcuts <Kbd>?</Kbd>
          </button>
          {api.demo && (
            <button type="button" className="menu-item" onClick={() => api.resetDemo?.()}>
              Reset demo data
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
}

function Banners() {
  const travel = useApp((s) => s.travel);
  const compare = useApp((s) => s.compare);
  const live = useApp((s) => s.live);
  const [showChanges, setShowChanges] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  // The diff walks the whole roadmap, and the banner re-renders with the app around it: only redo it when the
  // live roadmap or the moment compared with changes. (Above the early returns: hooks can't follow them.)
  const diff = useMemo(() => (compare ? diffStates(compare.state, live, calendarFor(live.settings.sprints)) : null), [compare, live]);
  if (!travel && !compare) return null;
  if (travel) {
    return (
      <div className="banner travel" role="status">
        <div className="banner-inner">
          <HistoryIcon size={16} />
          <span>
            Viewing the roadmap as it was on <strong>{fmtTimestamp(travel.at, true)}</strong>
            {travel.label && <> · {travel.label}</>}. It’s read-only; expected impact reads then → now.
          </span>
          <span className="banner-actions">
            <button type="button" className="btn sm" onClick={() => void startCompare(travel.at, travel.label || fmtTimestamp(travel.at, true))}>
              <GitCompareArrows size={14} /> Compare with today
            </button>
            <button type="button" className="btn sm primary" onClick={exitTravel}>
              Back to live
            </button>
          </span>
        </div>
      </div>
    );
  }
  if (!diff) return null;
  const parts = [
    diff.added && `${diff.added} added`,
    diff.removed && `${diff.removed} removed`,
    diff.slipped && `${diff.slipped} slipped`,
    diff.pulledIn && `${diff.pulledIn} pulled in`,
    diff.statusChanges && `${diff.statusChanges} status changes`,
    diff.outcomeChanges && `${diff.outcomeChanges} outcome change${diff.outcomeChanges > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return (
    <div className="banner compare" role="status">
      <div className="banner-inner">
        <GitCompareArrows size={16} />
        <span>
          Comparing with <strong>{compare!.label}</strong> ({fmtTimestamp(compare!.at, true)}):{' '}
          {parts.length ? parts.join(' · ') : 'nothing changed'}. Dashed outlines show where things were; expected impact reads then → now.
        </span>
        <span className="banner-actions">
          <button type="button" ref={anchor} className="btn sm" onClick={() => setShowChanges((v) => !v)}>
            List changes
          </button>
          <button type="button" className="btn sm" onClick={stopCompare}>
            <X size={14} /> Stop comparing
          </button>
        </span>
      </div>
      <Popover anchor={anchor.current} open={showChanges} onClose={() => setShowChanges(false)} align="end" width={420}>
        <CompareSummary diff={diff} baseline={compare!.state} onPick={() => setShowChanges(false)} />
      </Popover>
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function NamePrompt() {
  const current = useApp((s) => s.me.name);
  const needsName = useApp((s) => s.needsName);
  const [value, setValue] = useState(current);
  return (
    <Modal title={needsName ? 'Welcome! What’s your name?' : 'Change your name'} onClose={() => (needsName ? undefined : setOverlay(null))} width={420}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setName(value);
        }}
      >
        <p className="muted">Your name appears next to your changes in History, so everyone knows who moved what.</p>
        <input id="name-input" className="input lg" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Anna Kowalski" maxLength={80} />
        <div className="row end">
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            Continue
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ShortcutsModal() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [
    [`${mod} K`, 'Search initiatives, teams and actions'],
    ['N', 'New initiative'],
    [`${mod} Z`, 'Undo'],
    [`${mod} ⇧ Z`, 'Redo'],
    ['1 – 5', 'Switch view'],
    ['T', 'Scroll to today'],
    ['+ / −', 'Zoom in / out'],
    [`${mod} scroll`, 'Zoom around the pointer'],
    ['← / →', 'Move the open initiative by a sprint'],
    ['⇧ ← / ⇧ →', 'Shorten / extend the open initiative'],
    ['Esc', 'Close panels'],
  ];
  const tips: [string, string][] = [
    ['Drag a bar', 'Reschedule; it snaps to sprints'],
    ['Drag a bar’s edge', 'Change start or end'],
    ['⇧ + drag a phase', 'Move every phase together'],
    ['Drag up or down', 'Move to another team or strategic bet; in the team view, to any row (between two rows adds a row)'],
    ['Drag a bar’s bottom edge', 'Two rows high, for a long name (drag up for one)'],
    ['Drag across an empty lane', 'Add an initiative: type its name, then ↵ (⇧↵ also opens it)'],
    ['Double-click a lane', 'Add an initiative in that sprint'],
    ['Click an umbrella', `Leadership and Alignment: show or hide its parts (${mod}-click opens its details)`],
    ['⌥ + drag, or drag the header', 'Scroll around'],
  ];
  return (
    <Modal title="Keyboard shortcuts & gestures" onClose={() => setOverlay(null)} width={560}>
      <div className="shortcuts">
        <div>
          {rows.map(([k, d]) => (
            <div key={k} className="shortcut-row">
              <Kbd>{k}</Kbd>
              <span>{d}</span>
            </div>
          ))}
        </div>
        <div>
          {tips.map(([k, d]) => (
            <div key={k} className="shortcut-row">
              <strong>{k}</strong>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const state = useApp.getState();
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOverlay(state.overlay === 'palette' ? null : 'palette');
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !isTyping(e)) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey || isTyping(e) || state.overlay) return;
      if (e.key === 'Escape') {
        if (state.route.itemId) navigate({ itemId: null });
        return;
      }
      if (e.key === '?') {
        setOverlay('shortcuts');
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        // In a strategic bet's view, a new initiative belongs to that bet.
        if (!state.travel) createScheduledItem(state.route.view === 'bet' && state.route.betId ? { trackId: state.route.betId } : {});
        return;
      }
      const idx = ['1', '2', '3', '4', '5'].indexOf(e.key);
      if (idx >= 0) {
        navigate({ view: NAV[idx].id });
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        uiBus.dispatchEvent(new Event('today'));
        return;
      }
      if (e.key === '+' || e.key === '=') {
        uiBus.dispatchEvent(new Event('in'));
        return;
      }
      if (e.key === '-' || e.key === '_') {
        uiBus.dispatchEvent(new Event('out'));
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.route.itemId) {
        if (!state.travel) nudgeItem(state.route.itemId, e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
