import { useMemo, useState } from 'react';
import { Camera, Clock, Eye, GitCompareArrows, Search, Trash2 } from 'lucide-react';
import { fmtDayLong, fmtTimestamp, relativeTime, todayDay, toDay, fromDay } from '../../shared/dates.ts';
import { describeChange } from '../../shared/describe.ts';
import type { ChangeRecord, Settings } from '../../shared/types.ts';
import { displayName, stableEqual } from '../../shared/util.ts';
import { ViewHeader } from '../components/Toolbar.tsx';
import { Avatar, ConfirmButton, Empty, Toggle } from '../components/ui.tsx';
import { useHistoryRows } from '../lib/historyRows.ts';
import { createSnapshot, deleteSnapshot, navigate, openItem, startCompare, timeTravel, useApp, useCalendar } from '../store.ts';

interface Entry {
  key: string;
  changes: ChangeRecord[];
}

/** The last moment of a calendar day in the viewer's time zone. */
function endOfLocalDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(new Date(y, m - 1, d + 1).getTime() - 1);
}

function dayLabel(ts: string): string {
  const d = new Date(ts);
  const local = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const today = todayDay();
  if (local === today) return 'Today';
  if (local === today - 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: local < today - 300 ? 'numeric' : undefined });
}

export function HistoryView() {
  const live = useApp((s) => s.live);
  const cal = useCalendar();
  // The newest 200 changes, then kept current as changes come in; older pages on request.
  const { rows: changes, loading, more, loadOlder } = useHistoryRows({ limit: 200 });
  const [q, setQ] = useState('');
  const [person, setPerson] = useState('');
  const [showMinor, setShowMinor] = useState(false);

  const people = useMemo(() => [...new Set(changes.map((c) => c.actor))].sort(), [changes]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = changes.filter((c) => {
      if (person && c.actor !== person) return false;
      const d = describeChange(c, live, cal);
      if (!showMinor && d.minor) return false;
      if (needle && !`${d.subject} ${d.details.join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const entries: Entry[] = [];
    for (const c of filtered) {
      const last = entries.at(-1);
      if (c.batchId && last && last.changes[0].batchId === c.batchId) last.changes.push(c);
      else entries.push({ key: String(c.seq), changes: [c] });
    }
    const days: { label: string; entries: Entry[] }[] = [];
    for (const e of entries) {
      const label = dayLabel(e.changes[0].ts);
      if (days.at(-1)?.label === label) days.at(-1)!.entries.push(e);
      else days.push({ label, entries: [e] });
    }
    return days;
  }, [changes, q, person, showMinor, live, cal]);

  return (
    <div className="view">
      <ViewHeader title="History" sub="Every change to the roadmap: who changed what, and when. Open any moment read-only, or compare it with today." />
      <div className="history-layout">
        <div className="history-main">
          <div className="history-filters">
            <div className="search-field">
              <Search size={14} />
              <input id="history-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search changes" aria-label="Search changes" />
            </div>
            <select id="history-person" className="select sm" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p} value={p}>
                  {displayName(p)}
                </option>
              ))}
            </select>
            <Toggle id="history-minor" checked={showMinor} onChange={setShowMinor} label="Show rearranging (rows, order)" />
          </div>
          {loading && <p className="muted">Loading history…</p>}
          {!loading && groups.length === 0 && <Empty title="No changes match">Try another search or person.</Empty>}
          {groups.map((day) => (
            <section key={day.label} className="history-day">
              <h3>{day.label}</h3>
              <ol className="feed">
                {day.entries.map((e) => (
                  <FeedEntry key={e.key} entry={e} />
                ))}
              </ol>
            </section>
          ))}
          {more && !loading && changes.length > 0 && (
            <button type="button" className="btn ghost" onClick={() => void loadOlder()}>
              Load older changes
            </button>
          )}
        </div>
        <SnapshotsPanel />
      </div>
    </div>
  );
}

function FeedEntry({ entry }: { entry: Entry }) {
  const live = useApp((s) => s.live);
  const cal = useCalendar();
  const first = entry.changes[0];
  const many = entry.changes.length > 1;
  const descs = entry.changes.map((c) => ({ c, d: describeChange(c, live, cal) }));
  const head = descs[0];
  const isItem = first.entity === 'item';
  const exists = isItem && !!live.items[first.entityId];
  // A calendar change that moved initiatives along with it: their old dates don't line up with the new
  // sprints, so listing before → after sprint codes would only confuse. Say what happened instead.
  const calendarMove =
    many &&
    entry.changes.some(
      (c) => c.entity === 'settings' && c.before && c.after && !stableEqual((c.before as Settings).sprints, (c.after as Settings).sprints),
    );
  const movedCount = entry.changes.filter((c) => c.entity === 'item').length;
  const settingsChange = entry.changes.find((c) => c.entity === 'settings');
  const toWeekNames =
    calendarMove && (settingsChange?.after as Settings | null)?.sprints.naming === 'week' && (settingsChange?.before as Settings | null)?.sprints.naming !== 'week';
  return (
    <li className="feed-entry">
      <Avatar name={first.actor} size={30} />
      <div className="feed-body">
        <div className="feed-line">
          <strong>{displayName(first.actor)}</strong>{' '}
          {calendarMove ? (
            <>
              changed the sprint calendar and moved {movedCount} initiative{movedCount === 1 ? '' : 's'} with it
            </>
          ) : many ? (
            <>made {entry.changes.length} changes together</>
          ) : (
            <>
              {head.d.verb}{' '}
              {exists ? (
                <button type="button" className="link-btn strong" onClick={() => openItem(first.entityId)}>
                  {head.d.subject}
                </button>
              ) : (
                <span className="feed-subject">{head.d.subject}</span>
              )}
            </>
          )}
          <span className="feed-time" title={fmtTimestamp(first.ts, true)}>
            {relativeTime(first.ts)}
          </span>
        </div>
        {!many && head.d.details.length > 0 && (
          <ul className="feed-details">
            {head.d.details.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
        {calendarMove && (
          <ul className="feed-details">
            {toWeekNames && <li>Sprints are now named after the week they start in ({cal.get(cal.indexOf(todayDay())).code} is the current one)</li>}
            <li>{toWeekNames ? 'Every initiative stays in the same sprints as before' : 'Dates that no longer fell on a sprint edge moved to one'}</li>
          </ul>
        )}
        {many && !calendarMove && (
          <ul className="feed-details">
            {descs.slice(0, 8).map(({ c, d }) => (
              <li key={c.seq}>
                {d.verb[0].toUpperCase() + d.verb.slice(1)}{' '}
                {c.entity === 'item' && live.items[c.entityId] ? (
                  <button type="button" className="link-btn" onClick={() => openItem(c.entityId)}>
                    {d.subject}
                  </button>
                ) : (
                  d.subject
                )}
                {d.details.length > 0 && c.action === 'update' ? <span className="muted"> · {d.details[0]}</span> : null}
              </li>
            ))}
            {descs.length > 8 && <li className="muted">and {descs.length - 8} more</li>}
          </ul>
        )}
        <div className="feed-actions">
          <button type="button" className="link-btn sm" onClick={() => void timeTravel(first.ts, `after ${displayName(first.actor)}’s change`)}>
            <Eye size={12} /> See the roadmap at this moment
          </button>
        </div>
      </div>
    </li>
  );
}

function SnapshotsPanel() {
  const snapshots = useApp((s) => s.snapshots);
  const travel = useApp((s) => s.travel);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(fromDay(todayDay() - 7));

  const compareWith = async (ts: string, label: string) => {
    await startCompare(ts, label);
    navigate({ view: 'alignment' });
  };

  return (
    <aside className="side-panel history-side" aria-label="Snapshots">
      <div className="side-head">
        <h2>
          <Camera size={15} /> Snapshots
        </h2>
      </div>
      <div className="side-body">
        <form
          className="snapshot-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void createSnapshot(name, note);
            setName('');
            setNote('');
          }}
        >
          <p className="muted sm">Mark today’s roadmap, for example after quarterly planning, so you can compare against it later.</p>
          <input id="snap-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q1 planning baseline" maxLength={120} disabled={!!travel} />
          <input id="snap-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} disabled={!!travel} />
          <button type="submit" className="btn primary" disabled={!name.trim() || !!travel}>
            Save snapshot
          </button>
        </form>

        <div className="snapshot-list">
          {snapshots.length === 0 && <p className="muted sm">No snapshots yet.</p>}
          {snapshots.map((s) => (
            <div key={s.id} className="snapshot">
              <div className="snapshot-name">{s.name}</div>
              <div className="muted sm">
                {fmtTimestamp(s.ts, true)} · {displayName(s.actor)}
              </div>
              {s.note && <div className="snapshot-note">{s.note}</div>}
              <div className="snapshot-actions">
                <button type="button" className="btn sm" onClick={() => void compareWith(s.ts, s.name)}>
                  <GitCompareArrows size={13} /> Compare with today
                </button>
                <button type="button" className="btn sm ghost" onClick={() => void timeTravel(s.ts, s.name)}>
                  <Eye size={13} /> View
                </button>
                <ConfirmButton className="icon-btn" confirmLabel={<span className="sm danger-text">Delete?</span>} onConfirm={() => void deleteSnapshot(s.id)} title="Delete snapshot">
                  <Trash2 size={14} />
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>

        <div className="time-jump">
          <h3>
            <Clock size={14} /> Any other date
          </h3>
          <p className="muted sm">History is kept for every change, so you can open any past day.</p>
          <div className="row">
            <input id="jump-date" type="date" className="input sm" value={date} max={fromDay(todayDay())} onChange={(e) => setDate(e.target.value)} />
            <button
              type="button"
              className="btn sm"
              disabled={!date}
              onClick={() => {
                const end = endOfLocalDay(date);
                void timeTravel(end.toISOString(), `end of ${fmtDayLong(toDay(date))}`);
              }}
            >
              View
            </button>
            <button
              type="button"
              className="btn sm ghost"
              disabled={!date}
              onClick={() => {
                const end = endOfLocalDay(date);
                void compareWith(end.toISOString(), `end of ${fmtDayLong(toDay(date))}`);
              }}
            >
              Compare
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
