export type DateKey = string;

export interface Project {
  id: string;
  name: string;
  goal: string;
  startDate: string;
  targetDate: string;
  decompositionFrozen: boolean;
  decompositionHash?: string;
  decompositionAt?: string;
  decompositionVersion: number;
}

export interface Stage {
  id: string;
  projectId: string;
  name: string;
  weight: number;
  order: number;
  frozenAt: string;
}

export type MetricKey = "commits" | "sessions" | "days" | "custom";

export interface Milestone {
  id: string;
  stageId: string;
  name: string;
  weight: number;
  type: "metric" | "manual";
  metricKey?: MetricKey;
  targetValue?: number;
  achievedValue?: number;
  targetDate?: string;
  manualState: 0 | 0.5 | 1;
  achievedAt?: string;
  hidden?: boolean;
}

export interface MomentumEvent {
  id: string;
  ts: string;
  duration: number;
  source: "github" | "manual" | "import";
  kind: "commit" | "note" | "activity";
  payload: Record<string, unknown>;
  projectId?: string;
  stageId?: string;
  origin: "auto" | "user";
  confidence: number;
}

export interface DayFact {
  date: string;
  sessions: number;
  activeRepos: number;
  streak: number;
  netChange: number;
  evidenceRefs: string[];
  hasData: boolean;
}

export interface SummaryEvidence {
  ref: string;
  kind: string;
}

export interface DaySummary {
  date: string;
  narrative: string;
  highlights: string[];
  blockers: string[];
  nextStep: string;
  evidence: SummaryEvidence[];
  agentRunId: string;
  status: "ok" | "no_data" | "failed";
  generatedAt: string;
}

export interface Cheer {
  milestoneId: string;
  text: string;
  generatedAt: string;
  dismissed: boolean;
}

export type GeneratedBy = "agent" | "local" | "demo";

export interface PlanMilestone {
  id: string;
  name: string;
  weight: number;
  type: "metric" | "manual";
  metricKey?: MetricKey;
  targetValue?: number;
  targetDate?: string;
  manualState: 0 | 0.5 | 1;
  hidden?: boolean;
}

export interface PlanStage {
  id: string;
  name: string;
  weight: number;
  milestones: PlanMilestone[];
}

export interface PlanChange {
  name: string;
  kind: "added" | "removed" | "weight";
  fromWeight?: number;
  toWeight?: number;
  fromMilestones?: number;
  toMilestones?: number;
}

export interface PlanComparison {
  fromVersion: number;
  createdAt: string;
  changes: PlanChange[];
}

export interface DecompositionDraft {
  projectId: string;
  stages: PlanStage[];
  generatedAt: string;
  generatedBy: GeneratedBy;
  comparison?: PlanComparison;
}

export interface ArchivedVersion {
  projectId: string;
  version: number;
  hash: string;
  lockedAt: string;
  stages: (Stage & { milestones: Milestone[] })[];
}

export interface AttributionOverride {
  projectId: string | null;
  stageId: string | null;
}

export interface Meta {
  demo: boolean;
  demoLoadedAt?: string;
  generatedBy: Record<string, GeneratedBy>;
  cheerEnabled: boolean;
  comparisons: Record<string, PlanComparison>;
}

export interface Snapshot {
  projects: Project[];
  stages: Stage[];
  milestones: Milestone[];
  events: MomentumEvent[];
  summaries: Record<DateKey, DaySummary>;
  cheers: Record<string, Cheer>;
  archives: Record<string, ArchivedVersion[]>;
  drafts: Record<string, DecompositionDraft>;
  attributions: Record<string, AttributionOverride>;
  meta: Meta;
}

export const emptyMeta = (): Meta => ({
  demo: false,
  generatedBy: {},
  cheerEnabled: true,
  comparisons: {},
});
