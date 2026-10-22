import { useCallback, useMemo } from 'react';
import { partsOf, rollUp } from '../../shared/parts.ts';
import { overallDays } from '../../shared/sprints.ts';
import type { Item } from '../../shared/types.ts';
import { FilterButton, SearchField, TimelineControls, UmbrellaToggles, ViewHeader, useTimelineShortcuts } from '../components/Toolbar.tsx';
import { Empty } from '../components/ui.tsx';
import { sortedTeams, umbrellaItems, type GroupDef } from '../lib/model.ts';
import { openItem, setPrefs, useApp, useReadOnly, useRoadmap } from '../store.ts';
import { Timeline } from '../timeline/Timeline.tsx';

/**
 * One strategic bet as a plain timeline: a row per umbrella (or per initiative without one), named on the left,
 * with bars and no names in them. An umbrella shows as one bar, like in the leadership view, and opens to show its
 * parts, a line each, named under it. Rows can be grouped by team or tag.
 */
export function BetView() {
  const raw = useRoadmap();
  const state = useMemo(() => rollUp(raw), [raw]);
  const readOnly = useReadOnly();
  const prefs = useApp((s) => s.prefs.bet);
  const filters = useApp((s) => s.filters);
  const compare = useApp((s) => s.compare);
  const betId = useApp((s) => s.route.betId);
  const todayToken = useTimelineShortcuts('bet');
  const bet = betId ? state.tracks[betId] : undefined;
  const groupBy = prefs.groupBy === 'team' || prefs.groupBy === 'tag' ? prefs.groupBy : 'none';

  const { groups, items, umbrellas } = useMemo(() => {
    if (!bet) return { groups: [] as GroupDef[], items: [] as Item[], umbrellas: [] as string[] };
    // Rows with nothing to draw are left out; their initiatives are counted as without dates.
    const heads = umbrellaItems(state, filters)
      .filter((head) => head.trackId === bet.id && Object.keys(head.phases).length > 0)
      .sort((a, b) => (overallDays(a)?.start ?? 0) - (overallDays(b)?.start ?? 0) || a.title.localeCompare(b.title));
    const teamName = (id: string) => state.teams[id]?.name ?? 'Deleted team';
    const row = (head: Item, section: string | null): GroupDef => {
      const parts = partsOf(state, head.id);
      return {
        id: section === null ? head.id : `${section}|${head.id}`,
        itemId: head.id,
        label: head.title,
        color: state.teams[head.teamId]?.color ?? null,
        sub: [...new Set((parts.length ? parts : [head]).map((p) => teamName(p.teamId)))].join(' · '),
      };
    };
    const sections: { id: string; label: string; color: string | null; heads: Item[] }[] = [];
    if (groupBy === 'team') {
      for (const team of sortedTeams(state)) {
        const mine = heads.filter((h) => h.teamId === team.id);
        if (mine.length) sections.push({ id: team.id, label: team.name, color: team.color, heads: mine });
      }
      const orphans = heads.filter((h) => !state.teams[h.teamId] || state.teams[h.teamId].archived);
      if (orphans.length) sections.push({ id: '__none', label: 'Other teams', color: null, heads: orphans });
    } else if (groupBy === 'tag') {
      // An initiative with several tags shows under each.
      for (const tag of [...new Set(heads.flatMap((h) => h.tags))].sort((a, b) => a.localeCompare(b))) {
        sections.push({ id: `t:${tag}`, label: `#${tag}`, color: null, heads: heads.filter((h) => h.tags.includes(tag)) });
      }
      const untagged = heads.filter((h) => h.tags.length === 0);
      if (untagged.length) sections.push({ id: '__none', label: 'No tags', color: null, heads: untagged });
    }
    return {
      groups:
        groupBy === 'none'
          ? heads.map((h) => row(h, null))
          : sections.flatMap((sec) => [
              { id: `§${sec.id}`, label: sec.label, color: sec.color, sub: String(sec.heads.length), header: true },
              ...sec.heads.map((h) => row(h, sec.id)),
            ]),
      // Names are on the left, so a bar never needs two rows for a long one.
      items: heads.map((h) => (h.tall ? { ...h, tall: false } : h)),
      umbrellas: heads.filter((h) => partsOf(state, h.id).length > 0).map((h) => h.id),
    };
  }, [state, filters, bet, groupBy]);

  const groupsOf = useCallback(
    (i: Item) => {
      if (groupBy === 'team') return [`${state.teams[i.teamId] && !state.teams[i.teamId].archived ? i.teamId : '__none'}|${i.id}`];
      if (groupBy === 'tag') return i.tags.length ? i.tags.map((t) => `t:${t}|${i.id}`) : [`__none|${i.id}`];
      return [i.id];
    },
    [state, groupBy],
  );
  // Drawing in an umbrella's row adds a part to it; an initiative's own row has no room for another.
  const newItemDefaults = useCallback(
    (groupId: string) => {
      const head = state.items[groupId.split('|').pop() ?? ''];
      return head && bet && partsOf(state, head.id).length ? ({ parentId: head.id, teamId: head.teamId, trackId: bet.id } as Partial<Item>) : null;
    },
    [state, bet],
  );

  if (!bet) {
    return (
      <div className="view">
        <ViewHeader title="Strategic bet" />
        <Empty title="No strategic bet to show">Give a strategic bet a view of its own in Settings, under Strategic bets.</Empty>
      </div>
    );
  }

  return (
    <div className="view">
      <ViewHeader
        title={
          <span className="bet-title">
            <span className="bet-dot" style={{ background: bet.color }} />
            {bet.name}
          </span>
        }
        sub={bet.description || 'Every umbrella and initiative in this strategic bet, a row each. Click a name to open it.'}
        controls={<TimelineControls view="bet" groupOptions={['none', 'team', 'tag']} depsToggle extra={<UmbrellaToggles view="bet" ids={umbrellas} />} />}
      >
        <SearchField />
        <FilterButton />
      </ViewHeader>
      <div className="timeline-card">
        <Timeline
          state={state}
          items={items}
          groups={groups}
          groupsOf={groupsOf}
          groupBy="none"
          mode="packed"
          compact
          expanded={prefs.expanded}
          onToggleExpand={(id) => setPrefs('bet', { expanded: prefs.expanded.includes(id) ? prefs.expanded.filter((e) => e !== id) : [...prefs.expanded, id] })}
          onOpenGroup={openItem}
          phaseMode={prefs.phaseMode}
          pxPerDay={prefs.pxPerDay}
          onZoom={(pxPerDay) => setPrefs('bet', { pxPerDay })}
          colorBy="team"
          showDeps={prefs.showDeps}
          compare={compare ? rollUp(compare.state) : null}
          readOnly={readOnly}
          collapsed={[]}
          onToggleGroup={() => {}}
          newItemDefaults={newItemDefaults}
          labelWidth={260}
          todayToken={todayToken}
        />
      </div>
    </div>
  );
}
