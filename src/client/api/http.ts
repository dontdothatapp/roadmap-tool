import type { AppliedBatch, ChangeRecord, Op, RoadmapState, Snapshot } from '../../shared/types.ts';
import { uid } from '../../shared/util.ts';
import { ApiError, type Api, type Bootstrap, type ChangeQuery, type LiveHandlers } from './api.ts';

// Paths are relative so the app also works behind a proxy under a sub-path (e.g. /roadmap/).
export class HttpApi implements Api {
  readonly demo = false;
  readonly clientId = uid(12);
  private name = '';
  private reconnect: (() => void) | null = null;

  setName(name: string): void {
    const changed = name !== this.name;
    this.name = name;
    if (changed) this.reconnect?.();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Name': encodeURIComponent(this.name),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ApiError('Can’t reach the server. Check your connection and try again.', 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
    return body as T;
  }

  bootstrap(): Promise<Bootstrap> {
    return this.request<Bootstrap>('api/bootstrap');
  }

  submit(ops: Op[]): Promise<AppliedBatch> {
    return this.request<AppliedBatch>('api/ops', { method: 'POST', body: JSON.stringify({ ops, clientId: this.clientId }) });
  }

  async stateAt(ts: string): Promise<RoadmapState> {
    const body = await this.request<{ state: RoadmapState }>(`api/state?at=${encodeURIComponent(ts)}`);
    return body.state;
  }

  async changes(q: ChangeQuery): Promise<ChangeRecord[]> {
    const params = new URLSearchParams();
    if (q.entityId) params.set('entityId', q.entityId);
    if (q.beforeSeq) params.set('beforeSeq', String(q.beforeSeq));
    if (q.limit) params.set('limit', String(q.limit));
    const body = await this.request<{ changes: ChangeRecord[] }>(`api/changes?${params}`);
    return body.changes;
  }

  async createSnapshot(name: string, note: string): Promise<Snapshot> {
    const body = await this.request<{ snapshot: Snapshot }>('api/snapshots', { method: 'POST', body: JSON.stringify({ name, note }) });
    return body.snapshot;
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.request(`api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  exportData(): Promise<unknown> {
    return this.request('api/export');
  }

  async importData(data: unknown): Promise<number> {
    const body = await this.request<{ changed: number }>('api/import', { method: 'POST', body: JSON.stringify(data) });
    return body.changed;
  }

  connect(handlers: LiveHandlers): () => void {
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    const open = () => {
      if (retry) clearTimeout(retry);
      retry = null;
      source?.close();
      const params = new URLSearchParams({ clientId: this.clientId, name: this.name });
      const es = new EventSource(`api/events?${params}`);
      source = es;
      es.addEventListener('open', () => {
        backoff = 1000;
        handlers.connection(true);
      });
      es.addEventListener('error', () => {
        handlers.connection(false);
        // The browser retries dropped connections itself, but gives up for good on an HTTP error
        // (e.g. a proxy's 502 during a deploy, or an expired sign-in). Keep trying, more slowly each time.
        if (es.readyState === EventSource.CLOSED && !closed && source === es) {
          retry = setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, 30_000);
        }
      });
      es.addEventListener('hello', (e) => {
        handlers.connection(true);
        handlers.hello((JSON.parse((e as MessageEvent).data) as { version?: string }).version ?? null);
      });
      es.addEventListener('batch', (e) => handlers.batch(JSON.parse((e as MessageEvent).data)));
      es.addEventListener('presence', (e) => handlers.presence(JSON.parse((e as MessageEvent).data).users));
      es.addEventListener('snapshots', (e) => handlers.snapshots(JSON.parse((e as MessageEvent).data).snapshots));
      es.addEventListener('reload', () => handlers.reload());
    };
    this.reconnect = () => {
      if (!closed) open();
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }
}
