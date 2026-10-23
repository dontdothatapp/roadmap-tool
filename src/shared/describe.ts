import { boardColor } from './colors.ts';
import type { SprintCalendar } from './sprints.ts';
import { PHASES, PHASE_LABELS, statusLabel, type ChangeRecord, type Item, type RoadmapState, type Settings, type Team, type Track } from './types.ts';
import { stableEqual } from './util.ts';

export interface ChangeDescription {
  /** What changed, e.g. "One-click checkout" or "Team Growth". */
  subject: string;
  /** Short verb phrase: "created", "rescheduled", "edited", … */
  verb: string;
  details: string[];
  /** Only the manual sort order changed. Hidden from the activity feed by default. */
  minor: boolean;
}

interface Ctx {
  state: RoadmapState;
  cal: SprintCalendar;
}

function teamName(ctx: Ctx, teamId: string | null | undefined): string {
  if (!teamId) return 'no team';
  return ctx.state.teams[teamId]?.name ?? 'a deleted team';
}

function trackName(ctx: Ctx, trackId: string | null | undefined): string {
  if (!trackId) return 'no strategic bet';
  return ctx.state.tracks[trackId]?.name ?? 'a deleted strategic bet';
}

function itemTitle(ctx: Ctx, itemId: string | null | undefined): string {
  if (!itemId) return 'an item';
  return ctx.state.items[itemId]?.title ?? 'a deleted item';
}

function shiftWord(n: number): string {
  if (n === 0) return '';
  const abs = Math.abs(n);
  return ` (${n > 0 ? '+' : '−'}${abs} sprint${abs === 1 ? '' : 's'})`;
}

function describeItemUpdate(before: Item, after: Item, ctx: Ctx): { verb: string; details: string[]; minor: boolean } {
  const details: string[] = [];
  let verb = 'edited';
  let rescheduled = false;

  if (before.title !== after.title) details.push(`Renamed from “${before.title}”`);
  if (before.teamId !== after.teamId) {
    details.push(`Moved from ${teamName(ctx, before.teamId)} to ${teamName(ctx, after.teamId)}`);
    verb = 'moved';
  }
  for (const phase of PHASES) {
    const a = before.phases[phase];
    const b = after.phases[phase];
    if (stableEqual(a, b)) continue;
    rescheduled = true;
    if (!a && b) details.push(`Added ${PHASE_LABELS[phase]}: ${ctx.cal.spanCode(b)}`);
    else if (a && !b) details.push(`Removed ${PHASE_LABELS[phase]} (was ${ctx.cal.spanCode(a)})`);
    else if (a && b) {
      const [a0, a1] = ctx.cal.spanIndexes(a);
      const [b0, b1] = ctx.cal.spanIndexes(b);
      const shift = a0 - b0 === a1 - b1 ? b0 - a0 : null;
      details.push(
        `${PHASE_LABELS[phase]}: ${ctx.cal.spanCode(a)} → ${ctx.cal.spanCode(b)}${shift !== null ? shiftWord(shift) : ''}`,
      );
    }
  }
  if (rescheduled && verb === 'edited') verb = 'rescheduled';
  if (before.status !== after.status) {
    details.push(statusChange(before.status, after.status));
    // History can hold statuses from earlier versions ("done").
    if (verb === 'edited') verb = (after.status as string) === 'done' ? 'completed' : 'updated';
  }
  if (before.key !== after.key) details.push(after.key ? 'Marked as a key initiative' : 'No longer a key initiative');
  if (before.trackId !== after.trackId) details.push(`Strategic bet: ${trackName(ctx, before.trackId)} → ${trackName(ctx, after.trackId)}`);
  // Items from older versions have no parentId at all: the same as null.
  if ((before.parentId ?? null) !== (after.parentId ?? null)) {
    details.push(after.parentId ? `Now part of “${itemTitle(ctx, after.parentId)}”` : `No longer part of “${itemTitle(ctx, before.parentId!)}”`);
  }
  if (before.owner !== after.owner) details.push(after.owner ? `Owner: ${after.owner}` : 'Removed the owner');
  if (before.description !== after.description) details.push('Edited the description');
  const addedTags = after.tags.filter((t) => !before.tags.includes(t));
  const removedTags = before.tags.filter((t) => !after.tags.includes(t));
  if (addedTags.length) details.push(`Tagged ${addedTags.map((t) => `#${t}`).join(', ')}`);
  if (removedTags.length) details.push(`Removed ${removedTags.map((t) => `#${t}`).join(', ')}`);
  if (before.onePagerUrl !== after.onePagerUrl) details.push(after.onePagerUrl ? 'Linked the one-pager' : 'Removed the one-pager link');
  if (!stableEqual(before.links, after.links)) details.push('Updated links');
  if (!stableEqual(before.outcomes, after.outcomes)) {
    const diff = after.outcomes.length - before.outcomes.length;
    details.push(diff > 0 ? `Added ${diff} expected outcome${diff > 1 ? 's' : ''}` : diff < 0 ? 'Removed an expected outcome' : 'Updated expected outcomes');
  }
  if (!stableEqual(before.dependencies, after.dependencies)) {
    const beforeIds = new Set(before.dependencies.map((d) => d.id));
    const afterIds = new Set(after.dependencies.map((d) => d.id));
    for (const d of after.dependencies) {
      if (!beforeIds.has(d.id)) {
        details.push(`Now needs ${d.itemId ? `“${itemTitle(ctx, d.itemId)}”` : teamName(ctx, d.teamId)}`);
      }
    }
    for (const d of before.dependencies) {
      if (!afterIds.has(d.id)) {
        details.push(`No longer needs ${d.itemId ? `“${itemTitle(ctx, d.itemId)}”` : teamName(ctx, d.teamId)}`);
      }
    }
    const changed = after.dependencies.filter((d) => {
      const old = before.dependencies.find((o) => o.id === d.id);
      return old && !stableEqual(old, d);
    });
    if (changed.length) details.push('Updated a connection');
  }
  // Where an initiative sits on the board (order, row, height) and its colour there are layout, not plan: minor,
  // hidden by default. Items from older versions have no row, tall or colour at all: the same as null and false.
  const rowBefore = before.row ?? null;
  const rowAfter = after.row ?? null;
  const tallChanged = !!before.tall !== !!after.tall;
  const colorChanged = (before.color ?? null) !== (after.color ?? null);
  const layoutOnly = details.length === 0 && (before.order !== after.order || rowBefore !== rowAfter || tallChanged || colorChanged);
  if (layoutOnly) {
    if (colorChanged) details.push(after.color ? `Coloured it ${boardColor(after.color).name.toLowerCase()} on the team board` : 'Gave it the default colour on the team board');
    if (tallChanged) details.push(after.tall ? 'Made it two rows high' : 'Made it one row high');
    if (rowBefore !== rowAfter) details.push(rowAfter === null ? 'Unplaced from its row' : `Moved to row ${rowAfter + 1}`);
    if (before.order !== after.order && rowBefore === rowAfter && !tallChanged && !colorChanged) details.push('Changed the order');
  }
  return { verb: layoutOnly ? 'rearranged' : verb, details, minor: layoutOnly };
}

/** History can hold statuses from earlier versions, so labels come from statusLabel. */
function statusChange(from: string, to: string): string {
  if (to === 'done') return 'Marked as done';
  if (to === 'at_risk') return 'Marked at risk';
  if (from === 'done') return 'No longer done';
  if (from === 'at_risk') return 'No longer at risk';
  return `Status: ${statusLabel(from)} → ${statusLabel(to)}`;
}

function describeSimple(before: Team | Track, after: Team | Track): string[] {
  const details: string[] = [];
  if (before.name !== after.name) details.push(`Renamed from “${before.name}”`);
  if (before.color !== after.color) details.push('Changed the colour');
  if ('archived' in before && 'archived' in after && before.archived !== after.archived) {
    details.push(after.archived ? 'Archived' : 'Restored from archive');
  }
  if ('ownView' in after && !!(before as Track).ownView !== after.ownView) details.push(after.ownView ? 'Gave it a view of its own' : 'Took away its own view');
  if ('pm' in after) {
    const epd = (t: Partial<Team>) => [t.pm, t.em, t.ux].map((v) => v ?? '').join('|');
    if (epd(before as Team) !== epd(after)) details.push(`Owners: ${epdLine(after) || 'none'}`);
  }
  if (before.order !== after.order && details.length === 0) details.push('Changed the order');
  return details;
}

/** "PM Anna · EM Tom · UX Lea" (only the roles that are filled in). */
export function epdLine(team: Partial<Team>): string {
  return (
    [
      ['PM', team.pm],
      ['EM', team.em],
      ['UX', team.ux],
    ] as const
  )
    .filter(([, name]) => name)
    .map(([role, name]) => `${role} ${name}`)
    .join(' · ');
}

function describeSettings(before: Settings, after: Settings): string[] {
  const details: string[] = [];
  if (before.name !== after.name) details.push(`Renamed the roadmap to “${after.name}”`);
  if (!stableEqual(before.sprints, after.sprints)) details.push('Changed the sprint cadence');
  if (before.fiscalYearStartMonth !== after.fiscalYearStartMonth) details.push('Changed the fiscal year start');
  if (!stableEqual(before.funnelStages, after.funnelStages)) details.push('Updated funnel stages');
  return details;
}

export function describeChange(change: ChangeRecord, state: RoadmapState, cal: SprintCalendar): ChangeDescription {
  const ctx: Ctx = { state, cal };
  const entity = (change.after ?? change.before) as Item | Team | Track | Settings;

  if (change.entity === 'settings') {
    return { subject: 'roadmap settings', verb: 'changed', details: describeSettings(change.before as Settings, change.after as Settings), minor: false };
  }

  if (change.entity === 'item') {
    const item = entity as Item;
    if (change.action === 'create') {
      const details = [`In ${teamName(ctx, item.teamId)}`];
      const phases = PHASES.filter((p) => item.phases[p]).map((p) => `${PHASE_LABELS[p]} ${cal.spanCode(item.phases[p]!)}`);
      if (phases.length) details.push(phases.join(' · '));
      return { subject: item.title, verb: 'added', details, minor: false };
    }
    if (change.action === 'delete') {
      return { subject: item.title, verb: 'removed', details: [`Was in ${teamName(ctx, item.teamId)}`], minor: false };
    }
    const { verb, details, minor } = describeItemUpdate(change.before as Item, change.after as Item, ctx);
    return { subject: item.title, verb, details, minor };
  }

  // Tracks are called strategic bets in the product.
  const kind = change.entity === 'team' ? 'team' : 'strategic bet';
  const named = entity as Team | Track;
  if (change.action === 'create') return { subject: `${kind} ${named.name}`, verb: 'added', details: [], minor: false };
  if (change.action === 'delete') return { subject: `${kind} ${named.name}`, verb: 'removed', details: [], minor: false };
  const details = describeSimple(change.before as Team | Track, change.after as Team | Track);
  return { subject: `${kind} ${named.name}`, verb: 'edited', details, minor: details.length === 1 && details[0] === 'Changed the order' };
}
