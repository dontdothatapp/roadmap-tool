import type { AppliedBatch, ChangeRecord } from '../../shared/types.ts';

// Lists of history rows (the History view, an initiative's activity) follow the batches this client applies
// instead of being fetched again after every change. A batch carries the rows it recorded and the rows it
// folded into them (rapid edits by one person become one entry). Own changes arrive twice, as the answer to
// the request and as the live update, in either order, so merging has to be idempotent, and a row once folded
// away must not come back with a late copy of the batch that first added it: `gone` remembers those.

/** A newest-first list with a batch merged in. Returns the same array when the batch adds and removes nothing. */
export function mergeBatch(
  list: ChangeRecord[],
  batch: Pick<AppliedBatch, 'changes' | 'removedSeqs'>,
  gone: ReadonlySet<number>,
  keep: (c: ChangeRecord) => boolean = () => true,
): ChangeRecord[] {
  const have = new Set(list.map((c) => c.seq));
  const added = batch.changes.filter((c) => keep(c) && !have.has(c.seq) && !gone.has(c.seq));
  const removed = new Set(batch.removedSeqs.filter((seq) => have.has(seq)));
  if (added.length === 0 && removed.size === 0) return list;
  return [...added, ...list.filter((c) => !removed.has(c.seq))].sort((a, b) => b.seq - a.seq);
}

/**
 * A freshly fetched newest page, with the rows already held kept around it: newer ones (batches that came in
 * while the request was under way) and older ones (pages loaded before). Rows folded away are left out.
 */
export function withFetched(fetched: ChangeRecord[], list: ChangeRecord[], gone: ReadonlySet<number>): ChangeRecord[] {
  if (fetched.length === 0) return list.filter((c) => !gone.has(c.seq));
  const newest = fetched[0].seq;
  const oldest = fetched[fetched.length - 1].seq;
  return [...list.filter((c) => c.seq > newest), ...fetched, ...list.filter((c) => c.seq < oldest)].filter((c) => !gone.has(c.seq));
}
