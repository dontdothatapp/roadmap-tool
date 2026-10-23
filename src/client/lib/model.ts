import { DEFAULT_BOARD_COLOR, boardColor, boardColorOf } from '../../shared/colors.ts';
import { deliveryEndDay, needStartDay } from '../../shared/sprints.ts';
import { epdLine } from '../../shared/describe.ts';
import { hasParts, isPart, linkedOutcomes, partsOf, umbrellaOf } from '../../shared/parts.ts';
import type { Dependency, ID, Item, RoadmapState, Status, Team, Track } from '../../shared/types.ts';
import { uid } from '../../shared/util.ts';
import type { ColorBy, Filters, GroupBy } from '../store.ts';

export const STATUS_COLORS: Record<Status, string> = {
  planned: '#9aa1ad',
  at_risk: '#d9480f',
};

export const NEUTRAL = '#6b7280';

export function sortedTeams(state: RoadmapState, includeArchived = false): Team[] {
  return Object.values(state.teams)
    .filter((t) => includeArchived || !t.archived)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Initiatives to pick from (to put an initiative under an umbrella, or to add parts to one) whose names have every
 * word of `query`. Umbrellas are planned per team, so the team's own are kept apart from the rest: `own` lists
 * `teamId`'s, umbrellas that already have parts first; `others` every other team's, in team order.
 */
export function pickableInitiatives(state: RoadmapState, candidates: Item[], teamId: ID, query: string): { own: Item[]; others: Item[] } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = candidates.filter((i) => words.every((w) => i.title.toLowerCase().includes(w)));
  const teamOrder = new Map(sortedTeams(state, true).map((t, k) => [t.id, k]));
  const byKind = (a: Item, b: Item) => Number(hasParts(state, b.id)) - Number(hasParts(state, a.id)) || a.title.localeCompare(b.title);
  return {
    own: found.filter((i) => i.teamId === teamId).sort(byKind),
    others: found.filter((i) => i.teamId !== teamId).sort((a, b) => (teamOrder.get(a.teamId) ?? 0) - (teamOrder.get(b.teamId) ?? 0) || byKind(a, b)),
  };
}

export function sortedTracks(state: RoadmapState): Track[] {
  return Object.values(state.tracks).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function matchesQuery(item: Item, state: RoadmapState, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const team = state.teams[item.teamId];
  const hay = [
    item.title,
    item.description,
    team?.name ?? '',
    // The team's owners stand for everything on its roadmap.
    team ? epdLine(team) : '',
    item.trackId ? (state.tracks[item.trackId]?.name ?? '') : '',
    // A part is found by its umbrella's name too.
    umbrellaOf(state, item)?.title ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return needle.split(/\s+/).every((w) => hay.includes(w));
}

export function applyFilters(items: Item[], state: RoadmapState, f: Filters, opts: { ignoreTeams?: boolean } = {}): Item[] {
  return items.filter((i) => {
    if (!opts.ignoreTeams && f.teams.length && !f.teams.includes(i.teamId)) return false;
    if (f.tracks.length && !(i.trackId && f.tracks.includes(i.trackId)) && !(f.tracks.includes('none') && !i.trackId)) return false;
    if (f.statuses.length && !f.statuses.includes(i.status)) return false;
    if (state.teams[i.teamId]?.archived) return false;
    return matchesQuery(i, state, f.q);
  });
}

/**
 * What the umbrella views (leadership, alignment) show: umbrellas and standalone initiatives, not parts. An
 * umbrella shows when it or any of its parts passes the filters. `rolled` is the rolled-up roadmap.
 */
export function umbrellaItems(rolled: RoadmapState, f: Filters): Item[] {
  const kept = new Set(applyFilters(Object.values(rolled.items), rolled, f).map((i) => i.id));
  return Object.values(rolled.items).filter((i) => !isPart(rolled, i) && (kept.has(i.id) || partsOf(rolled, i.id).some((p) => kept.has(p.id))));
}

/**
 * What a team reads: parts and initiatives on their own, not the umbrellas over them (alignment with parts shown,
 * each tagged with its umbrella).
 */
export function partItems(state: RoadmapState, f: Filters): Item[] {
  return applyFilters(
    Object.values(state.items).filter((i) => !hasParts(state, i.id)),
    state,
    f,
  );
}

/** An item's expected outcomes together with the linked ones: a part's umbrella's, an umbrella's parts'. */
export function outcomesOf(state: RoadmapState, item: Item): Item['outcomes'] {
  return linkedOutcomes(state, item).map((l) => l.outcome);
}

export function colorOf(item: Item, state: RoadmapState, by: ColorBy): string {
  // The team board draws every initiative alike: umbrellas are told apart by the coloured tags on their parts.
  if (by === 'board') return boardColor(DEFAULT_BOARD_COLOR).hex;
  if (by === 'track') return (item.trackId && state.tracks[item.trackId]?.color) || NEUTRAL;
  return state.teams[item.teamId]?.color ?? NEUTRAL;
}

/** Black or white, whichever reads better on `hex`. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#fff';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.36 ? '#14171f' : '#ffffff';
}

export interface GroupDef {
  id: string;
  label: string;
  color: string | null;
  sub?: string;
  /** Compact rows: the umbrella or initiative the row stands for. */
  itemId?: ID;
  /** Compact rows: a section's header (e.g. a team), above the rows in it. */
  header?: boolean;
}

/**
 * Lanes for a timeline and which lanes each item belongs to. Most groupings put an item in exactly one
 * lane; funnel stages can put it in several (it then appears once in each).
 */
export function groupsFor(state: RoadmapState, by: GroupBy, items: Item[]): { groups: GroupDef[]; groupsOf: (i: Item) => string[] } {
  const NONE = '__none';
  if (by === 'team') {
    const groups = sortedTeams(state).map((t) => ({ id: t.id, label: t.name, color: t.color, sub: epdLine(t) || undefined }));
    return { groups, groupsOf: (i) => [i.teamId] };
  }
  if (by === 'track') {
    const groups: GroupDef[] = sortedTracks(state).map((t) => ({ id: t.id, label: t.name, color: t.color, sub: t.description }));
    if (items.some((i) => !i.trackId || !state.tracks[i.trackId])) groups.push({ id: NONE, label: 'No strategic bet', color: null });
    return { groups, groupsOf: (i) => [i.trackId && state.tracks[i.trackId] ? i.trackId : NONE] };
  }
  if (by === 'stage') {
    const stages = state.settings.funnelStages;
    const known = new Set(stages.map((s) => s.id));
    const of = (i: Item) => {
      const ids = [...new Set(outcomesOf(state, i).map((o) => o.stageId).filter((id) => known.has(id)))];
      return ids.length ? ids : [NONE];
    };
    const groups: GroupDef[] = stages.map((s) => ({ id: s.id, label: s.name, color: s.color }));
    if (items.some((i) => of(i)[0] === NONE)) groups.push({ id: NONE, label: 'No expected outcome', color: null });
    return { groups, groupsOf: of };
  }
  if (by === 'umbrella') {
    // A lane for each umbrella the items are parts of (in its colour on the team board), then the ones on their own.
    const of = (i: Item) => {
      const umbrella = umbrellaOf(state, i);
      return [umbrella ? umbrella.id : hasParts(state, i.id) ? i.id : NONE];
    };
    const ids = [...new Set(items.flatMap(of))].filter((id) => id !== NONE);
    const groups: GroupDef[] = ids
      .map((id) => state.items[id])
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((u) => ({ id: u.id, label: u.title, color: boardColorOf(state, u).ink }));
    if (items.some((i) => of(i)[0] === NONE)) groups.push({ id: NONE, label: 'No umbrella', color: null });
    return { groups, groupsOf: of };
  }
  // No grouping: one lane (named only where lanes have names, e.g. leadership's label column).
  return { groups: [{ id: '__all', label: 'All initiatives', color: null }], groupsOf: () => ['__all'] };
}

/** The patch that moves an item into another lane, or null when that lane can't be set by dragging. */
export function regroupPatch(by: GroupBy, groupId: string, _groups: GroupDef[] = []): Partial<Item> | null {
  if (by === 'team') return { teamId: groupId };
  if (by === 'track') return { trackId: groupId === '__none' ? null : groupId };
  // Into an umbrella's lane: becomes one of its parts; into "No umbrella": an initiative on its own again.
  if (by === 'umbrella') return { parentId: groupId === '__none' ? null : groupId };
  return null;
}

/** Fields that put a new initiative in a lane: what regroupPatch sets, plus a funnel stage lane's stage. */
export function newItemPatch(by: GroupBy, groupId: string, groups: GroupDef[] = []): Partial<Item> | null {
  if (groupId === '__none') return regroupPatch(by, groupId, groups);
  if (by === 'stage') {
    return { outcomes: [{ id: uid(), stageId: groupId, metric: '', impact: null, unit: '%', confidence: 'medium', landsBy: null, ramp: [], note: '' }] };
  }
  return regroupPatch(by, groupId, groups);
}

/** Whether dragging between lanes changes something (funnel stages are edited in the details instead). */
export function canRegroup(by: GroupBy): boolean {
  return by === 'team' || by === 'track' || by === 'umbrella';
}

export interface DependencyInfo {
  /** The item that has the dependency. */
  from: Item;
  dep: Dependency;
  /** The item depended on, when it's a specific roadmap item. */
  target: Item | null;
  targetTeamId: ID | null;
  /** How many sprints late the dependency lands relative to when it's needed (0 = fine). */
  lateBy: number;
  conflict: boolean;
}

export function dependencyInfo(state: RoadmapState, from: Item, dep: Dependency, sprintIndexOf: (day: number) => number): DependencyInfo {
  const target = dep.itemId ? (state.items[dep.itemId] ?? null) : null;
  const targetTeamId = target ? target.teamId : dep.teamId;
  let lateBy = 0;
  if (target) {
    const ready = deliveryEndDay(target);
    const needed = needStartDay(from);
    if (ready !== null && needed !== null && ready > needed) {
      lateBy = Math.max(1, sprintIndexOf(ready - 1) - sprintIndexOf(needed) + 1);
    }
  }
  return { from, dep, target, targetTeamId, lateBy, conflict: lateBy > 0 };
}

export function allDependencies(state: RoadmapState, sprintIndexOf: (day: number) => number): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  for (const item of Object.values(state.items)) {
    for (const dep of item.dependencies) out.push(dependencyInfo(state, item, dep, sprintIndexOf));
  }
  return out;
}
