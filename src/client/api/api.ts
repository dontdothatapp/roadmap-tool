import type { AppliedBatch, ChangeRecord, Me, Op, PresenceUser, RoadmapState, Snapshot } from '../../shared/types.ts';

export interface Bootstrap {
  state: RoadmapState;
  seq: number;
  /** The roadmap's version on the server: it changes with every batch applied there. */
  version: string;
  me: Me;
  snapshots: Snapshot[];
}

export interface LiveHandlers {
  batch(batch: AppliedBatch): void;
  presence(users: PresenceUser[]): void;
  snapshots(snapshots: Snapshot[]): void;
  reload(): void;
  connection(connected: boolean): void;
  /** The live stream has (re)connected: the roadmap's version on the server now, null if it didn't say. */
  hello(version: string | null): void;
}

export interface ChangeQuery {
  entityId?: string;
  beforeSeq?: number;
  limit?: number;
}

/** Everything the UI needs from a backend. Implemented over HTTP, and in-browser for the demo. */
export interface Api {
  readonly demo: boolean;
  readonly clientId: string;
  bootstrap(): Promise<Bootstrap>;
  submit(ops: Op[]): Promise<AppliedBatch>;
  stateAt(ts: string): Promise<RoadmapState>;
  changes(query: ChangeQuery): Promise<ChangeRecord[]>;
  createSnapshot(name: string, note: string): Promise<Snapshot>;
  deleteSnapshot(id: string): Promise<void>;
  exportData(): Promise<unknown>;
  importData(data: unknown): Promise<number>;
  connect(handlers: LiveHandlers): () => void;
  setName(name: string): void;
  resetDemo?(): void;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
