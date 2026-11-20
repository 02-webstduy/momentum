import type { DaySummary, Milestone, MomentumEvent, Project, Stage } from "@/types";
import { evidenceRefOf, eventTitle, eventRepo } from "@/lib/dayFact";
import { buildDayFact } from "@/lib/dayFact";
import { formatCnDate, formatShortDate, daysBetween, dateKeyOf } from "@/lib/date";
import { milestoneCompletion } from "@/lib/progress";
import type { PlanStage } from "@/types";

export interface AgentSummaryPayload {
  narrative: string;
  highlights: string[];
  blockers: string[];
  nextStep: string;
  evidence: { ref: string; kind: string }[];
}

export function buildLocalSummary(
  dateKey: string,
  events: MomentumEvent[],
  stages: Stage[],
  milestones: Milestone[],
): DaySummary {
  const fact = buildDayFact(dateKey, events);
  const dayEvents = events.filter((e) => dateKeyOf(e.ts) === dateKey);
  const commits = dayEvents.filter((e) => e.kind === "commit").length;
  const repos = Array.from(new Set(dayEvents.map(eventRepo).filter((r): r is string => !!r)));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const stageCount = new Map<string, number>();
  for (const e of dayEvents) {
    if (e.stageId) stageCount.set(e.stageId, (stageCount.get(e.stageId) ?? 0) + 1);
  }
  const topStage = Array.from(stageCount.entries()).sort((a, b) => b[1] - a[1])[0];
  const topStageName = topStage ? stageById.get(topStage[0])?.name : undefined;

  const pieces: string[] = [`今天 ${fact.sessions} 个工作段`];
  if (repos.length > 0) pieces.push(`${repos.length} 个仓库`);
  if (commits > 0) pieces.push(`${commits} 次提交`);
  let narrative = `${pieces.join("，")}。`;
  if (topStageName) narrative += `主要在「${topStageName}」推进。`;
  if (narrative.length > 120) narrative = `${narrative.slice(0, 117)}…`;

  const pick = dayEvents
    .filter((e) => e.kind === "commit" || e.kind === "note")
    .slice(0, 3)
    .map((e) => ({ text: truncate(eventTitle(e), 42), ref: evidenceRefOf(e), kind: e.source }));

  const highlights = pick.map((p) => p.text);
  const evidence = pick.map((p) => ({ ref: p.ref, kind: p.kind }));

  const orderedStages = [...stages].sort((a, b) => a.order - b.order);
  let nextStep = "";
  for (const stage of orderedStages) {
    const pending = milestones.find((m) => m.stageId === stage.id && milestoneCompletion(m) < 1);
    if (pending) {
      nextStep = `下一步：推进「${pending.name}」（${stage.name}）。`;
      break;
    }
  }
  if (!nextStep) nextStep = "当前阶段没有未完成的里程碑。";

  return {
    date: dateKey,
    narrative,
    highlights,
    blockers: [],
    nextStep,
    evidence,
    agentRunId: "local:fallback",
    status: "ok",
    generatedAt: new Date().toISOString(),
  };
}

export function buildCheerText(m: Milestone, stage: Stage | undefined, project: Project | undefined): string {
  const stageName = stage?.name ?? "当前阶段";
  const base = `「${stageName}」${m.name.startsWith("完成") ? "" : "完成"}${m.name}`;
  if (m.targetDate && m.achievedAt) {
    const diff = daysBetween(dateKeyOf(m.achievedAt), m.targetDate);
    if (diff > 0) return `${base}，比原计划早 ${diff} 天。`;
    if (diff < 0) return `${base}，比原计划晚 ${Math.abs(diff)} 天。`;
    return `${base}，正好按计划完成。`;
  }
  if (project) return `${base}。项目「${project.name}」又向前推进了一段。`;
  return `${base}。`;
}

export function localDecomposition(): PlanStage[] {
  const stamp = Date.now().toString(36);
  return [
    {
      id: `stage-local-${stamp}-1`,
      name: "需求与原型",
      weight: 3,
      milestones: [
        { id: `ms-local-${stamp}-1`, name: "竞品调研完成", weight: 2, type: "manual", manualState: 0 },
        { id: `ms-local-${stamp}-2`, name: "需求清单定稿", weight: 3, type: "manual", manualState: 0 },
        {
          id: `ms-local-${stamp}-3`,
          name: "累计 10 次提交",
          weight: 2,
          type: "metric",
          metricKey: "commits",
          targetValue: 10,
          manualState: 0,
        },
      ],
    },
    {
      id: `stage-local-${stamp}-2`,
      name: "设计与方案",
      weight: 2,
      milestones: [
        { id: `ms-local-${stamp}-4`, name: "信息架构定稿", weight: 2, type: "manual", manualState: 0 },
        { id: `ms-local-${stamp}-5`, name: "视觉与组件方案", weight: 3, type: "manual", manualState: 0 },
      ],
    },
    {
      id: `stage-local-${stamp}-3`,
      name: "实现与联调",
      weight: 4,
      milestones: [
        {
          id: `ms-local-${stamp}-6`,
          name: "累计 60 次提交",
          weight: 4,
          type: "metric",
          metricKey: "commits",
          targetValue: 60,
          manualState: 0,
        },
        { id: `ms-local-${stamp}-7`, name: "核心流程可用", weight: 3, type: "manual", manualState: 0 },
        { id: `ms-local-${stamp}-8`, name: "完成自测清单", weight: 2, type: "manual", manualState: 0 },
      ],
    },
    {
      id: `stage-local-${stamp}-4`,
      name: "验收与交付",
      weight: 3,
      milestones: [
        { id: `ms-local-${stamp}-9`, name: "验收清单通过", weight: 3, type: "manual", manualState: 0 },
        { id: `ms-local-${stamp}-10`, name: "交付并发布", weight: 2, type: "manual", manualState: 0 },
        {
          id: `ms-local-${stamp}-11`,
          name: "保持 5 天稳定运行",
          weight: 2,
          type: "metric",
          metricKey: "days",
          targetValue: 5,
          manualState: 0,
        },
      ],
    },
  ];
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function planChangeSummary(
  previous: { name: string; weight: number; milestones: number }[],
  next: PlanStage[],
): { name: string; kind: "added" | "removed" | "weight"; fromWeight?: number; toWeight?: number; fromMilestones?: number; toMilestones?: number }[] {
  const changes: ReturnType<typeof planChangeSummary> = [];
  const nextMap = new Map(next.map((s) => [s.name.trim(), s]));
  for (const stage of next) {
    const name = stage.name.trim();
    const before = previous.find((s) => s.name.trim() === name);
    if (!before) {
      changes.push({ name, kind: "added", toWeight: stage.weight, toMilestones: stage.milestones.length });
      continue;
    }
    if (before.weight !== stage.weight) {
      changes.push({
        name,
        kind: "weight",
        fromWeight: before.weight,
        toWeight: stage.weight,
        fromMilestones: before.milestones,
        toMilestones: stage.milestones.length,
      });
    }
  }
  for (const before of previous) {
    if (!nextMap.has(before.name.trim())) {
      changes.push({ name: before.name, kind: "removed", fromWeight: before.weight, fromMilestones: before.milestones });
    }
  }
  return changes;
}

export function summaryHeadline(summary: DaySummary): string {
  return `${formatCnDate(summary.date)} · ${summary.status === "ok" ? "总结" : summary.status === "no_data" ? "无数据" : "生成失败"}`;
}

export function shortDay(dateKey: string): string {
  return formatShortDate(dateKey);
}
