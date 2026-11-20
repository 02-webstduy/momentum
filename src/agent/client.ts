import type { PlanMilestone, PlanStage } from "@/types";
import type { AgentSummaryPayload } from "@/agent/fallback";

const ENDPOINT = "/functions/v1/app";
const BANNED = ["太棒了", "你真厉害", "辛苦", "加油", "厉害了", "真不错", "非常棒"];

export class AgentError extends Error {
  userMessage: string;
  code: string;

  constructor(code: string, userMessage: string) {
    super(userMessage);
    this.name = "AgentError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

function errorForStatus(status: number): AgentError {
  if ([404, 500, 501, 502, 503, 504].includes(status)) {
    return new AgentError("unavailable", "Cloud Agent 未连接（预览环境未启用后端）。");
  }
  if (status === 401 || status === 403) {
    return new AgentError("unauthorized", "Cloud Agent 拒绝访问，请检查站点后端配置。");
  }
  return new AgentError("http", `Cloud Agent 暂时不可用（HTTP ${status}）。`);
}

async function callAgent(action: string, input: unknown, timeoutMs = 9000): Promise<unknown> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AgentError("offline", "当前处于离线状态，Cloud Agent 不可用。");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, input }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AgentError("timeout", "Cloud Agent 响应超时。");
    }
    throw new AgentError("network", "网络不可用，无法连接 Cloud Agent。");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw errorForStatus(response.status);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AgentError("schema", "Cloud Agent 返回的内容无法解析。");
  }
  if (json && typeof json === "object" && "ok" in json && (json as { ok?: boolean }).ok === false) {
    throw new AgentError("agent", "Cloud Agent 未能完成本次生成。");
  }
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function checkTone(text: string): boolean {
  if (/[!！]/.test(text)) return false;
  return !BANNED.some((word) => text.includes(word));
}

export interface AgentSummaryResult {
  payload: AgentSummaryPayload;
  runId: string;
}

export async function requestDaySummary(input: {
  date: string;
  facts: Record<string, unknown>;
  refs: string[];
  incompleteMilestones: string[];
  factsText: string;
}): Promise<AgentSummaryResult> {
  const data = await callAgent("daySummary", {
    date: input.date,
    facts: input.facts,
    factsText: input.factsText,
    rules: [
      "只转述给定 facts，不推测动机，不评价努力程度。",
      "narrative 不超过 120 字。",
      "highlights 每条必须能在 evidence 中找到对应项，最多 5 条。",
      "blockers 没有证据时必须是空数组。",
      "nextStep 只能引用未完成里程碑。",
      "禁用感叹号堆砌与空泛夸奖。",
      "返回 JSON：{narrative, highlights, blockers, nextStep, evidence:[{ref,kind}]}",
    ],
  });
  const record = asRecord(data);
  if (!record) throw new AgentError("schema", "Cloud Agent 返回的内容未通过校验。");

  const narrative = asString(record.narrative);
  const nextStep = asString(record.nextStep);
  const highlights = Array.isArray(record.highlights) ? record.highlights.filter((h): h is string => asString(h) !== null).map((h) => h.trim()) : null;
  const blockersRaw = Array.isArray(record.blockers) ? record.blockers : null;
  const evidenceRaw = Array.isArray(record.evidence) ? record.evidence : null;
  if (!narrative || !nextStep || !highlights || !blockersRaw || !evidenceRaw) {
    throw new AgentError("schema", "Cloud Agent 返回的内容未通过校验。");
  }
  if (Array.from(narrative).length > 120) throw new AgentError("schema", "总结超过 120 字上限。");
  if (highlights.length === 0 || highlights.length > 5) throw new AgentError("schema", "highlights 数量不在 1–5 之间。");
  if (!checkTone(narrative) || !checkTone(nextStep)) throw new AgentError("tone", "总结未通过语气校验。");

  const evidence = evidenceRaw
    .map((item) => {
      const r = asRecord(item);
      const ref = r ? asString(r.ref) : null;
      const kind = r ? asString(r.kind) : null;
      return ref && kind ? { ref, kind } : null;
    })
    .filter((item): item is { ref: string; kind: string } => item !== null);
  if (evidence.length < highlights.length) throw new AgentError("schema", "证据数量不足以支撑 highlights。");
  const refSet = new Set(input.refs);
  if (!evidence.every((item) => refSet.has(item.ref))) {
    throw new AgentError("schema", "证据无法对应到今天的真实事件。");
  }

  const blockers = blockersRaw.filter((b): b is string => asString(b) !== null).map((b) => b.trim());
  if (blockers.length > 0 && evidence.length === 0) {
    throw new AgentError("schema", "blockers 缺少证据。");
  }

  if (input.incompleteMilestones.length > 0 && !input.incompleteMilestones.some((name) => nextStep.includes(name))) {
    throw new AgentError("schema", "nextStep 未引用未完成里程碑。");
  }

  const runId = asString(record._runId) ?? asString(record.runId) ?? `agent:${Date.now()}`;
  return { payload: { narrative, highlights, blockers, nextStep, evidence }, runId };
}

function normalizeMilestone(raw: unknown, stamp: string, stageIndex: number, msIndex: number): PlanMilestone {
  const record = asRecord(raw);
  if (!record) throw new AgentError("schema", "里程碑结构无效。");
  const name = asString(record.name);
  const weight = Number(record.weight);
  const type = record.type === "metric" || record.type === "manual" ? record.type : null;
  if (!name || !type || !Number.isFinite(weight) || weight < 1 || weight > 10) {
    throw new AgentError("schema", "里程碑字段不完整或权重超出 1–10。");
  }
  const id = `ms-ai-${stamp}-${stageIndex}-${msIndex}`;
  if (type === "metric") {
    const metricKey = ["commits", "sessions", "days", "custom"].includes(String(record.metricKey))
      ? (record.metricKey as PlanMilestone["metricKey"])
      : null;
    const targetValue = Number(record.targetValue);
    if (!metricKey || !Number.isFinite(targetValue) || targetValue <= 0) {
      throw new AgentError("schema", "metric 型里程碑缺少有效指标。");
    }
    return { id, name, weight, type, metricKey, targetValue, manualState: 0 };
  }
  return { id, name, weight, type, manualState: 0 };
}

function validatePlan(raw: unknown): PlanStage[] {
  const record = asRecord(raw);
  const stages = record && Array.isArray(record.stages) ? record.stages : null;
  if (!stages || stages.length < 4 || stages.length > 7) {
    throw new AgentError("schema", "分解方案需要 4–7 个阶段。");
  }
  const stamp = Date.now().toString(36);
  let metricCount = 0;
  let manualCount = 0;
  const out: PlanStage[] = [];

  stages.forEach((stageRaw, index) => {
    const stage = asRecord(stageRaw);
    const name = stage ? asString(stage.name) : null;
    const weight = stage ? Number(stage.weight) : NaN;
    const msRaw = stage && Array.isArray(stage.milestones) ? stage.milestones : null;
    if (!name || !Number.isFinite(weight) || weight < 1 || weight > 10 || !msRaw || msRaw.length < 2 || msRaw.length > 4) {
      throw new AgentError("schema", "每个阶段需要 2–4 个里程碑，权重需在 1–10 之间。");
    }
    const milestones = msRaw.map((m, msIndex) => {
      const normalized = normalizeMilestone(m, stamp, index, msIndex);
      if (normalized.type === "metric") metricCount += 1;
      else manualCount += 1;
      return normalized;
    });
    out.push({ id: `stage-ai-${stamp}-${index}`, name, weight, milestones });
  });

  if (metricCount === 0 || manualCount === 0) {
    throw new AgentError("schema", "分解方案需要同时包含 metric 型与 manual 型里程碑。");
  }
  return out;
}

export async function requestDecomposition(input: {
  name: string;
  goal: string;
  startDate: string;
  targetDate: string;
}): Promise<PlanStage[]> {
  const data = await callAgent("decompose", {
    project: input,
    rules: [
      "生成 4–7 个阶段，每个阶段 2–4 个里程碑。",
      "阶段与里程碑 weight 取 1–10 的整数。",
      "metric 型必须给出 metricKey（commits|sessions|days|custom）与 targetValue；需与 manual 型混合。",
      "返回 JSON：{stages:[{name,weight,milestones:[{name,weight,type,metricKey?,targetValue?}]}]}",
    ],
  });
  return validatePlan(data);
}
