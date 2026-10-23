import { useCallback, useMemo } from 'react';
import { partsOf, rollUp } from '../../shared/parts.ts';
import type { Item } from '../../shared/types.ts';
import { FilterButton, SearchField, TimelineControls, UmbrellaToggles, ViewHeader, useTimelineShortcuts } from '../components/Toolbar.tsx';
import { Segmented } from '../components/ui.tsx';
import { groupsFor, partItems, umbrellaItems } from '../lib/model.ts';
import { setPrefs, useApp, useReadOnly, useRoadmap } from '../store.ts';
import { Timeline } from '../timeline/Timeline.tsx';

export function AlignmentView() {
  // Like leadership, alignment shows umbrellas (with their parts' dates); a part's dependencies draw from its umbrella.
  // Under Display it can show the parts instead, each tagged with its umbrella, as the team view does.
  const raw = useRoadmap();
  const state = useMemo(() => rollUp(raw), [raw]);
  const readOnly = useReadOnly();
  const prefs = useApp((s) => s.prefs.alignment);
  const filters = useApp((s) => s.filters);
  const compare = useApp((s) => s.compare);
  const todayToken = useTimelineShortcuts('alignment');

  const items = useMemo(() => (prefs.showParts ? partItems(state, filters) : umbrellaItems(state, filters)), [state, filters, prefs.showParts]);
  const compareState = useMemo(() => (compare ? rollUp(compare.state) : null), [compare]);
  const { groups, groupsOf } = useMemo(() => groupsFor(state, 'team', items), [state, items]);
  const newItemDefaults = useCallback((groupId: string) => ({ teamId: groupId }) as Partial<Item>, []);
  const umbrellas = useMemo(() => items.filter((i) => partsOf(state, i.id).length > 0).map((i) => i.id), [state, items]);

  return (
    <div className="view">
      <ViewHeader
        title="Alignment"
        sub="Every team on one timeline. Open an initiative to see its connections, or show all arrows under Display; red ones land too late."
        controls={
          <TimelineControls
            view="alignment"
            depsToggle
            extra={
              <>
                <div className="display-row is-stacked">
                  <span>Umbrellas</span>
                  <Segmented<'grouped' | 'parts'>
                    label="Umbrellas"
                    size="sm"
                    value={prefs.showParts ? 'parts' : 'grouped'}
                    onChange={(v) => setPrefs('alignment', { showParts: v === 'parts' })}
                    options={[
                      { value: 'grouped', label: 'Grouped', title: 'One bar per umbrella; click it to show its parts' },
                      { value: 'parts', label: 'Parts, tagged', title: 'Every part on its own, tagged with its umbrella, as in the team view' },
                    ]}
                  />
                </div>
                {!prefs.showParts && <UmbrellaToggles view="alignment" ids={umbrellas} label={null} />}
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
          expanded={prefs.showParts ? undefined : prefs.expanded}
          onToggleExpand={
            prefs.showParts
              ? undefined
              : (id) => setPrefs('alignment', { expanded: prefs.expanded.includes(id) ? prefs.expanded.filter((e) => e !== id) : [...prefs.expanded, id] })
          }
        />
      </div>
    </div>
  );
}
