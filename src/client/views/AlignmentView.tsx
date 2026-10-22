import { useCallback, useMemo } from 'react';
import { partsOf, rollUp } from '../../shared/parts.ts';
import type { Item } from '../../shared/types.ts';
import { FilterButton, SearchField, TimelineControls, UmbrellaToggles, ViewHeader, useTimelineShortcuts } from '../components/Toolbar.tsx';
import { groupsFor, umbrellaItems } from '../lib/model.ts';
import { setPrefs, useApp, useReadOnly, useRoadmap } from '../store.ts';
import { Timeline } from '../timeline/Timeline.tsx';

export function AlignmentView() {
  // Like leadership, alignment shows umbrellas (with their parts' dates); a part's dependencies draw from its umbrella.
  const raw = useRoadmap();
  const state = useMemo(() => rollUp(raw), [raw]);
  const readOnly = useReadOnly();
  const prefs = useApp((s) => s.prefs.alignment);
  const filters = useApp((s) => s.filters);
  const compare = useApp((s) => s.compare);
  const todayToken = useTimelineShortcuts('alignment');

  const items = useMemo(() => umbrellaItems(state, filters), [state, filters]);
  const compareState = useMemo(() => (compare ? rollUp(compare.state) : null), [compare]);
  const { groups, groupsOf } = useMemo(() => groupsFor(state, 'team', items), [state, items]);
  const newItemDefaults = useCallback((groupId: string) => ({ teamId: groupId }) as Partial<Item>, []);
  const umbrellas = useMemo(() => items.filter((i) => partsOf(state, i.id).length > 0).map((i) => i.id), [state, items]);

  return (
    <div className="view">
      <ViewHeader
        title="Alignment"
        sub="Every team on one timeline. Open an initiative to see its dependencies, or show all arrows under Display; red ones land too late."
        controls={<TimelineControls view="alignment" depsToggle extra={<UmbrellaToggles view="alignment" ids={umbrellas} />} />}
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
          groupBy="team"
          mode="packed"
          phaseMode={prefs.phaseMode}
          pxPerDay={prefs.pxPerDay}
          onZoom={(pxPerDay) => setPrefs('alignment', { pxPerDay })}
          colorBy="team"
          showDeps={prefs.showDeps}
          compare={compareState}
          readOnly={readOnly}
          collapsed={prefs.collapsed}
          onToggleGroup={(id) =>
            setPrefs('alignment', { collapsed: prefs.collapsed.includes(id) ? prefs.collapsed.filter((c) => c !== id) : [...prefs.collapsed, id] })
          }
          newItemDefaults={newItemDefaults}
          todayToken={todayToken}
          expanded={prefs.expanded}
          onToggleExpand={(id) =>
            setPrefs('alignment', { expanded: prefs.expanded.includes(id) ? prefs.expanded.filter((e) => e !== id) : [...prefs.expanded, id] })
          }
        />
      </div>
    </div>
  );
}
