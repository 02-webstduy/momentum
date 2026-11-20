import type {
  Cheer,
  DaySummary,
  Milestone,
  MomentumEvent,
  PlanStage,
  Project,
  Snapshot,
  Stage,
} from "@/types";
import { emptyMeta } from "@/types";
import { addDays, formatCnDate, parseDateKey, todayKey } from "@/lib/date";
import { decompositionHash } from "@/lib/hash";
import { buildCheerText, buildLocalSummary } from "@/agent/fallback";
import { withAchievedValues } from "@/lib/progress";

const DEMO_PROJECT_ID = "p-demo";
const STAGE_IDS = ["st-demo-1", "st-demo-2", "st-demo-3", "st-demo-4", "st-demo-5"];

function at(today: string, daysAgo: number, hour: number, minute: number): Date {
  const d = parseDateKey(addDays(today, -daysAgo));
  d.setHours(hour, minute, 0, 0);
  return d;
}

function hexId(n: number): string {
  let x = (n * 2654435761) >>> 0;
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out += x.toString(16).padStart(8, "0");
  }
  return out;
}

const COMMIT_MESSAGES = [
  "feat: 进度条阶段刻度",
  "fix: 里程碑重算时机",
  "feat: 分解方案编辑面板",
  "style: 阶段卡片层级",
  "feat: 证据抽屉",
  "refactor: 事件会话合并",
  "feat: 热力图空状态",
  "chore: 本地存储封装",
];

export async function buildDemoSnapshot(): Promise<Snapshot> {
  const today = todayKey();
  const lockedAt = at(today, 20, 10, 30).toISOString();
  const project: Project = {
    id: DEMO_PROJECT_ID,
    name: "Momentum 建站冲刺",
    goal: "六周内上线可用的个人进度追踪站",
    startDate: addDays(today, -21),
    targetDate: addDays(today, 21),
    decompositionFrozen: true,
    decompositionVersion: 1,
    decompositionAt: lockedAt,
  };

  const stageDefs: { name: string; weight: number }[] = [
    { name: "需求与原型", weight: 3 },
    { name: "设计系统", weight: 2 },
    { name: "前端实现", weight: 4 },
    { name: "数据与 AI", weight: 4 },
    { name: "验收与发布", weight: 3 },
  ];

  const stages: Stage[] = stageDefs.map((s, i) => ({
    id: STAGE_IDS[i],
    projectId: DEMO_PROJECT_ID,
    name: s.name,
    weight: s.weight,
    order: i + 1,
    frozenAt: lockedAt,
  }));

  const achievedResearchAt = at(today, 10, 15, 20).toISOString();
  const msDefs: Milestone[] = [
    {
      id: "ms-demo-1",
      stageId: STAGE_IDS[0],
      name: "完成竞品调研",
      weight: 2,
      type: "manual",
      manualState: 1,
      targetDate: addDays(today, -8),
      achievedAt: achievedResearchAt,
    },
    {
      id: "ms-demo-2",
      stageId: STAGE_IDS[0],
      name: "冻结信息架构",
      weight: 3,
      type: "manual",
      manualState: 0,
      targetDate: addDays(today, -4),
    },
    {
      id: "ms-demo-3",
      stageId: STAGE_IDS[0],
      name: "交付 3 版线框",
      weight: 2,
      type: "metric",
      metricKey: "days",
      targetValue: 5,
      targetDate: addDays(today, 3),
      manualState: 0,
    },
    {
      id: "ms-demo-4",
      stageId: STAGE_IDS[1],
      name: "建立色彩与字阶",
      weight: 2,
      type: "manual",
      manualState: 0.5,
    },
    { id: "ms-demo-5", stageId: STAGE_IDS[1], name: "完成组件规范", weight: 3, type: "manual", manualState: 0 },
    { id: "ms-demo-6", stageId: STAGE_IDS[2], name: "完成进度页", weight: 3, type: "manual", manualState: 0.5 },
    { id: "ms-demo-7", stageId: STAGE_IDS[2], name: "完成分解流程", weight: 3, type: "manual", manualState: 0 },
    {
      id: "ms-demo-8",
      stageId: STAGE_IDS[2],
      name: "提交 80 次前端代码",
      weight: 4,
      type: "metric",
      metricKey: "commits",
      targetValue: 80,
      targetDate: addDays(today, 10),
      manualState: 0,
    },
    {
      id: "ms-demo-9",
      stageId: STAGE_IDS[3],
      name: "接入 20 次真实提交",
      weight: 3,
      type: "metric",
      metricKey: "commits",
      targetValue: 20,
      targetDate: addDays(today, 6),
      manualState: 0,
    },
    { id: "ms-demo-10", stageId: STAGE_IDS[3], name: "完成总结卡片", weight: 2, type: "manual", manualState: 0.5 },
    { id: "ms-demo-11", stageId: STAGE_IDS[3], name: "校准进度引擎", weight: 2, type: "manual", manualState: 0 },
    { id: "ms-demo-12", stageId: STAGE_IDS[4], name: "上线发布", weight: 3, type: "manual", manualState: 0 },
  ];

  const events: MomentumEvent[] = [];
  let seq = 0;

  const pushCommit = (daysAgo: number, hour: number, minute: number, stage: number, message: string, repo: string) => {
    seq += 1;
    const d = at(today, daysAgo, hour, minute);
    events.push({
      id: `ev-demo-${seq}`,
      ts: d.toISOString(),
      duration: 0,
      source: "github",
      kind: "commit",
      payload: {
        repo,
        sha: hexId(seq),
        message,
        additions: 18 + ((seq * 13) % 96),
        deletions: 2 + ((seq * 7) % 34),
      },
      projectId: DEMO_PROJECT_ID,
      stageId: STAGE_IDS[stage],
      origin: "auto",
      confidence: 0.9,
    });
  };

  const pushNote = (daysAgo: number, hour: number, minute: number, stage: number, text: string) => {
    seq += 1;
    events.push({
      id: `ev-demo-${seq}`,
      ts: at(today, daysAgo, hour, minute).toISOString(),
      duration: 0,
      source: "manual",
      kind: "note",
      payload: { text, repo: "momentum-docs" },
      projectId: DEMO_PROJECT_ID,
      stageId: STAGE_IDS[stage],
      origin: "user",
      confidence: 1,
    });
  };

  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    if (daysAgo === 4) continue;
    const commitCount = daysAgo >= 8 ? 3 : 6;
    const morning = Math.ceil(commitCount / 2);
    for (let i = 0; i < morning; i += 1) {
      pushCommit(daysAgo, 9, 20 + i * 17, 2, COMMIT_MESSAGES[(daysAgo + i) % COMMIT_MESSAGES.length], i % 2 === 0 ? "momentum-web" : "momentum-docs");
    }
    for (let i = morning; i < commitCount; i += 1) {
      pushCommit(daysAgo, 15, 5 + (i - morning) * 17, 2, COMMIT_MESSAGES[(daysAgo + i + 3) % COMMIT_MESSAGES.length], i % 2 === 0 ? "momentum-web" : "momentum-docs");
    }
    if (daysAgo <= 6) {
      pushCommit(daysAgo, 8, 50, 3, "feat: 事件归因规则", "momentum-api");
      pushCommit(daysAgo, 9, 10, 3, "feat: 总结卡片骨架", "momentum-api");
    }
  }

  for (const daysAgo of [13, 12, 11]) {
    pushNote(daysAgo, 10, 10, 0, "整理竞品调研笔记");
    pushNote(daysAgo, 16, 40, 0, "画第三版线框");
  }
  for (const daysAgo of [10, 9]) {
    pushNote(daysAgo, 11, 0, 1, "调整字阶与颜色梯度");
  }
  pushNote(0, 20, 30, 3, "手动补录：确认验收清单范围");

  const currentMs = withAchievedValues(msDefs, events, null);
  const stage1 = stages[0];
  const cheer: Cheer = {
    milestoneId: "ms-demo-1",
    text: buildCheerText(msDefs[0], stage1, project),
    generatedAt: achievedResearchAt,
    dismissed: false,
  };

  const summaryDates = [today, addDays(today, -2), addDays(today, -6)];
  const summaries: Record<string, DaySummary> = {};
  for (const date of summaryDates) {
    const summary = buildLocalSummary(date, events, stages, currentMs);
    summaries[date] = {
      ...summary,
      agentRunId: "demo:seed",
      generatedAt: at(today, 0, 8, 0).toISOString(),
      narrative: summary.narrative,
    };
  }

  const plan: PlanStage[] = stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    weight: stage.weight,
    milestones: msDefs
      .filter((m) => m.stageId === stage.id)
      .map((m) => ({
        id: m.id,
        name: m.name,
        weight: m.weight,
        type: m.type,
        metricKey: m.metricKey,
        targetValue: m.targetValue,
        targetDate: m.targetDate,
        manualState: m.manualState,
      })),
  }));
  const hash = await decompositionHash(plan);

  return {
    projects: [{ ...project, decompositionHash: hash }],
    stages,
    milestones: msDefs,
    events,
    summaries,
    cheers: { [cheer.milestoneId]: cheer },
    archives: {},
    drafts: {},
    attributions: {},
    meta: {
      ...emptyMeta(),
      demo: true,
      demoLoadedAt: new Date().toISOString(),
      generatedBy: { [DEMO_PROJECT_ID]: "demo" },
    },
  };
}

export const demoProjectLabel = formatCnDate(todayKey());
export const DEMO_ID = DEMO_PROJECT_ID;
