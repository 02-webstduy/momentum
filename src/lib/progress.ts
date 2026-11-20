import type { Milestone, MomentumEvent, Project, Stage } from "@/types";
import { dateKeyOf } from "@/lib/date";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function milestoneCompletion(m: Milestone): number {
  if (m.type === "manual") return m.manualState;
  if (!m.targetValue || m.targetValue <= 0) return 0;
  return clamp01((m.achievedValue ?? 0) / m.targetValue);
}

export function stageCompletion(stage: Stage, milestones: Milestone[]): number {
  const active = milestones.filter((m) => m.stageId === stage.id);
  const totalW = sum(active.map((m) => m.weight));
  if (totalW === 0) return 0;
  return sum(active.map((m) => m.weight * milestoneCompletion(m))) / totalW;
}

export function projectProgress(p: Project, stages: Stage[], ms: Milestone[]): number {
  const ss = stages.filter((s) => s.projectId === p.id);
  const totalW = sum(ss.map((s) => s.weight));
  if (totalW === 0) return 0;
  return sum(ss.map((s) => s.weight * stageCompletion(s, ms))) / totalW;
}

export function expectedProgress(p: Project, now = new Date()): number | null {
  const t0 = new Date(p.startDate).getTime();
  const t1 = new Date(p.targetDate).getTime();
  if (!t1 || t1 <= t0) return null;
  return clamp01((now.getTime() - t0) / (t1 - t0));
}

export type HealthState = "ahead" | "behind" | "on" | "unknown";

export interface Health {
  state: HealthState;
  delta: number | null;
}

export function healthOf(progress: number, expected: number | null): Health {
  if (expected === null || Number.isNaN(expected)) return { state: "unknown", delta: null };
  const delta = progress - expected;
  if (delta > 0.05) return { state: "ahead", delta };
  if (delta < -0.05) return { state: "behind", delta };
  return { state: "on", delta };
}

export const healthLabel = (state: HealthState): string =>
  state === "ahead" ? "超前" : state === "behind" ? "滞后" : state === "on" ? "正常" : "—";

export function hasNoMilestones(stage: Stage, milestones: Milestone[]): boolean {
  return milestones.filter((m) => m.stageId === stage.id).length === 0;
}

export function allWeightsZero(stages: Stage[]): boolean {
  return sum(stages.map((s) => s.weight)) === 0;
}

export function effectiveEvents(events: MomentumEvent[], at: number | null): MomentumEvent[] {
  if (at === null) return events;
  return events.filter((e) => new Date(e.ts).getTime() <= at);
}

export function mergeSessions(events: MomentumEvent[], gapMs = 30 * 60 * 1000): number {
  if (events.length === 0) return 0;
  const times = events.map((e) => new Date(e.ts).getTime()).sort((a, b) => a - b);
  let sessions = 1;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] - times[i - 1] > gapMs) sessions += 1;
  }
  return sessions;
}

export function metricProgressValue(m: Milestone, scoped: MomentumEvent[]): number {
  const key = m.metricKey ?? "commits";
  if (key === "commits") return scoped.filter((e) => e.kind === "commit").length;
  if (key === "sessions") return mergeSessions(scoped);
  if (key === "days") return new Set(scoped.map((e) => dateKeyOf(e.ts))).size;
  return scoped.length;
}

export function computeAchieved(
  milestones: Milestone[],
  events: MomentumEvent[],
  at: number | null = null,
): Map<string, number> {
  const scopedEvents = effectiveEvents(events, at);
  const out = new Map<string, number>();
  for (const m of milestones) {
    if (m.type !== "metric") continue;
    const scoped = scopedEvents.filter((e) => e.stageId === m.stageId);
    out.set(m.id, metricProgressValue(m, scoped));
  }
  return out;
}

export function withAchievedValues(
  milestones: Milestone[],
  events: MomentumEvent[],
  at: number | null = null,
): Milestone[] {
  const achieved = computeAchieved(milestones, events, at);
  return milestones.map((m) =>
    m.type === "metric" ? { ...m, achievedValue: achieved.get(m.id) ?? 0 } : m,
  );
}

export interface ProgressSet {
  progress: number;
  expected: number | null;
  health: Health;
  trend: number | null;
  stageValues: Record<string, number>;
  stageHasMilestones: Record<string, boolean>;
  noWeights: boolean;
}

export function computeProgressSet(
  project: Project,
  stages: Stage[],
  milestones: Milestone[],
  events: MomentumEvent[],
  now = new Date(),
): ProgressSet {
  const ss = stages.filter((s) => s.projectId === project.id);
  const nowMs = now.getTime();
  const current = withAchievedValues(milestones, events, null);
  const weekAgo = withAchievedValues(milestones, events, nowMs - 7 * 86_400_000);
  const progress = projectProgress(project, ss, current);
  const previous = projectProgress(project, ss, weekAgo);
  const expected = expectedProgress(project, now);
  const stageValues: Record<string, number> = {};
  const stageHas: Record<string, boolean> = {};
  for (const stage of ss) {
    const ms = current.filter((m) => m.stageId === stage.id);
    stageHas[stage.id] = ms.length > 0;
    stageValues[stage.id] = stageCompletion(stage, ms);
  }
  return {
    progress,
    expected,
    health: healthOf(progress, expected),
    trend: progress - previous,
    stageValues,
    stageHasMilestones: stageHas,
    noWeights: allWeightsZero(ss),
  };
}

export function firstAchievedAt(m: Milestone, events: MomentumEvent[]): string | null {
  if (m.type !== "metric" || !m.targetValue || m.targetValue <= 0) return null;
  const scoped = events
    .filter((e) => e.stageId === m.stageId)
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const seenDays = new Set<string>();
  let seenSessions = 0;
  let lastTs = 0;
  let count = 0;
  for (const e of scoped) {
    if (m.metricKey === "commits") {
      if (e.kind === "commit") count += 1;
    } else if (m.metricKey === "days") {
      seenDays.add(dateKeyOf(e.ts));
      count = seenDays.size;
    } else if (m.metricKey === "sessions") {
      const t = new Date(e.ts).getTime();
      if (lastTs === 0 || t - lastTs > 30 * 60 * 1000) seenSessions += 1;
      lastTs = t;
      count = seenSessions;
    } else {
      count += 1;
    }
    if (count >= m.targetValue) return e.ts;
  }
  return null;
}

export function milestoneRemainingLabel(m: Milestone): string {
  if (m.achievedAt) return "已达成";
  if (m.type === "manual") {
    return m.manualState === 0.5 ? "进行中，待完成" : "手工确认";
  }
  const target = m.targetValue ?? 0;
  const done = m.achievedValue ?? 0;
  const left = Math.max(0, target - done);
  const unit =
    m.metricKey === "commits"
      ? "次提交"
      : m.metricKey === "sessions"
        ? "个工作段"
        : m.metricKey === "days"
          ? "天"
          : "个事件";
  return `还差 ${left} ${unit}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDelta(value: number): string {
  const v = value * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} 个百分点`;
}

export type TrendState = "up" | "flat" | "down";

export function trendState(trend: number | null): TrendState {
  if (trend === null) return "flat";
  if (trend > 0.005) return "up";
  if (trend < -0.005) return "down";
  return "flat";
}
