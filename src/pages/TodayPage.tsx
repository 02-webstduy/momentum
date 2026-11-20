import { useMemo, useRef, useState, type FormEvent } from "react";
import type { DaySummary, MomentumEvent, SummaryEvidence } from "@/types";
import { useMomentum } from "@/store/state";
import { dateKeyOf, formatCnDate, formatClock, formatDateTimeCn, todayKey, weekdayCn } from "@/lib/date";
import { buildDayFact, commitsOnDate, eventRepo, eventTitle, evidenceRefOf } from "@/lib/dayFact";
import { milestoneCompletion, milestoneRemainingLabel, withAchievedValues } from "@/lib/progress";
import { autoAttribute } from "@/lib/attribution";
import { AgentError, requestDaySummary } from "@/agent/client";
import { buildLocalSummary } from "@/agent/fallback";
import {
  GithubError,
  cachedGithubAt,
  fetchTodayCommits,
  readGithubSettings,
  writeGithubSettings,
} from "@/github/client";
import { GIT_LOG_SNIPPET, parseImport } from "@/lib/import";
import { EvidenceChips, EvidenceDialog } from "@/components/EvidenceDialog";
import { Dialog, DemoBadge, EmptyState, Notice, Spinner, UploadIcon, CloseIcon } from "@/components/ui";
import { Link } from "@/router";

type Message = { tone: "warn" | "error" | "success"; text: string };

function provenanceOf(summary: DaySummary): { text: string; cls: string } {
  if (summary.agentRunId === "demo:seed") return { text: "演示数据", cls: "badge-demo" };
  if (summary.agentRunId.startsWith("local")) return { text: "本地降级 · AI 未连接", cls: "badge-warm" };
  return { text: "Cloud Agent", cls: "badge-ahead" };
}

export function TodayPage() {
  const {
    snap,
    ready,
    busy,
    activeProject,
    notify,
    loadDemo,
    resetAll,
    addManual,
    appendEvents,
    correctAttribution,
    saveSummary,
    dismissCheer,
    setCheerEnabled,
  } = useMomentum();

  const today = todayKey();
  const [manualText, setManualText] = useState("");
  const manualRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<SummaryEvidence | null>(null);
  const [attrEvent, setAttrEvent] = useState<MomentumEvent | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"demo" | "reset" | null>(null);
  const [importMsg, setImportMsg] = useState<Message | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const ghSettings = useMemo(() => readGithubSettings(), []);
  const [ghUser, setGhUser] = useState(ghSettings.username);
  const [ghToken, setGhToken] = useState(ghSettings.token);
  const [ghBusy, setGhBusy] = useState(false);
  const [ghMsg, setGhMsg] = useState<Message | null>(null);
  const [cacheAt, setCacheAt] = useState<string | null>(() => (ghSettings.username ? cachedGithubAt(ghSettings.username) : null));

  const fact = useMemo(() => (snap ? buildDayFact(today, snap.events) : null), [snap, today]);
  const summary = snap?.summaries[today];
  const todaysEvents = useMemo(
    () =>
      snap
        ? snap.events
            .filter((e) => dateKeyOf(e.ts) === today)
            .slice()
            .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
        : [],
    [snap, today],
  );
  const cheers = useMemo(() => {
    if (!snap || !snap.meta.cheerEnabled) return [];
    return Object.values(snap.cheers)
      .filter((c) => !c.dismissed)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }, [snap]);

  if (!ready || !snap || !fact) {
    return (
      <div className="stack">
        <div className="skeleton skeleton-line" style={{ width: 180, height: 22 }} />
        <div className="card card-pad">
          <div className="skeleton skeleton-line" style={{ width: "80%" }} />
          <div className="skeleton skeleton-line" style={{ width: "64%" }} />
          <div className="skeleton skeleton-line" style={{ width: "70%" }} />
        </div>
      </div>
    );
  }

  const commits = commitsOnDate(snap.events, today);
  const visibleEvents = showAllEvents ? todaysEvents : todaysEvents.slice(0, 8);

  const generateSummary = async () => {
    if (!fact.hasData || generating) return;
    setGenerating(true);
    setAgentMessage(null);
    const ms = withAchievedValues(snap.milestones, snap.events);
    const incomplete = ms
      .filter((m) => milestoneCompletion(m) < 1)
      .map((m) => ({
        name: m.name,
        stage: snap.stages.find((s) => s.id === m.stageId)?.name ?? "未归属阶段",
        remaining: milestoneRemainingLabel(m),
      }));
    const dayEvents = snap.events.filter((e) => dateKeyOf(e.ts) === today);
    const factsText = [
      `日期：${today}`,
      `有效工作段：${fact.sessions}`,
      `关联仓库：${fact.activeRepos}`,
      `提交：${commits}`,
      `连续活跃：${fact.streak} 天`,
      "事件（ref 供 evidence 字段使用）：",
      ...dayEvents
        .slice(0, 16)
        .map((e) => `- ${evidenceRefOf(e)} ${formatClock(e.ts)} ${eventRepo(e) ? `[${eventRepo(e)}] ` : ""}${eventTitle(e)}`),
      "未完成里程碑：",
      ...incomplete.slice(0, 10).map((m) => `- ${m.stage} / ${m.name}（${m.remaining}）`),
    ].join("\n");

    try {
      const { payload, runId } = await requestDaySummary({
        date: today,
        facts: {
          sessions: fact.sessions,
          activeRepos: fact.activeRepos,
          commits,
          streak: fact.streak,
          evidenceRefs: fact.evidenceRefs,
        },
        refs: fact.evidenceRefs,
        incompleteMilestones: incomplete.map((m) => m.name),
        factsText,
      });
      await saveSummary({
        date: today,
        ...payload,
        agentRunId: runId,
        status: "ok",
        generatedAt: new Date().toISOString(),
      });
      notify("今日总结已生成。", "success");
    } catch (err) {
      const reason = err instanceof AgentError ? err.userMessage : "Cloud Agent 调用失败。";
      await saveSummary(buildLocalSummary(today, snap.events, snap.stages, ms));
      setAgentMessage(`${reason} 已使用本地模板按今天的事实生成总结，可稍后重试。`);
    } finally {
      setGenerating(false);
    }
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    const text = manualText.trim();
    if (!text) return;
    await addManual(text);
    setManualText("");
  };

  const runGithubFetch = async () => {
    if (!ghUser.trim() || ghBusy) return;
    setGhBusy(true);
    setGhMsg(null);
    writeGithubSettings(ghUser, ghToken);
    try {
      const result = await fetchTodayCommits(ghUser, ghToken, {
        projects: snap.projects,
        stages: snap.stages,
        milestones: snap.milestones,
      });
      setCacheAt(result.fetchedAt);
      const added = await appendEvents(result.events);
      if (result.events.length === 0) {
        setGhMsg({ tone: "warn", text: "GitHub 上没有今天的 PushEvent，可以用手动录入补充。" });
      } else if (added === 0) {
        setGhMsg({ tone: "warn", text: `今日 ${result.events.length} 条提交都已在本地，无需重复合并。` });
      } else {
        setGhMsg({
          tone: "success",
          text: result.cached ? `使用 30 分钟内的缓存，合并 ${added} 条今日提交。` : `拉取成功，新增 ${added} 条今日提交。`,
        });
      }
    } catch (err) {
      setGhMsg({ tone: "error", text: err instanceof GithubError ? err.userMessage : "GitHub 拉取失败，已降级为手动录入。" });
    } finally {
      setGhBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setImportMsg(null);
    try {
      const parsed = parseImport(await file.text());
      if (parsed.events.length === 0) {
        setImportMsg({ tone: "error", text: `文件里没有可用事件${parsed.skipped ? `（跳过 ${parsed.skipped} 条无效记录）` : ""}。` });
        return;
      }
      const enriched = parsed.events.map((event) => {
        if (event.projectId || event.stageId) return event;
        const attr = autoAttribute(event, snap.projects, snap.stages, snap.milestones);
        return { ...event, ...attr };
      });
      const added = await appendEvents(enriched);
      setImportMsg({
        tone: "success",
        text: `导入完成：新增 ${added} 条事件${parsed.skipped ? `，跳过 ${parsed.skipped} 条无效记录` : ""}。`,
      });
    } catch (err) {
      setImportMsg({ tone: "error", text: err instanceof Error ? err.message : "导入失败。" });
    }
  };

  const handleConfirm = async () => {
    const mode = confirmMode;
    setConfirmMode(null);
    if (mode === "demo") await loadDemo();
    if (mode === "reset") await resetAll();
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-main">
          <div className="eyebrow">
            <span>
              {formatCnDate(today)} · {weekdayCn(today)}
            </span>
            <DemoBadge show={snap.meta.demo} />
          </div>
          <h1 className="h1">今天</h1>
          <p className="lede">
            {activeProject
              ? `项目「${activeProject.name}」的进度只由里程碑规则计算，今天的事实会进入事件流。`
              : "先用一句话开始记录，或在下方加载演示数据查看完整形态。"}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => manualRef.current?.focus()}>
          记录一句
        </button>
      </div>

      {cheers.map((cheer) => (
        <div className="cheer fade-in" key={cheer.milestoneId}>
          <div className="cheer-body">
            <div className="cheer-kicker">里程碑达成</div>
            <p className="cheer-text">{cheer.text}</p>
          </div>
          <button
            type="button"
            className="cheer-close"
            onClick={() => dismissCheer(cheer.milestoneId)}
            aria-label="关闭这条鼓励"
          >
            <CloseIcon />
          </button>
        </div>
      ))}

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-top">连续活跃</div>
          <div className="stat-value">
            {fact.streak}
            <small>天</small>
          </div>
          <div className="stat-note">含今天的连续工作天数</div>
        </div>
        <div className="stat">
          <div className="stat-top">有效工作段</div>
          <div className="stat-value">
            {fact.sessions}
            <small>段</small>
          </div>
          <div className="stat-note">间隔 30 分钟内合并</div>
        </div>
        <div className="stat">
          <div className="stat-top">关联仓库</div>
          <div className="stat-value">
            {fact.activeRepos}
            <small>个</small>
          </div>
          <div className="stat-note">来自今日事件</div>
        </div>
        <div className="stat">
          <div className="stat-top">今日提交</div>
          <div className="stat-value">
            {commits}
            <small>次</small>
          </div>
          <div className="stat-note">只作事实记录，不直接换算进度</div>
        </div>
      </div>

      {!fact.hasData ? (
        <div className="section">
          <EmptyState
            mark="—"
            title="今天还没有自动采集到数据"
            actions={
              <>
                <button type="button" className="btn btn-primary" onClick={() => manualRef.current?.focus()}>
                  手动记录一句
                </button>
                <button type="button" className="btn" onClick={() => void loadDemo()} disabled={busy}>
                  加载演示数据
                </button>
                <Link to="/decompose" className="btn btn-ghost">
                  先建立项目
                </Link>
              </>
            }
          >
            可以接上 GitHub、导入 JSON，或直接写一句话。没有数据时，不会生成任何 AI 内容。
          </EmptyState>
        </div>
      ) : (
        <div className="section">
          <div className="section-head">
            <h2 className="h2">今日总结</h2>
            <span className="section-note">只转述事实，每条 highlight 都能点开查看依据</span>
          </div>

          {agentMessage ? <div style={{ marginBottom: 12 }}><Notice>{agentMessage}</Notice></div> : null}

          {generating ? (
            <div className="summary-card" role="status" aria-live="polite">
              <div className="row" style={{ gap: 10 }}>
                <Spinner label="正在根据今日事实生成总结" />
              </div>
              <div style={{ marginTop: 18 }}>
                <div className="skeleton skeleton-line" style={{ width: "86%" }} />
                <div className="skeleton skeleton-line" style={{ width: "72%" }} />
                <div className="skeleton skeleton-line" style={{ width: "54%" }} />
              </div>
            </div>
          ) : summary ? (
            <article className="summary-card fade-in">
              <div className="card-head" style={{ marginBottom: 6 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="card-kicker">今日事实</span>
                  <span className={`badge ${provenanceOf(summary).cls}`}>{provenanceOf(summary).text}</span>
                </div>
                <span className="hint">生成于 {formatClock(summary.generatedAt)}</span>
              </div>
              <p className="summary-narrative">{summary.narrative}</p>
              <ol className="hl-list">
                {summary.highlights.slice(0, 5).map((highlight, index) => (
                  <li key={`${highlight}-${index}`}>
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
              <div className="summary-sub">
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
              <div className="card-head" style={{ marginTop: 18, marginBottom: 0 }}>
                <span className="card-kicker">证据</span>
                <span className="hint">点击查看原始事件</span>
              </div>
              <EvidenceChips items={summary.evidence} onOpen={setEvidence} />
              {provenanceOf(summary).text.includes("本地降级") ? (
                <p className="hint" style={{ marginTop: 10 }}>
                  预览环境未连接 Cloud Agent。降级内容由本地模板按事实生成，不包含任何推测。
                </p>
              ) : null}
              <div className="row" style={{ marginTop: 14 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void generateSummary()} disabled={generating}>
                  重新生成总结
                </button>
              </div>
            </article>
          ) : (
            <div className="summary-card">
              <div className="card-head" style={{ marginBottom: 4 }}>
                <span className="card-kicker">今日事实</span>
                <span className="hint">还没有生成总结</span>
              </div>
              <p className="summary-narrative" style={{ fontSize: 15 }}>
                总结只转述今天的事件与里程碑状态，不会编造内容。
              </p>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => void generateSummary()}>
                  生成今日总结
                </button>
                <span className="hint">通过 Qoder Cloud Agent 异步生成；未连接时使用本地降级。</span>
              </div>
            </div>
          )}
        </div>
      )}

      <form className="card card-pad section" onSubmit={(event) => void submitManual(event)}>
        <div className="row-between">
          <div>
            <h2 className="h3">手动补录</h2>
            <p className="hint" style={{ marginTop: 4 }}>
              一行话即可。没有匹配到项目时归入「未归类」，之后可一键纠正。
            </p>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input
            ref={manualRef}
            className="input"
            style={{ flex: 1, minWidth: 220 }}
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder="例：完成分解页的锁定卡与哈希展示"
            aria-label="手动补录内容"
            maxLength={200}
          />
          <button type="submit" className="btn btn-primary" disabled={!manualText.trim() || busy}>
            记录
          </button>
        </div>
      </form>

      {todaysEvents.length > 0 ? (
        <div className="section">
          <div className="section-head">
            <h2 className="h2">今日事件</h2>
            <span className="section-note">
              {todaysEvents.length} 条 · 按时间排序 · 归因可纠正
            </span>
          </div>
          <div className="card card-pad">
            <div className="event-list">
              {visibleEvents.map((event) => {
                const stage = snap.stages.find((s) => s.id === event.stageId);
                const project = snap.projects.find((p) => p.id === (stage?.projectId ?? event.projectId));
                return (
                  <div className="event-row" key={event.id}>
                    <div className="event-time">{formatClock(event.ts)}</div>
                    <div>
                      <div className="event-title">{eventTitle(event)}</div>
                      <div className="event-meta">
                        <span>{event.source === "github" ? "GitHub" : event.source === "manual" ? "手动" : "导入"}</span>
                        {eventRepo(event) ? <span>{eventRepo(event)}</span> : null}
                        <span>{event.kind === "commit" ? "提交" : event.kind === "note" ? "笔记" : "活动"}</span>
                      </div>
                    </div>
                    <div className="event-attr">
                      <span className={`badge ${project ? "" : "badge-warm"}`}>
                        {project ? `${project.name}${stage ? ` · ${stage.name}` : ""}` : "未归类"}
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttrEvent(event)}>
                        纠正
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {todaysEvents.length > 8 ? (
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAllEvents((v) => !v)}>
                  {showAllEvents ? "收起" : `查看全部 ${todaysEvents.length} 条`}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="section">
        <details className="disclosure">
          <summary>
            采集与设置
            <span className="chev">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </summary>
          <div className="disclosure-body stack">
            <div className="stack-sm">
              <h3 className="h3">GitHub 自动采集</h3>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="gh-user">
                    GitHub 用户名
                  </label>
                  <input
                    id="gh-user"
                    className="input"
                    value={ghUser}
                    onChange={(event) => setGhUser(event.target.value)}
                    placeholder="octocat"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="gh-token">
                    只读 Token（可选）
                  </label>
                  <input
                    id="gh-token"
                    className="input"
                    type="password"
                    value={ghToken}
                    onChange={(event) => setGhToken(event.target.value)}
                    placeholder="fine-grained PAT"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="actions">
                <button type="button" className="btn" onClick={() => void runGithubFetch()} disabled={ghBusy || !ghUser.trim()}>
                  {ghBusy ? <Spinner label="拉取中" /> : "拉取今日提交"}
                </button>
                {cacheAt ? <span className="hint">上次拉取 {formatDateTimeCn(cacheAt)} · 缓存 30 分钟</span> : null}
              </div>
              <p className="hint">
                只读取公开 PushEvent；Token 仅存本机 localStorage，绝不上传。请求失败时自动降级为手动录入并说明原因。
              </p>
              {ghMsg ? <Notice tone={ghMsg.tone}>{ghMsg.text}</Notice> : null}
            </div>

            <div className="stack-sm">
              <h3 className="h3">导入 JSON</h3>
              <label
                className={`dropzone${dragOver ? " is-over" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void handleImportFile(file);
                }}
              >
                <input
                  type="file"
                  accept="application/json,.json"
                  className="visually-hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleImportFile(file);
                    event.target.value = "";
                  }}
                />
                <span className="row" style={{ justifyContent: "center", gap: 8 }}>
                  <UploadIcon />
                  拖入 {"{ events: [...] }"} 文件，或点击选择
                </span>
              </label>
              <details>
                <summary className="hint" style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center" }}>
                  从本地 git log 导出的做法
                </summary>
                <pre className="code" style={{ marginTop: 8 }}>{GIT_LOG_SNIPPET}</pre>
              </details>
              {importMsg ? <Notice tone={importMsg.tone}>{importMsg.text}</Notice> : null}
            </div>

            <div className="stack-sm">
              <h3 className="h3">演示与本地数据</h3>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => (snap.events.length > 0 ? setConfirmMode("demo") : void loadDemo())}
                  disabled={busy}
                >
                  加载演示数据
                </button>
                <button type="button" className="btn btn-danger" onClick={() => setConfirmMode("reset")} disabled={busy}>
                  清除本地数据
                </button>
              </div>
              <label className="row" style={{ minHeight: 44, gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={snap.meta.cheerEnabled}
                  onChange={(event) => void setCheerEnabled(event.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "var(--site-accent)" }}
                />
                <span>里程碑达成时显示一句鼓励（每条只出现一次）</span>
              </label>
              <p className="hint">
                演示数据会覆盖当前本地数据，并全程标注「演示数据」。所有内容写入 IndexedDB（前缀 momentum:v1:），不经过任何后端。
              </p>
            </div>
          </div>
        </details>
      </div>

      <EvidenceDialog evidence={evidence} onClose={() => setEvidence(null)} />

      {attrEvent ? (
        <AttributionDialog
          key={attrEvent.id}
          event={attrEvent}
          onClose={() => setAttrEvent(null)}
          onSave={correctAttribution}
        />
      ) : null}

      <Dialog
        open={confirmMode !== null}
        onClose={() => setConfirmMode(null)}
        title={confirmMode === "demo" ? "加载演示数据？" : "清除本地数据？"}
      >
        <p style={{ fontSize: 14.5, lineHeight: 1.65 }}>
          {confirmMode === "demo"
            ? "这会清空当前本地数据，并写入 1 个项目、5 个阶段、12 个里程碑与约 14 天事件。演示内容会被明确标注。"
            : "这会删除此浏览器中 Momentum 的全部本地数据，包括项目、阶段、事件、总结与归档。该操作不可撤销。"}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => setConfirmMode(null)}>
            取消
          </button>
          <button
            type="button"
            className={confirmMode === "demo" ? "btn btn-primary" : "btn btn-danger"}
            onClick={() => void handleConfirm()}
          >
            {confirmMode === "demo" ? "覆盖并加载" : "确认清除"}
          </button>
        </div>
      </Dialog>
    </>
  );
}

function AttributionDialog({
  event,
  onClose,
  onSave,
}: {
  event: MomentumEvent;
  onClose: () => void;
  onSave: (eventId: string, projectId: string | null, stageId: string | null) => Promise<void>;
}) {
  const { snap } = useMomentum();
  const eventStage = snap?.stages.find((s) => s.id === event.stageId);
  const [projectId, setProjectId] = useState(event.projectId ?? eventStage?.projectId ?? "");
  const [stageId, setStageId] = useState(event.stageId ?? "");
  const [saving, setSaving] = useState(false);
  const projects = snap?.projects ?? [];
  const stages = (snap?.stages ?? []).filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(event.id, projectId || null, stageId || null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="纠正事件归因">
      <p className="hint" style={{ marginBottom: 12 }}>
        {formatDateTimeCn(event.ts)} · {eventTitle(event)}
      </p>
      <div className="stack-sm">
        <div className="field">
          <label className="label" htmlFor="attr-project">
            项目
          </label>
          <select
            id="attr-project"
            className="select"
            value={projectId}
            onChange={(event2) => {
              setProjectId(event2.target.value);
              setStageId("");
            }}
          >
            <option value="">未归类</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="attr-stage">
            阶段
          </label>
          <select
            id="attr-stage"
            className="select"
            value={stageId}
            onChange={(event2) => setStageId(event2.target.value)}
            disabled={!projectId}
          >
            <option value="">未归阶段</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">手动纠正的优先级高于自动归因，进度会立即按新的归属重算。</p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Spinner label="保存中" /> : "保存归因"}
        </button>
      </div>
    </Dialog>
  );
}
