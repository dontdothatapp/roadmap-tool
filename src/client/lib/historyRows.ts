import { useEffect, useRef, useState } from 'react';
import type { ChangeRecord, ID } from '../../shared/types.ts';
import { api, useApp } from '../store.ts';
import { mergeBatch, withFetched } from './history.ts';

/**
 * The newest history rows (all of them, or one initiative's), fetched once and then kept current with the batches
 * this client applies, so an open History view or drawer costs no request per change. Fetched again only when
 * history changed in a way no batch describes (a reconnect, an import). Give the component a `key` per initiative
 * rather than changing `entityId` under it.
 */
export function useHistoryRows(opts: { entityId?: ID; limit: number; keep?: (c: ChangeRecord) => boolean }) {
  const { entityId, limit } = opts;
  const keepRef = useRef(opts.keep);
  keepRef.current = opts.keep;
  const [rows, setRows] = useState<ChangeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [reloads, setReloads] = useState(0);
  // Rows folded into a newer one: a late copy of the batch that added them must not bring them back.
  const gone = useRef(new Set<number>());

  // Every change of the history version as it happens, rather than once per render: one render can cover
  // several (the demo answers a request and sends its live update in the same moment).
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (s.historyVersion === prev.historyVersion) return;
        const batch = s.lastBatch;
        if (!batch) {
          setReloads((n) => n + 1);
          return;
        }
        for (const seq of batch.removedSeqs) gone.current.add(seq);
        setRows((list) => mergeBatch(list, batch, gone.current, keepRef.current));
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    api.changes({ entityId, limit }).then(
      (fetched) => {
        if (cancelled) return;
        const keep = keepRef.current;
        setRows((list) => withFetched(keep ? fetched.filter(keep) : fetched, list, gone.current));
        setMore(fetched.length === limit);
        setLoading(false);
      },
      () => !cancelled && setLoading(false),
    );
    return () => {
      cancelled = true;
    };
  }, [entityId, limit, reloads]);

  const loadOlder = async () => {
    const oldest = rows.at(-1)?.seq;
    if (!oldest) return;
    const older = await api.changes({ entityId, limit, beforeSeq: oldest });
    const keep = keepRef.current;
    setRows((list) => {
      const last = list.at(-1)?.seq ?? Infinity;
      return [...list, ...older.filter((c) => c.seq < last && !gone.current.has(c.seq) && (!keep || keep(c)))];
    });
    setMore(older.length === limit);
  };

  return { rows, loading, more, loadOlder };
}
