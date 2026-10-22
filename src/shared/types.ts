// Domain model shared by the server, the browser client and the in-browser demo.

export type ID = string;
/** Calendar date, `YYYY-MM-DD`. */
export type ISODate = string;

export const PHASES = ['discovery', 'ux', 'implementation'] as const;
export type PhaseKey = (typeof PHASES)[number];

export const PHASE_LABELS: Record<PhaseKey, string> = {
  discovery: 'Discovery',
  ux: 'UX',
  implementation: 'Implementation',
};

/** A date range. `end` is exclusive: a sprint starting Oct 8 and lasting two weeks is `{start: '…-10-08', end: '…-10-22'}`. */
export interface Span {
  start: ISODate;
  end: ISODate;
}

/** The roadmap itself says where work stands; an initiative is only flagged when it's done or at risk. */
export const STATUSES = ['planned', 'at_risk', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  planned: 'On track',
  at_risk: 'At risk',
  done: 'Done',
};

/** Labels for every status ever stored, including ones from earlier versions (they now read as on track). */
export function statusLabel(status: string): string {
  const legacy: Record<string, string> = { idea: 'Idea', in_progress: 'In progress' };
  return STATUS_LABELS[status as Status] ?? legacy[status] ?? status;
}

export interface Link {
  id: ID;
  label: string;
  url: string;
}

export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const IMPACT_UNITS = ['%', 'pp', 'abs'] as const;
export type ImpactUnit = (typeof IMPACT_UNITS)[number];

export const IMPACT_UNIT_LABELS: Record<ImpactUnit, string> = {
  '%': '% relative',
  pp: 'pp (percentage points)',
  abs: 'absolute',
};

export interface Outcome {
  id: ID;
  /** Funnel stage id from settings: the stage is the metric. */
  stageId: ID;
  /** No longer edited (the funnel stage is the metric); kept for outcomes written by earlier versions. */
  metric: string;
  impact: number | null;
  unit: ImpactUnit;
  /** No longer edited or weighed; kept for outcomes written by earlier versions. */
  confidence: Confidence;
  /** First day of the month the impact starts to show. `null` means "the month implementation ends". */
  landsBy: ISODate | null;
  /**
   * Ramp-up: the share of the full impact (0–100) in the landing month and each month after it, e.g. [50, 85]
   * for 50% in the landing month and 85% the next. Full impact after the last one; empty means full from the start.
   */
  ramp: number[];
  note: string;
}

export const DEPENDENCY_STATUSES = ['open', 'agreed', 'done'] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export const DEPENDENCY_STATUS_LABELS: Record<DependencyStatus, string> = {
  open: 'Not agreed yet',
  agreed: 'Agreed',
  done: 'Delivered',
};

/** "This item needs something from …" — either a specific roadmap item, or a team when the work isn't on their roadmap yet. */
export interface Dependency {
  id: ID;
  itemId: ID | null;
  teamId: ID | null;
  note: string;
  status: DependencyStatus;
}

export interface Item {
  id: ID;
  title: string;
  teamId: ID;
  trackId: ID | null;
  tags: string[];
  status: Status;
  /** Key initiatives are highlighted for leadership. */
  key: boolean;
  owner: string;
  description: string;
  phases: Partial<Record<PhaseKey, Span>>;
  onePagerUrl: string;
  links: Link[];
  outcomes: Outcome[];
  dependencies: Dependency[];
  /** Manual ordering within a lane (fractional, so reordering touches a single item). */
  order: number;
  /** Row on its team's board in the team view; several initiatives can share one. Null until placed. */
  row: number | null;
  /** Two rows high on the timeline, with room for a long name. */
  tall: boolean;
  /**
   * The initiative this is a part of (one level only). The umbrella holds the shared title, outcome and one-pager;
   * its dates come from its parts. Leadership sees the umbrella, the team plans the parts.
   */
  parentId: ID | null;
  /**
   * Its pastel colour on the team board (an id from BOARD_COLORS); null for the default. An umbrella's colour is
   * worn by all its parts.
   */
  color: string | null;
}

export interface Team {
  id: ID;
  name: string;
  color: string;
  order: number;
  archived: boolean;
  /** The team's EPD owners, who own everything on its roadmap. */
  pm: string;
  em: string;
  ux: string;
}

/** A strategic bet (called a track in the code and the stored data). */
export interface Track {
  id: ID;
  name: string;
  color: string;
  order: number;
  description: string;
  /** Has a view of its own in the sidebar: a row per umbrella (or initiative), names on the left. */
  ownView: boolean;
}

export interface FunnelStage {
  id: ID;
  name: string;
  color: string;
}

export interface SprintPatternEntry {
  weeks: number;
  /** Full name, e.g. "Sprint" or "Brilliant Basics". */
  label: string;
  /** Prefix for the sprint code, e.g. "W" → "W42". */
  short: string;
  /** Shade this sprint type on the timeline. */
  highlight: boolean;
}

export type SprintNaming = 'week' | 'sequence';

export interface SprintSettings {
  /** Start of a cadence cycle (the first pattern entry). Every later or earlier sprint is derived from it. */
  anchor: ISODate;
  pattern: SprintPatternEntry[];
  /** `week`: sprints are named after the ISO week they start in ("W42"); `sequence`: numbered one after another ("S25"). */
  naming: SprintNaming;
  /** With `sequence` naming, the number of the sprint that starts on the anchor date. */
  firstNumber: number;
}

export interface Settings {
  id: 'settings';
  name: string;
  sprints: SprintSettings;
  /** 1 = January. */
  fiscalYearStartMonth: number;
  funnelStages: FunnelStage[];
}

export interface RoadmapState {
  settings: Settings;
  teams: Record<ID, Team>;
  tracks: Record<ID, Track>;
  items: Record<ID, Item>;
}

export type EntityType = 'item' | 'team' | 'track' | 'settings';
export type Entity = Item | Team | Track | Settings;

export type Op =
  | { kind: 'create'; entity: EntityType; id: ID; data: Record<string, unknown> }
  | { kind: 'update'; entity: EntityType; id: ID; patch: Record<string, unknown> }
  | { kind: 'delete'; entity: EntityType; id: ID };

export type ChangeAction = 'create' | 'update' | 'delete';

/** One row of history: the full entity before and after a change. */
export interface ChangeRecord {
  seq: number;
  ts: string;
  actor: string;
  entity: EntityType;
  entityId: ID;
  action: ChangeAction;
  before: Entity | null;
  after: Entity | null;
  /** Set when several entities changed together in one action (e.g. deleting an item also cleans up dependencies). */
  batchId: string | null;
}

export type NewChange = Omit<ChangeRecord, 'seq'>;

/** A named point in time. The roadmap at that moment is rebuilt from history. */
export interface Snapshot {
  id: ID;
  name: string;
  note: string;
  ts: string;
  actor: string;
}

export interface EntityUpdate {
  entity: EntityType;
  id: ID;
  value: Entity | null;
}

/** The result of submitting ops, also broadcast to every connected client. */
export interface AppliedBatch {
  updates: EntityUpdate[];
  changes: ChangeRecord[];
  /** History rows that were merged into a newer row (rapid edits by one person collapse into one entry). */
  removedSeqs: number[];
  clientId: string | null;
  /** The roadmap's version once this batch is applied; set on batches sent over the live stream. */
  version?: string;
}

export interface PresenceUser {
  clientId: string;
  name: string;
}

export interface Me {
  name: string;
  /** True when identity comes from the company's SSO proxy and can't be changed in the app. */
  managed: boolean;
}
