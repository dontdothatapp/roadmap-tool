import { useCallback, useMemo } from 'react';
import { collectDrivers, stageFigures, type StageFigures } from '../../shared/impact.ts';
import { partsOf, rollUp, umbrellaOf } from '../../shared/parts.ts';
import type { ID, Item, Outcome, RoadmapState } from '../../shared/types.ts';
import { FilterButton, SearchField, TimelineControls, UmbrellaToggles, ViewHeader, useTimelineShortcuts } from '../components/Toolbar.tsx';
import { Toggle } from '../components/ui.tsx';
import { groupsFor, newItemPatch, umbrellaItems } from '../lib/model.ts';
import { setPrefs, useApp, useReadOnly, useRoadmap, useVersions } from '../store.ts';
import { Timeline } from '../timeline/Timeline.tsx';

export function LeadershipView() {
  // Leadership reads umbrellas: an initiative split into parts shows once, with the dates of its parts.
  const raw = useRoadmap();
  const state = useMemo(() => rollUp(raw), [raw]);
  const readOnly = useReadOnly();
  const prefs = useApp((s) => s.prefs.leadership);
  const filters = useApp((s) => s.filters);
  const compare = useApp((s) => s.compare);
  const todayToken = useTimelineShortcuts('leadership');

  const items = useMemo(() => umbrellaItems(state, filters), [state, filters]);
  const { groups, groupsOf } = useMemo(() => groupsFor(state, prefs.groupBy, items), [state, prefs.groupBy, items]);
  const newItemDefaults = useCallback((groupId: string) => (newItemPatch(prefs.groupBy, groupId, groups) ?? {}) as Partial<Item>, [prefs.groupBy, groups]);
  const compareState = useMemo(() => (compare ? rollUp(compare.state) : null), [compare]);
  const umbrellas = useMemo(() => items.filter((i) => partsOf(state, i.id).length > 0).map((i) => i.id), [state, items]);
  // While an older version is open or compared with, expected impact reads "then → now" (the older version, today).
  const versions = useVersions();
  const pair = useMemo(() => (versions ? { before: rollUp(versions.before), after: rollUp(versions.after) } : null), [versions]);
  // The initiatives shown and their parts: the same filters on either version.
  const shownIn = useCallback(
    (s: RoadmapState) => (s === state ? items : umbrellaItems(s, filters)).flatMap((i) => [i, ...partsOf(s, i.id)]),
    [state, items, filters],
  );
  // The header shows what each month (or quarter) is expected to move, from the initiatives shown and their parts.
  const outcomes = useMemo(() => {
    const stages = state.settings.funnelStages;
    if (!pair) return { drivers: collectDrivers(state, shownIn(state)), stages };
    return { drivers: collectDrivers(pair.after, shownIn(pair.after)), was: collectDrivers(pair.before, shownIn(pair.before)), stages };
  }, [state, pair, shownIn]);
  // Each bar names what its initiative is expected to move: an umbrella its own outcomes and its parts', a part
  // shown under its open umbrella only its own.
  const impactLines = useMemo(() => {
    const stages = state.settings.funnelStages;
    const outcomesIn = (s: RoadmapState, id: ID): Outcome[] | null => {
      const item = s.items[id];
      if (!item) return null;
      return umbrellaOf(s, item) ? item.outcomes : [item, ...partsOf(s, id)].flatMap((i) => i.outcomes);
    };
    const lines = new Map<ID, StageFigures[]>();
    for (const item of shownIn(state)) {
      // An initiative added since the older version has nothing to compare with (it's marked new).
      const figures = pair
        ? stageFigures(stages, outcomesIn(pair.after, item.id) ?? [], outcomesIn(pair.before, item.id))
        : stageFigures(stages, outcomesIn(state, item.id) ?? []);
      if (figures.length) lines.set(item.id, figures);
    }
    return lines;
  }, [state, pair, shownIn]);

  return (
    <div className="view">
      <ViewHeader
        title="Leadership"
        sub="Where the company is heading, and what is at risk. Hover for details, click to open; clicking an umbrella shows its parts."
        controls={
          <TimelineControls
            view="leadership"
            groupOptions={['track', 'team', 'stage', 'tag', 'none']}
            colorOptions
            depsToggle
            extra={
              <>
                <Toggle id="leadership-bets" checked={prefs.betTags} onChange={(betTags) => setPrefs('leadership', { betTags })} label="Show strategic bet tags" />
                <UmbrellaToggles view="leadership" ids={umbrellas} />
              </>
            }
          />
        }
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
          groupBy={prefs.groupBy}
          mode="packed"
          phaseMode={prefs.phaseMode}
          pxPerDay={prefs.pxPerDay}
          onZoom={(pxPerDay) => setPrefs('leadership', { pxPerDay })}
          colorBy={prefs.colorBy}
          showDeps={prefs.showDeps}
          compare={compareState}
          readOnly={readOnly}
          collapsed={prefs.collapsed}
          onToggleGroup={(id) =>
            setPrefs('leadership', { collapsed: prefs.collapsed.includes(id) ? prefs.collapsed.filter((c) => c !== id) : [...prefs.collapsed, id] })
          }
          newItemDefaults={newItemDefaults}
          labelWidth={196}
          todayToken={todayToken}
          outcomes={outcomes}
          impactLines={impactLines}
          betTags={prefs.betTags}
          expanded={prefs.expanded}
          onToggleExpand={(id) =>
            setPrefs('leadership', { expanded: prefs.expanded.includes(id) ? prefs.expanded.filter((e) => e !== id) : [...prefs.expanded, id] })
          }
        />
      </div>
    </div>
  );
}
