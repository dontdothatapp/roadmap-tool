import type { RoadmapDiff } from '../../shared/diff.ts';
import { statusLabel, type RoadmapState } from '../../shared/types.ts';
import { openItem, useApp } from '../store.ts';

const FIELD_LABELS: Record<string, string> = {
  title: 'renamed',
  teamId: 'team',
  trackId: 'strategic bet',
  phases: 'dates',
  status: 'status',
  parentId: 'umbrella',
  description: 'description',
  tags: 'tags',
  outcomes: 'expected outcomes',
  dependencies: 'dependencies',
  links: 'links',
  onePagerUrl: 'one-pager',
};

export function CompareSummary({ diff, baseline, onPick }: { diff: RoadmapDiff; baseline: RoadmapState; onPick?: () => void }) {
  const live = useApp((s) => s.live);
  if (diff.items.length === 0) return <div className="cmp-empty">Nothing has changed since then.</div>;
  return (
    <div className="cmp-list">
      {diff.items.map((d) => {
        const team = live.teams[d.item.teamId] ?? baseline.teams[d.item.teamId];
        let what: string;
        if (d.kind === 'added') what = 'Added';
        else if (d.kind === 'removed') what = 'Removed';
        else if (d.slip > 0) what = `Slipped ${d.slip} sprint${d.slip > 1 ? 's' : ''}`;
        else if (d.slip < 0) what = `Pulled in ${-d.slip} sprint${d.slip < -1 ? 's' : ''}`;
        else if (d.statusChange) what = `${statusLabel(d.statusChange.from)} → ${statusLabel(d.statusChange.to)}`;
        else what = `Changed ${d.fieldsChanged.map((f) => FIELD_LABELS[f] ?? f).join(', ')}`;
        const tone = d.kind === 'removed' || d.slip > 0 ? 'bad' : d.kind === 'added' || d.slip < 0 ? 'good' : 'neutral';
        return (
          <button
            key={d.id}
            type="button"
            className={`cmp-row ${d.kind}`}
            disabled={d.kind === 'removed'}
            onClick={() => {
              openItem(d.id);
              onPick?.();
            }}
          >
            <span className="cmp-dot" style={{ background: team?.color ?? '#888' }} />
            <span className="cmp-title">{d.item.title}</span>
            <span className={`cmp-what ${tone}`}>{what}</span>
          </button>
        );
      })}
    </div>
  );
}
