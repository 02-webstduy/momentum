import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  ArchivedVersion,
  GeneratedBy,
  MetricKey,
  PlanComparison,
  PlanMilestone,
  PlanStage,
  Project,
} from "@/types";
import { useMomentum } from "@/store/state";
import { Link } from "@/router";
import {
  addDays,
  daysBetween,
  formatCnDate,
  formatShortDate,
  isValidDateKey,
  todayKey,
} from "@/lib/date";
import { localDecomposition, planChangeSummary } from "@/agent/fallback";
import { AgentError, requestDecomposition } from "@/agent/client";
import {
  CheckIcon,
  DemoBadge,
  Dialog,
  LockIcon,
  Notice,
  Spinner,
  TrashIcon,
} from "@/components/ui";

type Mode = "form" | "generate" | "edit" | "locked";

interface ProjectForm {
  name: string;
  goal: string;
  startDate: string;
  targetDate: string;
}

const STEPS = ["填写目标", "生成方案", "编辑并锁定"];

const METRIC_OPTIONS: { key: MetricKey; label: string }[] = [
  { key: "commits", label: "提交次数" },
  { key: "sessions", label: "有效工作段" },
  { key: "days", label: "活跃天数" },
  { key: "custom", label: "事件数量" },
];

const emptyForm = (): ProjectForm => ({
  name: "",
  goal: "",
  startDate: todayKey(),
  targetDate: addDays(todayKey(), 30),
});

const newPlanId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function validatePlan(plan: PlanStage[]): string[] {
  const issues: string[] = [];
  if (plan.length < 4 || plan.length > 7) {
    issues.push(`阶段数需要 4–7 个，当前 ${plan.length} 个。`);
  }
  let metricCount = 0;
  let manualCount = 0;
  plan.forEach((stage, stageIndex) => {
    const stageName = stage.name.trim();
    const stageLabel = stageName ? `「${stageName}」` : `第 ${stageIndex + 1} 个阶段`;
    if (!stageName) issues.push(`第 ${stageIndex + 1} 个阶段还没有名称。`);
    if (!Number.isInteger(stage.weight) || stage.weight < 1 || stage.weight > 10) {
      issues.push(`${stageLabel}的权重需要是 1–10 的整数。`);
    }
    if (stage.milestones.length < 2 || stage.milestones.length > 4) {
      issues.push(`${stageLabel}需要 2–4 个里程碑，当前 ${stage.milestones.length} 个。`);
    }
    stage.milestones.forEach((m, msIndex) => {
      const msName = m.name.trim();
      const msLabel = msName ? `「${msName}」` : `${stageLabel}第 ${msIndex + 1} 个里程碑`;
      if (!msName) issues.push(`${stageLabel}第 ${msIndex + 1} 个里程碑还没有名称。`);
      if (!Number.isInteger(m.weight) || m.weight < 1 || m.weight > 10) {
        issues.push(`${msLabel}的权重需要是 1–10 的整数。`);
      }
      if (m.type === "metric") {
        metricCount += 1;
        if (!m.metricKey) issues.push(`${msLabel}还没有选择自动指标。`);
        if (!m.targetValue || m.targetValue <= 0) {
          issues.push(`${msLabel}需要设置大于 0 的目标值。`);
        }
      } else {
        manualCount += 1;
      }
    });
  });
  if (metricCount === 0) issues.push("至少需要一个自动型（metric）里程碑。");
  if (manualCount === 0) issues.push("至少需要一个手动型（manual）里程碑。");
  return issues;
}

function generatedSentence(by?: GeneratedBy): string {
  if (by === "local") return "本方案由本地模板";
  if (by === "demo") return "演示方案由 AI";
  return "本方案由 AI";
}

function sourceLabel(by?: GeneratedBy): string {
  if (by === "agent") return "Cloud Agent 生成";
  if (by === "local") return "本地模板生成";
  return "演示方案";
}

function ComparisonPanel({
  comparison,
  title,
}: {
  comparison: PlanComparison;
  title: string;
}) {
  return (
    <div className="compare">
      <div className="row-between" style={{ marginBottom: 6 }}>
        <p className="h3">{title}</p>
        <span className="hint">生成于 {formatCnDate(comparison.createdAt.slice(0, 10))}</span>
      </div>
      {comparison.changes.length === 0 ? (
        <p className="hint">阶段名称与权重没有变化。</p>
      ) : (
        comparison.changes.map((change, index) => (
          <div className="compare-row" key={`${change.name}-${index}`}>
            <span className={`change-${change.kind}`}>
              {change.kind === "added"
                ? `新增阶段「${change.name}」`
                : change.kind === "removed"
                  ? `移除阶段「${change.name}」`
                  : `「${change.name}」权重 ${change.fromWeight} → ${change.toWeight}`}
            </span>
            <span className="hint tabular">
              {change.kind === "added"
                ? `权重 ${change.toWeight} · ${change.toMilestones ?? 0} 个里程碑`
                : change.kind === "removed"
                  ? `原权重 ${change.fromWeight} · ${change.fromMilestones ?? 0} 个里程碑`
                  : `里程碑 ${change.fromMilestones ?? 0} → ${change.toMilestones ?? 0}`}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function StepBar({ mode }: { mode: Mode }) {
  const stepIndex = mode === "form" ? 0 : mode === "generate" ? 1 : 2;
  const allDone = mode === "locked";
  return (
    <div className="step" aria-label="分解步骤">
      {STEPS.map((label, index) => {
        const state = allDone ? "done" : index < stepIndex ? "done" : index === stepIndex ? "active" : "todo";
        return (
          <Fragment key={label}>
            {index > 0 ? <span className="step-line" aria-hidden="true" /> : null}
            <span className="step-item" data-state={state}>
              <span className="step-dot">{state === "done" ? <CheckIcon size={11} /> : index + 1}</span>
              {label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

export function DecomposePage() {
  const {
    snap,
    ready,
    activeProject,
    projectStages,
    projectMilestones,
    createProject,
    updateProject,
    saveDraft,
    lockPlan,
    notify,
  } = useMomentum();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [savingForm, setSavingForm] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);

  const [plan, setPlan] = useState<PlanStage[] | null>(null);
  const [locking, setLocking] = useState(false);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoAck, setRedoAck] = useState(false);

  const project: Project | null = useMemo(() => {
    if (!snap) return null;
    if (creating) return null;
    if (selectedId) return snap.projects.find((p) => p.id === selectedId) ?? activeProject;
    return activeProject;
  }, [snap, creating, selectedId, activeProject]);

  const draft = project ? snap?.drafts[project.id] : undefined;
  const draftKey = draft ? `${draft.projectId}:${draft.generatedAt}` : null;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const mode: Mode = !project
    ? "form"
    : editingProject
      ? "form"
      : project.decompositionFrozen && !draft
        ? "locked"
        : draft
          ? "edit"
          : "generate";

  useEffect(() => {
    setPlan(draft ? draft.stages : null);
  }, [draftKey]);

  useEffect(() => {
    if (!plan || !project) return;
    const current = draftRef.current;
    if (!current) return;
    if (JSON.stringify(current.stages) === JSON.stringify(plan)) return;
    const timer = window.setTimeout(() => {
      const latest = draftRef.current;
      if (!latest) return;
      void saveDraft({ ...latest, stages: plan });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [plan, project, saveDraft]);

  const issues = useMemo(() => (plan ? validatePlan(plan) : []), [plan]);
  const planStats = useMemo(() => {
    if (!plan) return { milestones: 0, metric: 0, manual: 0, weight: 0 };
    let milestones = 0;
    let metric = 0;
    let manual = 0;
    let weight = 0;
    for (const stage of plan) {
      milestones += stage.milestones.length;
      weight += stage.weight;
      for (const m of stage.milestones) {
        if (m.type === "metric") metric += 1;
        else manual += 1;
      }
    }
    return { milestones, metric, manual, weight };
  }, [plan]);

  if (!ready || !snap) {
    return (
      <div className="card card-pad">
        <div className="skeleton skeleton-line" style={{ width: "50%" }} />
        <div className="skeleton skeleton-line" style={{ width: "70%" }} />
      </div>
    );
  }

  const archives = project ? snap.archives[project.id] ?? [] : [];
  const generatedBy = project ? snap.meta.generatedBy[project.id] : undefined;
  const lockedComparison = project ? snap.meta.comparisons[project.id] : undefined;
  const lockedStages = project ? projectStages(project.id) : [];
  const lockedMilestones = project ? projectMilestones(project.id) : [];
  const nextVersion = project ? project.decompositionVersion + (project.decompositionFrozen ? 1 : 0) : 1;

  const startNew = () => {
    setCreating(true);
    setSelectedId(null);
    setEditingProject(false);
    setForm(emptyForm());
    setAgentMessage(null);
  };

  const startEditProject = () => {
    if (!project) return;
    setForm({
      name: project.name,
      goal: project.goal,
      startDate: project.startDate,
      targetDate: project.targetDate,
    });
    setEditingProject(true);
  };

  const cancelEditProject = () => {
    if (project) setEditingProject(false);
    else {
      setCreating(false);
      setEditingProject(false);
    }
  };

  const saveProjectForm = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const goal = form.goal.trim();
    if (!name || !goal) {
      notify("请填写项目名和目标一句话。", "error");
      return;
    }
    if (!isValidDateKey(form.startDate) || !isValidDateKey(form.targetDate)) {
      notify("日期格式不正确。", "error");
      return;
    }
    if (daysBetween(form.startDate, form.targetDate) <= 0) {
      notify("结束日需要晚于开始日。", "error");
      return;
    }
    setSavingForm(true);
    try {
      if (project && editingProject) {
        await updateProject(project.id, { name, goal, startDate: form.startDate, targetDate: form.targetDate });
        notify("项目信息已更新。", "success");
      } else {
        const id = await createProject({ name, goal, startDate: form.startDate, targetDate: form.targetDate });
        setSelectedId(id);
        setCreating(false);
        notify("项目已保存，下一步生成分解方案。", "success");
      }
      setEditingProject(false);
    } catch {
      notify("保存失败，请重试。", "error");
    } finally {
      setSavingForm(false);
    }
  };

  const runDecomposition = async (target: Project, redo: boolean) => {
    if (generating) return;
    setGenerating(true);
    setAgentMessage(null);
    try {
      const now = new Date().toISOString();
      let stages: PlanStage[];
      let by: GeneratedBy;
      let message: string | null = null;
      try {
        stages = await requestDecomposition({
          name: target.name,
          goal: target.goal,
          startDate: target.startDate,
          targetDate: target.targetDate,
        });
        by = "agent";
      } catch (error) {
        stages = localDecomposition();
        by = "local";
        const reason = error instanceof AgentError ? error.userMessage : "Cloud Agent 暂时不可用。";
        message = `${reason}已改用本地模板生成方案，内容不来自 AI，可以继续编辑。`;
      }

      let comparison: PlanComparison | undefined;
      if (redo) {
        const previousStages = projectStages(target.id);
        const previousMilestones = projectMilestones(target.id);
        const previous = previousStages.map((stage) => ({
          name: stage.name,
          weight: stage.weight,
          milestones: previousMilestones.filter((m) => m.stageId === stage.id).length,
        }));
        comparison = {
          fromVersion: target.decompositionVersion,
          createdAt: now,
          changes: planChangeSummary(previous, stages),
        };
      }

      await saveDraft({
        projectId: target.id,
        stages,
        generatedAt: now,
        generatedBy: by,
        comparison,
      });
      setAgentMessage(message);
      notify(
        redo
          ? "新版本草稿已生成。锁定后才会替换当前方案。"
          : by === "agent"
            ? "分解方案已生成，可以开始编辑。"
            : "本地模板方案已生成，可以开始编辑。",
        by === "agent" ? "success" : "info",
      );
    } catch {
      notify("方案生成失败，请重试。", "error");
    } finally {
      setGenerating(false);
    }
  };

  const updateStage = (index: number, patch: Partial<PlanStage>) => {
    setPlan((prev) =>
      prev ? prev.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)) : prev,
    );
  };

  const updateMilestone = (stageIndex: number, msIndex: number, patch: Partial<PlanMilestone>) => {
    setPlan((prev) =>
      prev
        ? prev.map((stage, i) =>
            i === stageIndex
              ? {
                  ...stage,
                  milestones: stage.milestones.map((m, j) => (j === msIndex ? { ...m, ...patch } : m)),
                }
              : stage,
          )
        : prev,
    );
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeStage = (index: number) => {
    setPlan((prev) => (prev && prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const addStage = () => {
    setPlan((prev) => {
      if (!prev || prev.length >= 7) return prev;
      const stamp = newPlanId("stage");
      return [
        ...prev,
        {
          id: stamp,
          name: `新阶段 ${prev.length + 1}`,
          weight: 2,
          milestones: [
            { id: newPlanId("ms"), name: "里程碑 1", weight: 2, type: "manual" as const, manualState: 0 as const },
            { id: newPlanId("ms"), name: "里程碑 2", weight: 2, type: "manual" as const, manualState: 0 as const },
          ],
        },
      ];
    });
  };

  const moveMilestone = (stageIndex: number, msIndex: number, direction: -1 | 1) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const stage = prev[stageIndex];
      const target = msIndex + direction;
      if (!stage || target < 0 || target >= stage.milestones.length) return prev;
      const milestones = stage.milestones.slice();
      [milestones[msIndex], milestones[target]] = [milestones[target], milestones[msIndex]];
      return prev.map((s, i) => (i === stageIndex ? { ...s, milestones } : s));
    });
  };

  const removeMilestone = (stageIndex: number, msIndex: number) => {
    setPlan((prev) =>
      prev
        ? prev.map((stage, i) =>
            i === stageIndex
              ? { ...stage, milestones: stage.milestones.filter((_, j) => j !== msIndex) }
              : stage,
          )
        : prev,
    );
  };

  const addMilestone = (stageIndex: number) => {
    setPlan((prev) =>
      prev
        ? prev.map((stage, i) =>
            i === stageIndex && stage.milestones.length < 4
              ? {
                  ...stage,
                  milestones: [
                    ...stage.milestones,
                    {
                      id: newPlanId("ms"),
                      name: `新里程碑 ${stage.milestones.length + 1}`,
                      weight: 2,
                      type: "manual" as const,
                      manualState: 0 as const,
                    },
                  ],
                }
              : stage,
          )
        : prev,
    );
  };

  const handleLock = async () => {
    if (!project || !plan || !draft) return;
    if (issues.length > 0) {
      notify(`还有 ${issues.length} 项需要修正后才能锁定。`, "error");
      return;
    }
    setLocking(true);
    try {
      const hash = await lockPlan(project.id, plan, draft.generatedBy, draft.comparison);
      notify(`方案已锁定，哈希 ${hash}。`, "success");
    } catch {
      notify("锁定失败，请重试。", "error");
    } finally {
      setLocking(false);
    }
  };

  const handleRedo = () => {
    if (!project) return;
    setRedoOpen(false);
    void runDecomposition(project, true);
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-main">
          <div className="eyebrow">
            <span>分解与冻结</span>
            <DemoBadge show={snap.meta.demo} />
          </div>
          <h1 className="h1">把目标拆成可推进的阶段</h1>
          <p className="lede">
            先写清目标和周期，再生成阶段与里程碑。锁定后方案只读，AI 不会再改动它；只有你显式重新推导，才会产生新版本。
          </p>
        </div>
        {snap.projects.length > 0 ? (
          <div className="field" style={{ minWidth: 210 }}>
            <label className="label" htmlFor="decompose-project">
              当前项目
            </label>
            <select
              id="decompose-project"
              className="select"
              value={creating ? "__new__" : project?.id ?? "__new__"}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "__new__") startNew();
                else {
                  setCreating(false);
                  setEditingProject(false);
                  setSelectedId(value);
                  setAgentMessage(null);
                }
              }}
            >
              {snap.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__new__">＋ 新建项目</option>
            </select>
          </div>
        ) : null}
      </div>

      <StepBar mode={mode} />

      {mode === "form" ? (
        <div className="card card-pad">
          <div className="card-head">
            <div>
              <span className="card-kicker">第 1 步 / 共 3 步</span>
              <p className="h3" style={{ marginTop: 4 }}>
                {project && editingProject ? "修改项目目标" : "建立新项目"}
              </p>
            </div>
          </div>
          <form onSubmit={saveProjectForm}>
            <div className="form-grid">
              <div className="field span-2">
                <label className="label" htmlFor="project-name">
                  项目名
                </label>
                <input
                  id="project-name"
                  className="input"
                  value={form.name}
                  maxLength={40}
                  placeholder="例如：Momentum 建站冲刺"
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="field span-2">
                <label className="label" htmlFor="project-goal">
                  目标一句话
                </label>
                <input
                  id="project-goal"
                  className="input"
                  value={form.goal}
                  maxLength={80}
                  placeholder="例如：完成一个每天打开的进度追踪网站"
                  onChange={(event) => setForm({ ...form, goal: event.target.value })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="project-start">
                  开始日
                </label>
                <input
                  id="project-start"
                  className="input"
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="project-target">
                  结束日
                </label>
                <input
                  id="project-target"
                  className="input"
                  type="date"
                  value={form.targetDate}
                  onChange={(event) => setForm({ ...form, targetDate: event.target.value })}
                />
              </div>
            </div>
            <div className="row-between" style={{ marginTop: 18 }}>
              <span className="hint">项目与方案只保存在这个浏览器里，不会上传。</span>
              <div className="actions">
                {project || (creating && snap.projects.length > 0) ? (
                  <button type="button" className="btn btn-ghost" onClick={cancelEditProject}>
                    取消
                  </button>
                ) : null}
                <button type="submit" className="btn btn-primary" disabled={savingForm}>
                  {savingForm ? <Spinner label="保存中" /> : project && editingProject ? "保存修改" : "保存并继续"}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "generate" && project ? (
        <div className="card card-pad">
          <div className="card-head">
            <div>
              <span className="card-kicker">第 2 步 / 共 3 步</span>
              <p className="h3" style={{ marginTop: 4 }}>
                生成分解方案
              </p>
            </div>
            <span className="hint">
              {formatShortDate(project.startDate)} 至 {formatShortDate(project.targetDate)} ·{" "}
              {daysBetween(project.startDate, project.targetDate)} 天
            </span>
          </div>
          <div className="stack-sm">
            <div>
              <p className="h3">{project.name}</p>
              <p className="lede" style={{ marginTop: 4 }}>
                {project.goal}
              </p>
            </div>
            <p className="hint">
              Cloud Agent 会生成 4–7 个阶段，每阶段 2–4 个里程碑，自动型与手动型混合。生成结果只是草稿，锁定前可以改名、调权重、删减和调整顺序。
            </p>
            {agentMessage ? <Notice>{agentMessage}</Notice> : null}
            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={generating}
                onClick={() => void runDecomposition(project, false)}
              >
                {generating ? <Spinner label="正在生成" /> : "生成分解方案"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={startEditProject} disabled={generating}>
                上一步：修改目标
              </button>
            </div>
            <p className="hint">
              预览环境未启用 Cloud Agent 时，会自动改用本地模板生成，并在方案上明确标注来源。
            </p>
          </div>
        </div>
      ) : null}

      {mode === "edit" && project && draft ? (
        <>
          <div className="section-head" style={{ marginBottom: 12 }}>
            <div>
              <span className="card-kicker">第 3 步 / 共 3 步</span>
              <h2 className="h2" style={{ marginTop: 4 }}>
                编辑并锁定
              </h2>
            </div>
            <span className="hint">草稿自动保存在本浏览器</span>
          </div>

          {project.decompositionFrozen ? (
            <div style={{ marginBottom: 12 }}>
              <Notice>
                这是 v{project.decompositionVersion + 1} 的草稿。锁定前，项目进度仍按 v
                {project.decompositionVersion} 计算；锁定后 v{project.decompositionVersion} 自动归档。
              </Notice>
            </div>
          ) : null}

          {agentMessage ? (
            <div style={{ marginBottom: 12 }}>
              <Notice>{agentMessage}</Notice>
            </div>
          ) : null}

          {draft.comparison ? (
            <ComparisonPanel
              comparison={draft.comparison}
              title={`与 v${draft.comparison.fromVersion} 相比`}
            />
          ) : null}

          <div className="plan-summary">
            <span>
              阶段 <b>{plan?.length ?? 0}</b>
            </span>
            <span>
              里程碑 <b>{planStats.milestones}</b>
            </span>
            <span>
              自动 <b>{planStats.metric}</b>
            </span>
            <span>
              手动 <b>{planStats.manual}</b>
            </span>
            <span>
              阶段权重合计 <b>{planStats.weight}</b>
            </span>
            <span>
              来源 <b>{sourceLabel(draft.generatedBy)}</b>
            </span>
          </div>

          {issues.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <Notice>
                锁定前还需要处理 {issues.length} 项：
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                  {issues.slice(0, 6).map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                  {issues.length > 6 ? <li>还有 {issues.length - 6} 项未列出。</li> : null}
                </ul>
              </Notice>
            </div>
          ) : null}

          {plan ? (
            <>
              {plan.map((stage, stageIndex) => (
                <div className="stage-editor" key={stage.id}>
                  <div className="stage-editor-head">
                    <div className="field">
                      <label className="label" htmlFor={`stage-name-${stage.id}`}>
                        阶段名称
                      </label>
                      <input
                        id={`stage-name-${stage.id}`}
                        className="input"
                        value={stage.name}
                        maxLength={20}
                        onChange={(event) => updateStage(stageIndex, { name: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label className="label" htmlFor={`stage-weight-${stage.id}`}>
                        权重
                      </label>
                      <input
                        id={`stage-weight-${stage.id}`}
                        className="input"
                        type="number"
                        min={1}
                        max={10}
                        value={stage.weight}
                        onChange={(event) => {
                          const value = event.target.valueAsNumber;
                          if (!Number.isNaN(value)) updateStage(stageIndex, { weight: Math.round(value) });
                        }}
                      />
                    </div>
                    <div className="reorder">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`上移阶段 ${stage.name}`}
                        disabled={stageIndex === 0}
                        onClick={() => moveStage(stageIndex, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`下移阶段 ${stage.name}`}
                        disabled={stageIndex === plan.length - 1}
                        onClick={() => moveStage(stageIndex, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`删除阶段 ${stage.name}`}
                        disabled={plan.length <= 1}
                        onClick={() => removeStage(stageIndex)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  {stage.milestones.map((m, msIndex) => (
                    <div className="ms-edit" key={m.id}>
                      <input
                        className="input"
                        value={m.name}
                        maxLength={30}
                        aria-label={`${stage.name}的里程碑名称`}
                        onChange={(event) => updateMilestone(stageIndex, msIndex, { name: event.target.value })}
                      />
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={10}
                        value={m.weight}
                        aria-label={`${m.name}的权重`}
                        onChange={(event) => {
                          const value = event.target.valueAsNumber;
                          if (!Number.isNaN(value)) updateMilestone(stageIndex, msIndex, { weight: Math.round(value) });
                        }}
                      />
                      <div className="reorder ms-edit-del">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`上移里程碑 ${m.name}`}
                          disabled={msIndex === 0}
                          onClick={() => moveMilestone(stageIndex, msIndex, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`下移里程碑 ${m.name}`}
                          disabled={msIndex === stage.milestones.length - 1}
                          onClick={() => moveMilestone(stageIndex, msIndex, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`删除里程碑 ${m.name}`}
                          disabled={stage.milestones.length <= 1}
                          onClick={() => removeMilestone(stageIndex, msIndex)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      {m.type === "metric" ? (
                        <div className="row" style={{ gridColumn: "1 / -1" }}>
                          <span className="badge">自动</span>
                          <select
                            className="select"
                            style={{ maxWidth: 150 }}
                            value={m.metricKey ?? "commits"}
                            aria-label={`${m.name}的指标`}
                            onChange={(event) =>
                              updateMilestone(stageIndex, msIndex, {
                                metricKey: event.target.value as MetricKey,
                              })
                            }
                          >
                            {METRIC_OPTIONS.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            style={{ maxWidth: 110 }}
                            value={m.targetValue ?? ""}
                            aria-label={`${m.name}的目标值`}
                            placeholder="目标值"
                            onChange={(event) => {
                              const value = event.target.valueAsNumber;
                              updateMilestone(stageIndex, msIndex, {
                                targetValue: Number.isNaN(value) ? undefined : Math.round(value),
                              });
                            }}
                          />
                          <span className="hint">目标值</span>
                        </div>
                      ) : (
                        <div className="row" style={{ gridColumn: "1 / -1" }}>
                          <span className="badge">手动确认</span>
                          <span className="hint">完成时在进度页标记</span>
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={stage.milestones.length >= 4}
                      onClick={() => addMilestone(stageIndex)}
                    >
                      添加里程碑
                    </button>
                    <span className="hint">每阶段 2–4 个</span>
                  </div>
                </div>
              ))}

              <div className="row" style={{ marginTop: 4 }}>
                <button type="button" className="btn" disabled={plan.length >= 7} onClick={addStage}>
                  添加阶段
                </button>
                <span className="hint">共 4–7 个阶段</span>
              </div>

              <div className="card card-pad row-between" style={{ marginTop: 20 }}>
                <div style={{ minWidth: 0 }}>
                  <p className="h3">检查无误后锁定</p>
                  <p className="hint" style={{ marginTop: 4 }}>
                    锁定会计算规范化 JSON 的 SHA-256 前 8 位作为哈希，并把方案固定下来。此后任何 AI 调用都不能修改它。
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={locking || generating || issues.length > 0}
                  onClick={() => void handleLock()}
                >
                  {locking ? <Spinner label="锁定中" /> : `锁定方案 v${nextVersion}`}
                </button>
              </div>
            </>
          ) : (
            <div className="card card-pad">
              <div className="skeleton skeleton-line" style={{ width: "70%" }} />
              <div className="skeleton skeleton-line" style={{ width: "45%" }} />
            </div>
          )}
        </>
      ) : null}

      {mode === "locked" && project ? (
        <>
          {generating ? (
            <div style={{ marginBottom: 12 }}>
              <Notice>
                <Spinner label={`正在生成 v${project.decompositionVersion + 1} 草稿`} />
              </Notice>
            </div>
          ) : null}

          <div className="lock-card">
            <div className="row-between">
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-solid">
                  <LockIcon /> 已锁定 v{project.decompositionVersion}
                </span>
                <span className="hint">方案只读，AI 不得修改</span>
              </div>
              {archives.length > 0 ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchiveOpen(true)}>
                  查看归档（{archives.length}）
                </button>
              ) : null}
            </div>
            <div className="lock-chain" aria-label="目标与阶段权重">
              <span className="lock-node">
                <b>{project.goal}</b>
              </span>
              {lockedStages.map((stage) => (
                <Fragment key={stage.id}>
                  <span className="lock-arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="lock-node">
                    {stage.name}
                    <span>w{stage.weight}</span>
                  </span>
                </Fragment>
              ))}
            </div>
            <div className="lock-foot">
              <span>
                {generatedSentence(generatedBy)} 于{" "}
                {project.decompositionAt ? formatCnDate(project.decompositionAt.slice(0, 10)) : "—"} 生成并锁定，哈希{" "}
                <span className="hash">{project.decompositionHash ?? "—"}</span>
              </span>
              <span>规范化 JSON 的 SHA-256 前 8 位</span>
            </div>
          </div>

          {lockedComparison ? (
            <div style={{ marginTop: 16 }}>
              <ComparisonPanel
                comparison={lockedComparison}
                title={`与 v${lockedComparison.fromVersion} 相比`}
              />
            </div>
          ) : null}

          <div className="section">
            <div className="section-head">
              <h2 className="h2">当前生效方案</h2>
              <span className="section-note">
                {lockedStages.length} 个阶段 · 权重合计 {lockedStages.reduce((total, stage) => total + stage.weight, 0)}
              </span>
            </div>
            <div className="stack-sm">
              {lockedStages.map((stage, index) => {
                const ms = lockedMilestones.filter((m) => m.stageId === stage.id);
                return (
                  <div className="archive-item" key={stage.id}>
                    <h4>
                      {String(index + 1).padStart(2, "0")} · {stage.name} <span className="badge">权重 {stage.weight}</span>
                    </h4>
                    {ms.length === 0 ? (
                      <p className="hint">未设置里程碑</p>
                    ) : (
                      <ul className="ms-inline">
                        {ms.map((m) => (
                          <li key={m.id}>
                            {m.name} · w{m.weight} ·{" "}
                            {m.type === "manual" ? "手动" : `自动 · 目标 ${m.targetValue ?? "—"}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-head" style={{ marginTop: 26 }}>
            <div>
              <h2 className="h2">需要改结构？</h2>
              <p className="hint" style={{ marginTop: 4 }}>
                锁定后不能直接编辑。重新推导会生成一份新草稿，二次确认并锁定后才会替换当前版本。
              </p>
            </div>
            <div className="actions">
              <Link to={`/project/${project.id}`} className="btn">
                查看项目进度
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                disabled={generating}
                onClick={() => {
                  setRedoAck(false);
                  setRedoOpen(true);
                }}
              >
                重新推导（生成 v{project.decompositionVersion + 1}）
              </button>
            </div>
          </div>
        </>
      ) : null}

      <Dialog open={redoOpen} onClose={() => setRedoOpen(false)} title={`重新推导 v${nextVersion}？`}>
        <div className="stack-sm">
          <p>
            重新推导会调用 Cloud Agent 生成一套新的阶段与里程碑。生成后仍可编辑；只有锁定新方案时，当前的 v
            {project?.decompositionVersion ?? ""} 才会进入归档，进度按新方案重算。
          </p>
          <label className="row" style={{ alignItems: "flex-start", gap: 10, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={redoAck}
              onChange={(event) => setRedoAck(event.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, flex: "none" }}
            />
            <span>我了解：锁定新方案会替换当前生效方案，归档版本仍可查看。</span>
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setRedoOpen(false)}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={!redoAck} onClick={handleRedo}>
            确认重新推导
          </button>
        </div>
      </Dialog>

      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} title="归档的历史版本" wide>
        {archives.length === 0 ? (
          <p className="hint">还没有归档版本。</p>
        ) : (
          <div className="archive-list">
            {archives.map((archive: ArchivedVersion) => (
              <div className="archive-item" key={archive.version}>
                <div className="row-between">
                  <h4>
                    v{archive.version} · 哈希 <span className="hash">{archive.hash || "—"}</span>
                  </h4>
                  <span className="hint">锁定于 {formatCnDate(archive.lockedAt.slice(0, 10))}</span>
                </div>
                {archive.stages.map((stage) => (
                  <div key={stage.id} style={{ marginTop: 10 }}>
                    <p className="h3">
                      {stage.name} <span className="badge">权重 {stage.weight}</span>
                    </p>
                    <ul className="ms-inline">
                      {stage.milestones.map((m) => (
                        <li key={m.id}>
                          {m.name} · w{m.weight} ·{" "}
                          {m.type === "manual" ? "手动" : `自动 · 目标 ${m.targetValue ?? "—"}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setArchiveOpen(false)}>
            关闭
          </button>
        </div>
      </Dialog>
    </>
  );
}
