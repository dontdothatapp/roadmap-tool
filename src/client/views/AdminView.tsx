import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Upload } from 'lucide-react';
import { MONTHS_LONG, WEEKDAY_NAMES, fmtRange, todayDay, toDay, weekday } from '../../shared/dates.ts';
import { TEAM_COLORS } from '../../shared/engine.ts';
import { SprintCalendar } from '../../shared/sprints.ts';
import type { FunnelStage, Op, Settings, SprintNaming, SprintPatternEntry, Team, Track } from '../../shared/types.ts';
import { uid } from '../../shared/util.ts';
import { ViewHeader } from '../components/Toolbar.tsx';
import { ConfirmButton, Popover, Toggle } from '../components/ui.tsx';
import { sortedTeams, sortedTracks } from '../lib/model.ts';
import { api, dispatch, toast, useApp, useReadOnly } from '../store.ts';

function updateSettings(patch: Partial<Settings>, label: string) {
  dispatch([{ kind: 'update', entity: 'settings', id: 'settings', patch: patch as Record<string, unknown> }], label);
}

function Text({ value, onCommit, id, placeholder, className = 'input', disabled }: { value: string; onCommit: (v: string) => void; id: string; placeholder?: string; className?: string; disabled?: boolean }) {
  // `draft` is null until the person types, so outside changes keep showing and an untouched field never saves.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      className={className}
      value={draft ?? value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

function ColorPicker({ value, onChange, disabled, label }: { value: string; onChange: (c: string) => void; disabled?: boolean; label: string }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" ref={setAnchor} className="swatch-btn" style={{ background: value }} onClick={() => setOpen((o) => !o)} disabled={disabled} aria-label={`${label} colour`} />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={196}>
        <div className="swatches">
          {TEAM_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${c === value ? ' is-on' : ''}`}
              style={{ background: c }}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              aria-label={c}
            />
          ))}
          <label className="swatch custom" title="Custom colour">
            <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />+
          </label>
        </div>
      </Popover>
    </>
  );
}

export function AdminView() {
  const state = useApp((s) => s.live);
  const readOnly = useReadOnly();
  const settings = state.settings;

  return (
    <div className="view scroll">
      <ViewHeader title="Settings" sub="Shared by everyone. Every change here is recorded in History too." />
      {readOnly && <p className="notice">You’re viewing a past version. Go back to the live roadmap to change settings.</p>}
      <div className="admin">
        <section className="admin-card">
          <h2>General</h2>
          <div className="form-grid">
            <label htmlFor="set-name">Roadmap name</label>
            <Text id="set-name" value={settings.name} disabled={readOnly} onCommit={(name) => updateSettings({ name }, 'Renamed the roadmap')} />
            <label htmlFor="set-fy">Fiscal year starts in</label>
            <select
              id="set-fy"
              className="select"
              value={settings.fiscalYearStartMonth}
              disabled={readOnly}
              onChange={(e) => updateSettings({ fiscalYearStartMonth: Number(e.target.value) }, 'Changed the fiscal year')}
            >
              {MONTHS_LONG.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </section>

        <SprintSettingsCard settings={settings} readOnly={readOnly} />

        <EntityList
          title="Teams"
          kind="team"
          readOnly={readOnly}
          rows={sortedTeams(state, true)}
          usage={(id) => Object.values(state.items).filter((i) => i.teamId === id).length}
          describeUsage={(n) => `${n} initiative${n === 1 ? '' : 's'}`}
          hint="Each team’s PM, EM and UX designer own everything on its roadmap."
        />
        <EntityList
          title="Strategic bets"
          kind="track"
          readOnly={readOnly}
          rows={sortedTracks(state)}
          usage={(id) => Object.values(state.items).filter((i) => i.trackId === id).length}
          describeUsage={(n) => `${n} initiative${n === 1 ? '' : 's'}`}
          hint="The big bets the roadmap serves. The leadership view groups by them. Turn on Own view to give a bet its own page in the sidebar: a row per umbrella, names on the left."
        />
        <FunnelCard stages={settings.funnelStages} readOnly={readOnly} />
        <DataCard readOnly={readOnly} />
      </div>
    </div>
  );
}

function SprintSettingsCard({ settings, readOnly }: { settings: Settings; readOnly: boolean }) {
  const sp = settings.sprints;
  const set = (patch: Partial<Settings['sprints']>) => updateSettings({ sprints: { ...sp, ...patch } }, 'Changed the sprint cadence');
  const setEntry = (i: number, patch: Partial<SprintPatternEntry>) => set({ pattern: sp.pattern.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const cal = new SprintCalendar(sp);
  const now = cal.indexOf(todayDay());
  const preview = Array.from({ length: 8 }, (_, k) => cal.get(now + k));
  const anchorDay = toDay(sp.anchor);
  const cycleWeeks = sp.pattern.reduce((s, p) => s + p.weeks, 0);
  return (
    <section className="admin-card">
      <h2>Sprint cadence</h2>
      <p className="muted sm">
        The pattern repeats every {cycleWeeks} weeks. Every date on the roadmap snaps to these sprints, so the timeline and sprint planning use the same calendar.
      </p>
      <div className="form-grid">
        <label htmlFor="set-anchor">A cycle starts on</label>
        <div>
          <input id="set-anchor" type="date" className="input" value={sp.anchor} disabled={readOnly} onChange={(e) => e.target.value && set({ anchor: e.target.value })} />
          <div className={`sm ${weekday(anchorDay) === 4 ? 'muted' : 'warn-text'}`}>
            That’s a {WEEKDAY_NAMES[weekday(anchorDay)]}
            {weekday(anchorDay) !== 4 && '. Your sprints usually start on Thursdays.'}
          </div>
        </div>
        <label htmlFor="set-naming">Name sprints by</label>
        <select
          id="set-naming"
          className="select"
          value={sp.naming}
          disabled={readOnly}
          onChange={(e) => set({ naming: e.target.value as SprintNaming })}
        >
          <option value="week">The week they start in (W42)</option>
          <option value="sequence">A running number (S25)</option>
        </select>
        {sp.naming === 'sequence' && (
          <>
            <label htmlFor="set-first">The cycle above starts with number</label>
            <input
              id="set-first"
              type="number"
              className="input sm num"
              value={sp.firstNumber}
              disabled={readOnly}
              onChange={(e) => e.target.value !== '' && set({ firstNumber: Math.round(Number(e.target.value)) })}
            />
          </>
        )}
      </div>
      <div className="pattern">
        <div className="pattern-head">
          <span>Length</span>
          <span>Name</span>
          <span>Prefix</span>
          <span>Shade</span>
          <span />
        </div>
        {sp.pattern.map((p, i) => (
          <div key={i} className="pattern-row">
            <select id={`pat-weeks-${i}`} className="select sm" value={p.weeks} disabled={readOnly} onChange={(e) => setEntry(i, { weeks: Number(e.target.value) })} aria-label="Weeks">
              {[1, 2, 3, 4].map((w) => (
                <option key={w} value={w}>
                  {w} week{w > 1 ? 's' : ''}
                </option>
              ))}
            </select>
            <Text id={`pat-label-${i}`} className="input sm" value={p.label} disabled={readOnly} onCommit={(label) => setEntry(i, { label })} />
            <Text id={`pat-short-${i}`} className="input sm mono" value={p.short} disabled={readOnly} onCommit={(short) => setEntry(i, { short })} />
            <input id={`pat-hl-${i}`} type="checkbox" checked={p.highlight} disabled={readOnly} onChange={(e) => setEntry(i, { highlight: e.target.checked })} aria-label="Shade on the timeline" />
            <button type="button" className="icon-btn xs" disabled={readOnly || sp.pattern.length === 1} onClick={() => set({ pattern: sp.pattern.filter((_, j) => j !== i) })} aria-label="Remove sprint type">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!readOnly && (
          <button type="button" className="btn ghost sm add-row" onClick={() => set({ pattern: [...sp.pattern, { weeks: 2, label: 'Sprint', short: 'S', highlight: false }] })}>
            <Plus size={13} /> Add a sprint to the cycle
          </button>
        )}
      </div>
      <div className="sprint-preview">
        <div className="muted sm">Coming up</div>
        <div className="sprint-preview-list">
          {preview.map((s) => (
            <div key={s.index} className={`sprint-chip${s.highlight ? ' is-highlight' : ''}${s.index === now ? ' is-now' : ''}`}>
              <span className="mono">{s.code}</span>
              <span>{fmtRange(s.start, s.end)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const OWNER_ROLES = [
  { key: 'pm', label: 'PM', placeholder: 'Product manager' },
  { key: 'em', label: 'EM', placeholder: 'Engineering manager' },
  { key: 'ux', label: 'UX', placeholder: 'Designer' },
] as const;

/** The team's EPD trio: they own every initiative on the team's roadmap. */
function TeamOwners({ team, readOnly, onChange }: { team: Team; readOnly: boolean; onChange: (patch: Partial<Team>, label: string) => void }) {
  return (
    <div className="entity-owners">
      {OWNER_ROLES.map((r) => (
        <label key={r.key} className="owner-field" htmlFor={`team-${r.key}-${team.id}`}>
          <span>{r.label}</span>
          <Text
            id={`team-${r.key}-${team.id}`}
            value={team[r.key] ?? ''}
            placeholder={r.placeholder}
            disabled={readOnly}
            onCommit={(v) => onChange({ [r.key]: v.trim() }, `Set the ${r.label} of ${team.name}`)}
          />
        </label>
      ))}
    </div>
  );
}

function EntityList({
  title,
  kind,
  rows,
  readOnly,
  usage,
  describeUsage,
  hint,
}: {
  title: string;
  kind: 'team' | 'track';
  rows: (Team | Track)[];
  readOnly: boolean;
  usage: (id: string) => number;
  describeUsage: (n: number) => string;
  hint?: string;
}) {
  const items = useApp((s) => s.live.items);
  // Tracks are called strategic bets in the product.
  const noun = kind === 'team' ? 'team' : 'strategic bet';
  const update = (id: string, patch: Record<string, unknown>, label: string) => dispatch([{ kind: 'update', entity: kind, id, patch }], label);
  const move = (i: number, dir: -1 | 1) => {
    const a = rows[i];
    const b = rows[i + dir];
    if (!a || !b) return;
    dispatch(
      [
        { kind: 'update', entity: kind, id: a.id, patch: { order: b.order } },
        { kind: 'update', entity: kind, id: b.id, patch: { order: a.order === b.order ? a.order + dir : a.order } },
      ],
      `Reordered ${title.toLowerCase()}`,
    );
  };
  const remove = (row: Team | Track) => {
    const ops: Op[] = [{ kind: 'delete', entity: kind, id: row.id }];
    if (kind === 'track') {
      for (const i of Object.values(items)) if (i.trackId === row.id) ops.unshift({ kind: 'update', entity: 'item', id: i.id, patch: { trackId: null } });
    }
    dispatch(ops, `Deleted ${noun} “${row.name}”`, { undoToast: true });
  };
  const add = () => {
    const order = rows.reduce((m, r) => Math.max(m, r.order), -1) + 1;
    const color = TEAM_COLORS[rows.length % TEAM_COLORS.length];
    dispatch([{ kind: 'create', entity: kind, id: uid(), data: { name: kind === 'team' ? 'New team' : 'New strategic bet', color, order } }], `Added a ${noun}`);
  };
  return (
    <section className="admin-card">
      <h2>{title}</h2>
      {hint && <p className="muted sm">{hint}</p>}
      <div className="entity-list">
        {rows.map((row, i) => {
          const n = usage(row.id);
          const archived = 'archived' in row && row.archived;
          return (
            <div key={row.id} className={`entity-item${archived ? ' is-archived' : ''}`}>
              <div className="entity-row">
                <ColorPicker value={row.color} label={row.name} disabled={readOnly} onChange={(color) => update(row.id, { color }, `Changed the colour of ${row.name}`)} />
                <Text id={`${kind}-name-${row.id}`} value={row.name} disabled={readOnly} onCommit={(name) => update(row.id, { name }, `Renamed ${noun} “${row.name}”`)} />
                {kind === 'track' && (
                  <Text
                    id={`${kind}-desc-${row.id}`}
                    value={(row as Track).description}
                    placeholder="What this bet is about"
                    disabled={readOnly}
                    onCommit={(description) => update(row.id, { description }, `Edited strategic bet “${row.name}”`)}
                  />
                )}
                <span className="muted sm entity-usage">{describeUsage(n)}</span>
                <span className="entity-actions">
                  <button type="button" className="icon-btn xs" disabled={readOnly || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" className="icon-btn xs" disabled={readOnly || i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown size={13} />
                  </button>
                  {kind === 'track' && (
                    <Toggle
                      id={`track-view-${row.id}`}
                      checked={(row as Track).ownView}
                      onChange={(on) => update(row.id, { ownView: on }, on ? `Gave “${row.name}” a view of its own` : `“${row.name}” no longer has its own view`)}
                      label="Own view"
                    />
                  )}
                  {kind === 'team' && (
                    <Toggle id={`team-arch-${row.id}`} checked={!archived} onChange={(on) => update(row.id, { archived: !on }, `${on ? 'Restored' : 'Archived'} team “${row.name}”`)} label={archived ? 'Archived' : 'Active'} />
                  )}
                  {(kind === 'track' || n === 0) && (
                    <ConfirmButton className="icon-btn xs" confirmLabel={<span className="danger-text sm">Delete?</span>} onConfirm={() => remove(row)} disabled={readOnly} title={`Delete ${noun}`}>
                      <Trash2 size={13} />
                    </ConfirmButton>
                  )}
                </span>
              </div>
              {kind === 'team' && <TeamOwners team={row as Team} readOnly={readOnly} onChange={(patch, label) => update(row.id, patch, label)} />}
            </div>
          );
        })}
      </div>
      {kind === 'team' && <p className="muted sm">Teams with initiatives can’t be deleted; archive them instead to hide them everywhere.</p>}
      {!readOnly && (
        <button type="button" className="btn ghost sm add-row" onClick={add}>
          <Plus size={13} /> Add a {noun}
        </button>
      )}
    </section>
  );
}

function FunnelCard({ stages, readOnly }: { stages: FunnelStage[]; readOnly: boolean }) {
  const set = (funnelStages: FunnelStage[]) => updateSettings({ funnelStages }, 'Updated funnel stages');
  return (
    <section className="admin-card">
      <h2>Funnel stages</h2>
      <p className="muted sm">Expected outcomes are filed under these. The Impact view shows one row per stage.</p>
      <div className="entity-list">
        {stages.map((s, i) => (
          <div key={s.id} className="entity-row">
            <ColorPicker value={s.color} label={s.name} disabled={readOnly} onChange={(color) => set(stages.map((x, j) => (j === i ? { ...x, color } : x)))} />
            <Text id={`stage-${s.id}`} value={s.name} disabled={readOnly} onCommit={(name) => set(stages.map((x, j) => (j === i ? { ...x, name } : x)))} />
            <span className="entity-actions">
              <button type="button" className="icon-btn xs" disabled={readOnly || i === 0} onClick={() => set(stages.map((x, j) => (j === i ? stages[i - 1] : j === i - 1 ? stages[i] : x)))} aria-label="Move up">
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className="icon-btn xs"
                disabled={readOnly || i === stages.length - 1}
                onClick={() => set(stages.map((x, j) => (j === i ? stages[i + 1] : j === i + 1 ? stages[i] : x)))}
                aria-label="Move down"
              >
                <ArrowDown size={13} />
              </button>
              <ConfirmButton className="icon-btn xs" confirmLabel={<span className="danger-text sm">Delete?</span>} onConfirm={() => set(stages.filter((_, j) => j !== i))} disabled={readOnly || stages.length === 1} title="Delete stage">
                <Trash2 size={13} />
              </ConfirmButton>
            </span>
          </div>
        ))}
      </div>
      {!readOnly && (
        <button type="button" className="btn ghost sm add-row" onClick={() => set([...stages, { id: uid(), name: 'New stage', color: TEAM_COLORS[(stages.length + 3) % TEAM_COLORS.length] }])}>
          <Plus size={13} /> Add a stage
        </button>
      )}
    </section>
  );
}

function DataCard({ readOnly }: { readOnly: boolean }) {
  // The demo build has no server to export from, so the export/import code is left out of it entirely.
  return __DEMO__ ? <DemoDataCard /> : <ServerDataCard readOnly={readOnly} />;
}

function DemoDataCard() {
  return (
    <section className="admin-card">
      <h2>Data</h2>
      <p className="muted sm">This is the demo: everything you change is stored only in this browser.</p>
      <ConfirmButton className="btn" confirmLabel="Click again to reset" onConfirm={() => api.resetDemo?.()}>
        Reset the demo data
      </ConfirmButton>
    </section>
  );
}

function ServerDataCard({ readOnly }: { readOnly: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: unknown } | null>(null);
  return (
    <section className="admin-card">
      <h2>Data</h2>
      <p className="muted sm">Download everything as JSON for backups or to move to another server. Importing replaces the roadmap with the file’s contents. It’s recorded in History, so you can still open and compare the version from before.</p>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const data = await api.exportData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `roadmap-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download size={14} /> Export JSON
        </button>
        <button type="button" className="btn" disabled={readOnly} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Import JSON…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              setPending({ name: file.name, data: JSON.parse(await file.text()) });
            } catch {
              toast('That file isn’t valid JSON.', { tone: 'error' });
            }
          }}
        />
      </div>
      {pending && (
        <div className="notice">
          Replace the whole roadmap with <strong>{pending.name}</strong>?
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                try {
                  const n = await api.importData(pending.data);
                  toast(n ? `Imported: ${n} changes recorded in History` : 'Nothing to import: the file matches the roadmap', { tone: 'success' });
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Import failed', { tone: 'error' });
                }
                setPending(null);
              }}
            >
              Replace
            </button>
            <button type="button" className="btn ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
