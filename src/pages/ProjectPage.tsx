import { Fragment, useMemo, useState } from "react";
import type { ArchivedVersion, Milestone, Project } from "@/types";
import { useMomentum } from "@/store/state";
import { useRouter, Link } from "@/router";
import {
  daysBetween,
  formatCnDate,
  formatShortDate,
  todayKey,
} from "@/lib/date";
import {
  computeProgressSet,
  formatPercent,
  healthLabel,
  milestoneCompletion,
  milestoneRemainingLabel,
  withAchievedValues,
} from "@/lib/progress";
import { ChevronDown, DemoBadge, Dialog, EmptyState, LockIcon, Notice, ProgressBar, TrendText } from "@/components/ui";

function projectGeneratedText(projectId: string, generatedBy?: string): string {
  if (generatedBy === "local") return "本方案由本地模板";
  if (generatedBy === "demo") return "演示方案由 AI";
  return "本方案由 AI";
}

function targetHint(m: Milestone, today: string): string | null {
  if (!m.targetDate || m.achievedAt) return null;
  const diff = daysBetween(today, m.targetDate);
  return diff >= 0 ? `距目标日 ${diff} 天` : `已超目标日 ${Math.abs(diff)} 天`;
}

export function ProjectPage({ projectId }: { projectId: string | null }) {
  const { snap, ready, activeProject, projectStages, projectMilestones, setManualState, notify, loadDemo, busy } = useMomentum();
  const { navigate } = useRouter();
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [viewArchive, setViewArchive] = useState<ArchivedVersion | null>(null);
  const today = todayKey();

  const project: Project | null = useMemo(() => {
    if (!snap) return null;
    if (projectId) return snap.projects.find((p) => p.id === projectId) ?? null;
    return activeProject;
  }, [snap, projectId, activeProject]);

  const stages = useMemo(() => (project ? projectStages(project.id) : []), [project, projectStages]);
  const rawMilestones = useMemo(() => (project ? projectMilestones(project.id) : []), [project, projectMilestones]);
  const milestones = useMemo(
    () => (snap ? withAchievedValues(rawMilestones, snap.events) : []),
    [rawMilestones, snap],
  );
  const progressSet = useMemo(
    () => (project && snap ? computeProgressSet(project, stages, rawMilestones, snap.events) : null),
    [project, stages, rawMilestones, snap],
  );

  if (!ready || !snap) {
    return (
      <div className="card card-pad">
        <div className="skeleton skeleton-line" style={{ width: "60%" }} />
        <div className="skeleton skeleton-line" style={{ width: "40%" }} />
      </div>
    );
  }

  if (!project || !progressSet) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="eyebrow">项目进度</div>
            <h1 className="h1">还没有锁定方案的项目</h1>
          </div>
        </div>
        <EmptyState
          mark="—"
          title={projectId ? "没有找到这个项目" : "先建立一份分解方案"}
          actions={
            <>
              <Link to="/decompose" className="btn btn-primary">
                去建立分解
              </Link>
              <button type="button" className="btn" onClick={() => void loadDemo()} disabled={busy}>
                加载演示数据
              </button>
            </>
          }
        >
          {projectId
            ? "链接中的项目不在本地数据里。可以回到今日页或重新建立项目。"
            : "进度页只展示已锁定的分解方案。完成分解并锁定后，这里会显示实际进度、健康度与 7 日趋势。"}
        </EmptyState>
      </>
    );
  }

  const archives = snap.archives[project.id] ?? [];
  const generatedBy = snap.meta.generatedBy[project.id];
  const health = progressSet.health;
  const healthDelta =
    health.delta === null
      ? null
      : `${health.delta >= 0 ? "+" : ""}${(health.delta * 100).toFixed(1)} 个百分点`;
  const firstIncomplete = stages.find((s) => (progressSet.stageValues[s.id] ?? 0) < 1)?.id ?? stages[0]?.id ?? null;
  const openId = openStage ?? firstIncomplete;

  const toggleManual = async (m: Milestone, state: 0 | 0.5 | 1, milestoneName: string) => {
    await setManualState(m.id, state);
    if (state === 1) notify(`「${milestoneName}」已标记完成。`, "success");
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-main">
          <div className="eyebrow">
            <span>项目进度</span>
            <DemoBadge show={snap.meta.demo} />
            {project.decompositionFrozen ? <span className="badge">方案已锁定 v{project.decompositionVersion}</span> : null}
          </div>
          <h1 className="h1">{project.name}</h1>
          <p className="lede">
            {project.goal} · {formatShortDate(project.startDate)} 至 {formatShortDate(project.targetDate)}
          </p>
        </div>
        {snap.projects.length > 1 ? (
          <div className="field" style={{ minWidth: 220 }}>
            <label className="label" htmlFor="project-switch">
              切换项目
            </label>
            <select
              id="project-switch"
              className="select"
              value={project.id}
              onChange={(event) => navigate(`/project/${event.target.value}`)}
            >
              {snap.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {progressSet.noWeights ? (
        <div style={{ marginBottom: 16 }}>
          <Notice>所有阶段权重都为 0，进度无法计算。请为阶段分配权重。</Notice>
        </div>
      ) : null}

      <div className="card progress-hero">
        <div className="progress-hero-main">
          <div className="progress-value tabular">
            {(progressSet.progress * 100).toFixed(1)}
            <small>%</small>
          </div>
          <div className="progress-caption">
            实际进度 · 目标日 {formatShortDate(project.targetDate)}
          </div>
          <div className="triplet">
            <div>
              <div className="k">健康度</div>
              <div className="v">
                <span
                  className={`badge ${
                    health.state === "ahead" ? "badge-ahead" : health.state === "behind" ? "badge-behind" : ""
                  }`}
                >
                  {healthLabel(health.state)}
                </span>
                {healthDelta ? <span className="hint tabular">{healthDelta}</span> : null}
              </div>
            </div>
            <div>
              <div className="k">近 7 天</div>
              <div className="v">
                <TrendText trend={progressSet.trend} />
              </div>
            </div>
            <div>
              <div className="k">时间进度</div>
              <div className="v tabular">{progressSet.expected === null ? "—" : formatPercent(progressSet.expected, 0)}</div>
            </div>
          </div>
        </div>
        <div>
          <ProgressBar value={progressSet.progress} expected={progressSet.expected} />
          <div className="legend" style={{ marginTop: 12 }}>
            <span>
              <i className="legend-block" aria-hidden="true" />
              实际进度
            </span>
            <span>
              <i className="legend-line" aria-hidden="true" />
              今天应到
            </span>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            健康度 = 实际 − 应到；超前 / 滞后阈值为 5 个百分点。所有数字由同一份本地数据确定性计算。
          </p>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="h2">阶段与里程碑</h2>
          <span className="section-note">{stages.length} 个阶段 · 权重合计 {stages.reduce((a, s) => a + s.weight, 0)}</span>
        </div>
        {stages.map((stage, index) => {
          const stageMs = milestones.filter((m) => m.stageId === stage.id);
          const hasMilestones = progressSet.stageHasMilestones[stage.id];
          const value = progressSet.stageValues[stage.id] ?? 0;
          const expanded = openId === stage.id;
          return (
            <section className="stage" key={stage.id} data-open={expanded ? "true" : "false"}>
              <button
                type="button"
                className="stage-head"
                onClick={() => setOpenStage(expanded ? "" : stage.id)}
                aria-expanded={expanded}
              >
                <span className="stage-index tabular">{String(index + 1).padStart(2, "0")}</span>
                <span className="stage-main">
                  <span className="stage-title">
                    {stage.name}
                    <span className="badge">权重 {stage.weight}</span>
                    {!hasMilestones ? <span className="badge badge-warm">未设置里程碑</span> : null}
                  </span>
                  <span className="stage-sub">
                    <span className="stage-bar" aria-hidden="true">
                      <span style={{ width: hasMilestones ? `${value * 100}%` : "0%" }} />
                    </span>
                    <span className="stage-pct">{hasMilestones ? `完成 ${formatPercent(value, 0)}` : "未设置里程碑"}</span>
                  </span>
                </span>
                <span className="stage-toggle">
                  {expanded ? "收起" : "展开"}
                  <ChevronDown />
                </span>
              </button>
              {expanded ? (
                <div className="stage-body">
                  {!hasMilestones ? (
                    <p className="stage-empty">这个阶段还没有里程碑，完成度记为 0，不显示为 0%。</p>
                  ) : (
                    stageMs.map((m) => {
                      const completion = milestoneCompletion(m);
                      const hiddenUnachieved = m.hidden && !m.achievedAt;
                      const typeLabel =
                        m.type === "manual"
                          ? "手动"
                          : m.metricKey === "commits"
                            ? "自动 · 提交"
                            : m.metricKey === "days"
                              ? "自动 · 天数"
                              : m.metricKey === "sessions"
                                ? "自动 · 工作段"
                                : "自动 · 自定义";
                      return (
                        <div className="ms-row" key={m.id}>
                          <div>
                            <div className="ms-name">
                              {hiddenUnachieved ? <span className="muted">隐藏成就 · 达成后揭晓</span> : m.name}
                              <span className="badge">{typeLabel}</span>
                              <span className="badge">权重 {m.weight}</span>
                              {m.achievedAt ? <span className="badge badge-ahead">已达成</span> : null}
                            </div>
                            {hiddenUnachieved ? null : (
                              <>
                                <div className="ms-meta">
                                  <span>{milestoneRemainingLabel(m)}</span>
                                  {m.type === "metric" ? (
                                    <span className="tabular">
                                      {m.achievedValue ?? 0} / {m.targetValue ?? 0}
                                    </span>
                                  ) : null}
                                  {targetHint(m, today) ? <span>{targetHint(m, today)}</span> : null}
                                  {m.achievedAt ? <span className="ms-done">达成于 {formatCnDate(m.achievedAt.slice(0, 10))}</span> : null}
                                </div>
                                <div className="ms-bar" aria-hidden="true">
                                  <span style={{ width: `${completion * 100}%` }} />
                                </div>
                              </>
                            )}
                          </div>
                          <div className="ms-actions">
                            {m.type === "manual" && !hiddenUnachieved ? (
                              m.achievedAt ? (
                                <span className="badge badge-ahead">已完成</span>
                              ) : (
                                ([0, 0.5, 1] as const).map((state) => {
                                  const label = state === 0 ? "未开始" : state === 0.5 ? "进行中" : "已完成";
                                  const active = m.manualState === state;
                                  return (
                                    <button
                                      key={state}
                                      type="button"
                                      className={`btn btn-sm${active ? " btn-primary" : ""}`}
                                      aria-pressed={active}
                                      onClick={() => void toggleManual(m, state, m.name)}
                                    >
                                      {label}
                                    </button>
                                  );
                                })
                              )
                            ) : (
                              <span className="ms-hint">{hiddenUnachieved ? "" : "按事件自动重算"}</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="h2">分解方案</h2>
          <Link to="/decompose" className="link" style={{ fontSize: 13 }}>
            管理分解
          </Link>
        </div>
        {project.decompositionFrozen ? (
          <div className="lock-card">
            <div className="row-between">
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-solid">
                  <LockIcon /> 已锁定 v{project.decompositionVersion}
                </span>
                <span className="hint">分解不可被 AI 修改</span>
              </div>
              {archives.length > 0 ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArchiveOpen(true)}>
                  查看历史版本（{archives.length}）
                </button>
              ) : null}
            </div>
            <div className="lock-chain" aria-label="目标与阶段权重">
              <span className="lock-node">
                <b>{project.goal}</b>
              </span>
              {stages.map((stage) => (
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
                {projectGeneratedText(project.id, generatedBy)} 于{" "}
                {project.decompositionAt ? formatCnDate(project.decompositionAt.slice(0, 10)) : "—"} 生成并锁定，哈希{" "}
                <span className="hash">{project.decompositionHash ?? "—"}</span>
              </span>
              <span>规范化 JSON 的 SHA-256 前 8 位</span>
            </div>
          </div>
        ) : (
          <Notice>
            方案尚未锁定。完成「分解」流程并锁定后，进度才会以该方案为准，并且此后 AI 不得修改它。
          </Notice>
        )}
      </div>

      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} title="分解历史版本" wide>
        <div className="archive-list">
          {archives.length === 0 ? <p className="hint">还没有归档版本。</p> : null}
          {archives.map((archive) => (
            <div className="archive-item" key={archive.version}>
              <div className="row-between">
                <h4>
                  v{archive.version} · {archive.hash || "无哈希"}
                </h4>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewArchive(archive)}>
                  查看详情
                </button>
              </div>
              <p className="hint">锁定于 {formatCnDate(archive.lockedAt.slice(0, 10))}</p>
              <ul className="ms-inline">
                {archive.stages.map((stage) => (
                  <li key={stage.id}>
                    {stage.name} · w{stage.weight}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setArchiveOpen(false)}>
            关闭
          </button>
        </div>
      </Dialog>

      <Dialog open={viewArchive !== null} onClose={() => setViewArchive(null)} title={`归档 v${viewArchive?.version ?? ""}`} wide>
        {viewArchive ? (
          <div className="stack-sm">
            <p className="hint">
              锁定于 {formatCnDate(viewArchive.lockedAt.slice(0, 10))} · 哈希 <span className="hash">{viewArchive.hash || "—"}</span>
            </p>
            {viewArchive.stages.map((stage) => (
              <div className="archive-item" key={stage.id}>
                <h4>
                  {stage.name} · 权重 {stage.weight}
                </h4>
                <ul className="ms-inline">
                  {stage.milestones.map((m) => (
                    <li key={m.id}>
                      {m.name} · w{m.weight} · {m.type === "manual" ? "手动" : `自动 ${m.targetValue ?? 0}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setViewArchive(null)}>
            关闭
          </button>
        </div>
      </Dialog>
    </>
  );
}
