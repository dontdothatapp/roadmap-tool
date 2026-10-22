import { describe, expect, it } from 'vitest';
import { mergeBatch, withFetched } from '../src/client/lib/history.ts';
import type { ChangeRecord } from '../src/shared/types.ts';

const row = (seq: number, entityId = 'a'): ChangeRecord => ({
  seq,
  ts: `2026-10-21T10:00:${String(seq).padStart(2, '0')}.000Z`,
  actor: 'x',
  entity: 'item',
  entityId,
  action: 'update',
  before: null,
  after: null,
  batchId: null,
});
const seqs = (list: ChangeRecord[]) => list.map((c) => c.seq);

describe('history lists following batches', () => {
  it('adds a batch’s rows newest first and drops the rows it folded away', () => {
    const list = [row(5), row(3), row(1)];
    const merged = mergeBatch(list, { changes: [row(6), row(7, 'b')], removedSeqs: [5] }, new Set());
    expect(seqs(merged)).toEqual([7, 6, 3, 1]);
  });

  it('can keep only one initiative’s rows', () => {
    const merged = mergeBatch([row(1)], { changes: [row(2, 'a'), row(3, 'b')], removedSeqs: [] }, new Set(), (c) => c.entityId === 'a');
    expect(seqs(merged)).toEqual([2, 1]);
  });

  it('takes the same batch twice without change, and hands back the same list when nothing changes', () => {
    const batch = { changes: [row(4)], removedSeqs: [2] };
    const once = mergeBatch([row(2), row(1)], batch, new Set());
    expect(mergeBatch(once, batch, new Set())).toBe(once);
    expect(seqs(once)).toEqual([4, 1]);
  });

  it('doesn’t bring back a row that a later batch folded away when the earlier batch shows up late', () => {
    const gone = new Set<number>();
    const first = { changes: [row(10)], removedSeqs: [] };
    const second = { changes: [row(11)], removedSeqs: [10] };
    let list = mergeBatch([row(1)], first, gone);
    second.removedSeqs.forEach((s) => gone.add(s));
    list = mergeBatch(list, second, gone);
    list = mergeBatch(list, first, gone); // the answer to the first request, arriving after the second's live update
    expect(seqs(list)).toEqual([11, 1]);
  });

  it('keeps rows that arrived during a fetch and older pages around the fresh page', () => {
    const held = [row(12), row(9), row(8), row(2), row(1)]; // 12 came in by batch, 2 and 1 are an older page
    const fetched = [row(10), row(9), row(7), row(5)]; // 8 was folded away on the server
    expect(seqs(withFetched(fetched, held, new Set([10])))).toEqual([12, 9, 7, 5, 2, 1]);
    expect(seqs(withFetched([], [row(3)], new Set()))).toEqual([3]);
  });
});
