import { useMemo, useState } from "react";
import type { DaySummary, Milestone, SummaryEvidence } from "@/types";
import { useMomentum } from "@/store/state";
import { Link } from "@/router";
import {
  addDays,
  formatCnDate,
  formatShortDate,
  parseDateKey,
  todayKey,
  weekdayCn,
} from "@/lib/date";
import { buildDayFact, commitsOnDate } from "@/lib/dayFact";
import {
  milestoneRemainingLabel,
  withAchievedValues,
} from "@/lib/progress";
import { EvidenceChips, EvidenceDialog } from "@/components/EvidenceDialog";
import { ChevronDown, DemoBadge, EmptyState, Notice } from "@/components/ui";

type Range = 7 | 30;

function heatLevel(sessions: number): 0 | 1 | 2 | 3 | 4 {
  if (sessions <= 0) return 0;
  if (sessions === 1) return 1;
  if (sessions === 2) return 2;
  if (sessions <= 4) return 3;
  return 4;
}

function provenanceOf(summary: DaySummary): { text: string; cls: string } {
  if (summary.agentRunId === "demo:seed") return { text: "演示数据", cls: "badge-demo" };
  if (summary.agentRunId.startsWith("local")) return { text: "本地降级 · AI 未连接", cls: "badge-warm" };
  return { text: "Cloud Agent", cls: "badge-ahead" };
}

export function ReviewPage() {
  const { snap, ready, activeProject, projectStages, projectMilestones, loadDemo, busy } = useMomentum();
  const today = todayKey();
  const [range, setRange] = useState<Range>(30);
  const [selectedDate, setSelectedDate] = useState(today);
  const [evidence, setEvidence] = useState<SummaryEvidence | null>(null);

  const cells = useMemo(() => {
    const start = addDays(today, -(range - 1));
    const leading = (parseDateKey(start).getDay() + 6) % 7;
    const dates: (string | null)[] = Array.from({ length: leading }, () => null);
    for (let i = 0; i < range; i += 1) dates.push(addDays(start, i));
    return dates;
  }, [range, today]);

  const summaries = useMemo(() => {
    if (!snap) return [];
    return Object.values(snap.summaries).sort((a, b) => b.date.localeCompare(a.date));
  }, [snap]);

  if (!ready || !snap) {
    return (
      <div className="card card-pad">
        <div className="skeleton skeleton-line" style={{ width: "55%" }} />
        <div className="skeleton skeleton-line" style={{ width: "40%" }} />
      </div>
    );
  }

  const selectedFact = buildDayFact(selectedDate, snap.events);
  const selectedCommits = commitsOnDate(snap.events, selectedDate);
  const selectedSummary = snap.summaries[selectedDate];
  const hasEvents = snap.events.length > 0;

  const stages = activeProject ? projectStages(activeProject.id) : [];
  const milestones: Milestone[] = activeProject
    ? withAchievedValues(projectMilestones(activeProject.id), snap.events)
    : [];
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
  const orderOf = new Map<string, number>();
  stages.forEach((stage, stageIndex) => {
    milestones
      .filter((m) => m.stageId === stage.id)
      .forEach((m, msIndex) => orderOf.set(m.id, stageIndex * 100 + msIndex));
  });

  const achieved = milestones
    .filter((m) => m.achievedAt)
    .sort((a, b) => (b.achievedAt ?? "").localeCompare(a.achievedAt ?? ""));
  const upcoming = milestones
    .filter((m) => !m.achievedAt)
    .sort((a, b) => (orderOf.get(a.id) ?? 0) - (orderOf.get(b.id) ?? 0));

  return (
    <>
      <div className="page-head">
        <div className="page-head-main">
          <div className="eyebrow">
            <span>回顾</span>
            <DemoBadge show={snap.meta.demo} />
          </div>
          <h1 className="h1">把最近的事实摊开看</h1>
          <p className="lede">热力图看活跃节奏，历史总结看每天做了什么，里程碑时间线看走到哪一步。</p>
        </div>
      </div>

      {!hasEvents ? (
        <div className="section">
          <EmptyState
            mark="—"
            title="还没有可回顾的数据"
            actions={
              <>
                <button type="button" className="btn btn-primary" onClick={() => void loadDemo()} disabled={busy}>
                  加载演示数据
                </button>
                <Link to="/" className="btn btn-ghost">
                  回到今日
                </Link>
              </>
            }
          >
            采集 GitHub、导入 JSON 或手动记录后，这里会按天汇总。没有数据时不会生成任何 AI 内容。
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="section">
            <div className="section-head">
              <h2 className="h2">活跃热力图</h2>
              <span className="section-note">每列一周，周一在上</span>
            </div>
            <div className="card card-pad">
              <div className="heat-controls">
                <div className="segmented" role="group" aria-label="热力图范围">
                  <button type="button" aria-pressed={range === 7} onClick={() => { setRange(7); setSelectedDate(today); }}>
                    近 7 天
                  </button>
                  <button type="button" aria-pressed={range === 30} onClick={() => { setRange(30); setSelectedDate(today); }}>
                    近 30 天
                  </button>
                </div>
                <div className="heat-legend" aria-hidden="true">
                  少
                  {[0, 1, 2, 3, 4].map((level) => (
                    <i
                      key={level}
                      style={{
                        background:
                          level === 0
                            ? "color-mix(in srgb, var(--site-fg) 6%, var(--site-surface))"
                            : `color-mix(in srgb, var(--site-accent) ${level * 22 + 22}%, var(--site-surface))`,
                      }}
                    />
                  ))}
                  多
                </div>
              </div>
              <div className="heatmap" role="group" aria-label={`近 ${range} 天活跃热力图`}>
                {cells.map((date, index) => {
                  if (!date) {
                    return <span className="heat-cell" data-blank="true" key={`blank-${index}`} aria-hidden="true" />;
                  }
                  const fact = buildDayFact(date, snap.events);
                  const level = heatLevel(fact.sessions);
                  const commits = commitsOnDate(snap.events, date);
                  return (
                    <button
                      key={date}
                      type="button"
                      className="heat-cell"
                      data-level={level}
                      data-selected={selectedDate === date ? "true" : "false"}
                      title={`${formatCnDate(date)} · ${fact.sessions} 个工作段 · ${commits} 次提交`}
                      aria-label={`${formatCnDate(date)}，${fact.sessions} 个工作段，${commits} 次提交`}
                      onClick={() => setSelectedDate(date)}
                    />
                  );
                })}
              </div>
              <div className="day-detail">
                <div className="row-between">
                  <div className="h3">
                    {formatCnDate(selectedDate)} · {weekdayCn(selectedDate)}
                  </div>
                  <span className="hint">{selectedFact.hasData ? "有记录" : "无记录"}</span>
                </div>
                <dl style={{ marginTop: 10 }}>
                  <div>
                    <dt>工作段</dt>
                    <dd>{selectedFact.sessions}</dd>
                  </div>
                  <div>
                    <dt>提交</dt>
                    <dd>{selectedCommits}</dd>
                  </div>
                  <div>
                    <dt>关联仓库</dt>
                    <dd>{selectedFact.activeRepos}</dd>
                  </div>
                  <div>
                    <dt>连续活跃</dt>
                    <dd>{selectedFact.streak} 天</dd>
                  </div>
                </dl>
                <p className="hint" style={{ marginTop: 10 }}>
                  {selectedSummary
                    ? selectedSummary.narrative
                    : selectedFact.hasData
                      ? "当天有事件记录，但没有保存总结。"
                      : "当天没有数据，也没有 AI 内容。"}
                </p>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <h2 className="h2">历史总结</h2>
              <span className="section-note">{summaries.length} 天有保存的总结</span>
            </div>
            {summaries.length === 0 ? (
              <Notice>还没有保存的总结。今日页有数据时，可以生成并保存当天的总结。</Notice>
            ) : (
              <div className="stack-sm">
                {summaries.map((summary) => {
                  const badge = provenanceOf(summary);
                  return (
                    <details className="disclosure" key={summary.date}>
                      <summary>
                        <span>
                          {formatCnDate(summary.date)} · {weekdayCn(summary.date)}
                        </span>
                        <span className={`badge ${badge.cls}`}>{badge.text}</span>
                        <span className="chev">
                          <ChevronDown />
                        </span>
                      </summary>
                      <div className="disclosure-body">
                        <p className="summary-narrative">{summary.narrative}</p>
                        {summary.highlights.length > 0 ? (
                          <ol className="hl-list" style={{ marginTop: 12 }}>
                            {summary.highlights.slice(0, 5).map((highlight, index) => (
                              <li key={`${summary.date}-${index}`}>
                                <button
                                  type="button"
                                  className="hl-btn"
                                  onClick={() => setEvidence(summary.evidence[index] ?? summary.evidence[0] ?? null)}
                                >
                                  <span className="hl-mark tabular">{String(index + 1).padStart(2, "0")}</span>
                                  <span>{highlight}</span>
                                </button>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        <div className="summary-sub" style={{ marginTop: 12 }}>
                          <div>
                            <div className="sub-label">下一步</div>
                            <div className="sub-text">{summary.nextStep}</div>
                          </div>
                          <div>
                            <div className="sub-label">阻塞</div>
                            <div className="sub-text">
                              {summary.blockers.length > 0 ? summary.blockers.join("；") : "无证据，不记录阻塞。"}
                            </div>
                          </div>
                        </div>
                        {summary.evidence.length > 0 ? (
                          <>
                            <div className="card-head" style={{ marginTop: 14, marginBottom: 0 }}>
                              <span className="card-kicker">证据</span>
                              <span className="hint">点击查看原始事件</span>
                            </div>
                            <EvidenceChips items={summary.evidence} onOpen={setEvidence} />
                          </>
                        ) : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <div className="section">
        <div className="section-head">
          <h2 className="h2">里程碑时间线</h2>
          {activeProject ? (
            <Link to={`/project/${activeProject.id}`} className="link" style={{ fontSize: 13 }}>
              {activeProject.name}
            </Link>
          ) : (
            <span className="section-note">还没有锁定方案的项目</span>
          )}
        </div>
        {!activeProject ? (
          <Notice>建立并锁定分解方案后，这里会按时间展示已达成和待达成的里程碑。</Notice>
        ) : milestones.length === 0 ? (
          <Notice>当前项目的阶段还没有里程碑。</Notice>
        ) : (
          <div className="card card-pad">
            <div className="stack">
              <div>
                <div className="card-head">
                  <span className="card-kicker">已达成</span>
                  <span className="hint">{achieved.length} 个</span>
                </div>
                {achieved.length === 0 ? (
                  <p className="hint">还没有达成的里程碑。</p>
                ) : (
                  <ul className="timeline">
                    {achieved.map((m) => {
                      const cheer = snap.cheers[m.id];
                      return (
                        <li className="tl-item" key={m.id}>
                          <span className="tl-dot done" aria-hidden="true" />
                          <div className="tl-title">{m.name}</div>
                          <div className="tl-meta">
                            {stageName.get(m.stageId) ?? "未归属阶段"} · 达成于{" "}
                            {m.achievedAt ? formatCnDate(m.achievedAt.slice(0, 10)) : "—"}
                            {m.targetDate ? ` · 目标 ${formatShortDate(m.targetDate)}` : ""}
                          </div>
                          {cheer ? <div className="tl-note">{cheer.text}</div> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <div className="card-head">
                  <span className="card-kicker">接下来</span>
                  <span className="hint">{upcoming.length} 个未达成</span>
                </div>
                {upcoming.length === 0 ? (
                  <p className="hint">所有里程碑都已达成。</p>
                ) : (
                  <ul className="timeline">
                    {upcoming.map((m) => (
                      <li className="tl-item" key={m.id}>
                        <span className="tl-dot" aria-hidden="true" />
                        <div className="tl-title">{m.name}</div>
                        <div className="tl-meta">
                          {stageName.get(m.stageId) ?? "未归属阶段"} ·{" "}
                          {m.targetDate ? `目标 ${formatShortDate(m.targetDate)}` : "无目标日"} · 权重 {m.weight}
                        </div>
                        <div className="tl-note">{milestoneRemainingLabel(m)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <EvidenceDialog evidence={evidence} onClose={() => setEvidence(null)} />
    </>
  );
}
