import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ArchivedVersion,
  Cheer,
  DaySummary,
  DecompositionDraft,
  GeneratedBy,
  Meta,
  Milestone,
  MomentumEvent,
  PlanComparison,
  PlanStage,
  Project,
  Snapshot,
  Stage,
} from "@/types";
import { emptyMeta } from "@/types";
import { KEYS, clearAll, loadSnapshot, put, remove, replaceAll } from "@/store/repo";
import { buildDemoSnapshot } from "@/store/demo";
import { buildCheerText } from "@/agent/fallback";
import { autoAttribute } from "@/lib/attribution";
import { firstAchievedAt } from "@/lib/progress";
import { decompositionHash } from "@/lib/hash";

export type NoticeTone = "info" | "success" | "error";

export interface Notice {
  id: number;
  text: string;
  tone: NoticeTone;
}

export interface ProjectFields {
  name: string;
  goal: string;
  startDate: string;
  targetDate: string;
}

interface MomentumContextValue {
  snap: Snapshot | null;
  ready: boolean;
  busy: boolean;
  notice: Notice | null;
  activeProject: Project | null;
  notify: (text: string, tone?: NoticeTone) => void;
  reload: () => Promise<void>;
  loadDemo: () => Promise<void>;
  resetAll: () => Promise<void>;
  addManual: (text: string) => Promise<void>;
  appendEvents: (events: MomentumEvent[]) => Promise<number>;
  correctAttribution: (eventId: string, projectId: string | null, stageId: string | null) => Promise<void>;
  saveSummary: (summary: DaySummary) => Promise<void>;
  dismissCheer: (milestoneId: string) => Promise<void>;
  setCheerEnabled: (value: boolean) => Promise<void>;
  setManualState: (milestoneId: string, state: 0 | 0.5 | 1) => Promise<void>;
  createProject: (fields: ProjectFields) => Promise<string>;
  updateProject: (projectId: string, fields: ProjectFields) => Promise<void>;
  saveDraft: (draft: DecompositionDraft) => Promise<void>;
  lockPlan: (projectId: string, stages: PlanStage[], generatedBy: GeneratedBy, comparison?: PlanComparison) => Promise<string>;
  projectStages: (projectId: string) => Stage[];
  projectMilestones: (projectId: string) => Milestone[];
}

const MomentumContext = createContext<MomentumContextValue | null>(null);

async function syncDerived(snap: Snapshot): Promise<Snapshot> {
  const patches: Record<string, unknown> = {};
  const achievements = new Map<string, string>();

  for (const m of snap.milestones) {
    if (m.achievedAt) continue;
    if (m.type === "metric") {
      const achieved = firstAchievedAt(m, snap.events);
      if (achieved) achievements.set(m.id, achieved);
    } else if (m.manualState === 1) {
      achievements.set(m.id, new Date().toISOString());
    }
  }

  let milestones = snap.milestones;
  if (achievements.size > 0) {
    milestones = milestones.map((m) => {
      const ts = achievements.get(m.id);
      if (!ts) return m;
      const next = { ...m, achievedAt: ts };
      patches[KEYS.milestone(m.id)] = next;
      return next;
    });
  }

  let cheers = snap.cheers;
  if (snap.meta.cheerEnabled) {
    for (const m of milestones) {
      if (!m.achievedAt || cheers[m.id]) continue;
      const stage = snap.stages.find((s) => s.id === m.stageId);
      const project = snap.projects.find((p) => p.id === stage?.projectId);
      const cheer: Cheer = {
        milestoneId: m.id,
        text: buildCheerText(m, stage, project),
        generatedAt: m.achievedAt,
        dismissed: false,
      };
      cheers = { ...cheers, [m.id]: cheer };
      patches[KEYS.cheer(m.id)] = cheer;
    }
  }

  if (Object.keys(patches).length > 0) await put(patches);
  return { ...snap, milestones, cheers };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function MomentumProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  const notify = useCallback((text: string, tone: NoticeTone = "info") => {
    const id = Date.now() + Math.random();
    setNotice({ id, text, tone });
    window.setTimeout(() => {
      setNotice((current) => (current && current.id === id ? null : current));
    }, 6000);
  }, []);

  const reload = useCallback(async () => {
    const loaded = await loadSnapshot();
    const synced = await syncDerived(loaded);
    setSnap(synced);
  }, []);

  useEffect(() => {
    let cancelled = false;
    reload()
      .catch(() => {
        if (!cancelled) notify("本地数据读取失败，已切换为空白状态。", "error");
        if (!cancelled) setSnap({ projects: [], stages: [], milestones: [], events: [], summaries: {}, cheers: {}, archives: {}, drafts: {}, attributions: {}, meta: emptyMeta() });
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, notify]);

  const runBusy = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }, []);

  const loadDemo = useCallback(async () => {
    await runBusy(async () => {
      const demo = await buildDemoSnapshot();
      await replaceAll(demo);
      await reload();
      notify("演示数据已加载，页面中的示例内容均已标注。", "success");
    });
  }, [notify, reload, runBusy]);

  const resetAll = useCallback(async () => {
    await runBusy(async () => {
      await clearAll();
      await reload();
      notify("本地数据已清除。");
    });
  }, [notify, reload, runBusy]);

  const addManual = useCallback(
    async (text: string) => {
      const current = snapRef.current;
      if (!current) return;
      const event: MomentumEvent = {
        id: newId("manual"),
        ts: new Date().toISOString(),
        duration: 0,
        source: "manual",
        kind: "note",
        payload: { text: text.trim() },
        origin: "user",
        confidence: 1,
      };
      const attr = autoAttribute(event, current.projects, current.stages, current.milestones);
      await put({ [KEYS.event(event.id)]: { ...event, ...attr } });
      await reload();
      notify("已记录到今天。");
    },
    [notify, reload],
  );

  const appendEvents = useCallback(
    async (incoming: MomentumEvent[]) => {
      const current = snapRef.current;
      if (!current) return 0;
      const existing = new Set(current.events.map((e) => e.id));
      const fresh = incoming.filter((e) => !existing.has(e.id));
      if (fresh.length > 0) {
        const entries: Record<string, unknown> = {};
        for (const e of fresh) entries[KEYS.event(e.id)] = e;
        await put(entries);
        await reload();
      }
      return fresh.length;
    },
    [reload],
  );

  const correctAttribution = useCallback(
    async (eventId: string, projectId: string | null, stageId: string | null) => {
      await put({ [KEYS.attribution(eventId)]: { projectId, stageId } });
      await reload();
      notify("归因已更新，进度按新的归属重算。", "success");
    },
    [notify, reload],
  );

  const saveSummary = useCallback(async (summary: DaySummary) => {
    await put({ [KEYS.summary(summary.date)]: summary });
    const current = snapRef.current;
    if (current) setSnap({ ...current, summaries: { ...current.summaries, [summary.date]: summary } });
  }, []);

  const dismissCheer = useCallback(async (milestoneId: string) => {
    const current = snapRef.current;
    const cheer = current?.cheers[milestoneId];
    if (!current || !cheer) return;
    const next = { ...cheer, dismissed: true };
    await put({ [KEYS.cheer(milestoneId)]: next });
    setSnap({ ...current, cheers: { ...current.cheers, [milestoneId]: next } });
  }, []);

  const setCheerEnabled = useCallback(
    async (value: boolean) => {
      const current = snapRef.current;
      if (!current) return;
      const meta: Meta = { ...current.meta, cheerEnabled: value };
      await put({ [KEYS.meta]: meta });
      setSnap({ ...current, meta });
      notify(value ? "里程碑鼓励已开启。" : "里程碑鼓励已关闭，不再推送。");
    },
    [notify],
  );

  const setManualState = useCallback(
    async (milestoneId: string, state: 0 | 0.5 | 1) => {
      const current = snapRef.current;
      const milestone = current?.milestones.find((m) => m.id === milestoneId);
      if (!current || !milestone) return;
      if (milestone.achievedAt && state !== 1) return;
      const next: Milestone = {
        ...milestone,
        manualState: state,
        achievedAt: state === 1 && !milestone.achievedAt ? new Date().toISOString() : milestone.achievedAt,
      };
      await put({ [KEYS.milestone(milestoneId)]: next });
      await reload();
    },
    [reload],
  );

  const createProject = useCallback(
    async (fields: ProjectFields) => {
      const id = newId("p");
      const project: Project = {
        id,
        name: fields.name.trim(),
        goal: fields.goal.trim(),
        startDate: fields.startDate,
        targetDate: fields.targetDate,
        decompositionFrozen: false,
        decompositionVersion: 1,
      };
      await put({ [KEYS.project(id)]: project });
      await reload();
      return id;
    },
    [reload],
  );

  const updateProject = useCallback(
    async (projectId: string, fields: ProjectFields) => {
      const current = snapRef.current;
      const project = current?.projects.find((p) => p.id === projectId);
      if (!current || !project) return;
      const next: Project = {
        ...project,
        name: fields.name.trim(),
        goal: fields.goal.trim(),
        startDate: fields.startDate,
        targetDate: fields.targetDate,
      };
      await put({ [KEYS.project(projectId)]: next });
      await reload();
    },
    [reload],
  );

  const saveDraft = useCallback(async (draft: DecompositionDraft) => {
    await put({ [KEYS.draft(draft.projectId)]: draft });
    const current = snapRef.current;
    if (current) setSnap({ ...current, drafts: { ...current.drafts, [draft.projectId]: draft } });
  }, []);

  const lockPlan = useCallback(
    async (projectId: string, plan: PlanStage[], generatedBy: GeneratedBy, comparison?: PlanComparison) => {
      const current = snapRef.current;
      if (!current) throw new Error("data not ready");
      const project = current.projects.find((p) => p.id === projectId);
      if (!project) throw new Error("project not found");

      const now = new Date().toISOString();
      const hash = await decompositionHash(plan);
      const oldStages = current.stages.filter((s) => s.projectId === projectId);
      const oldByName = new Map(oldStages.map((s) => [s.name.trim(), s]));
      const reused = new Set<string>();
      const newStages: Stage[] = plan.map((s, index) => {
        const match = oldByName.get(s.name.trim());
        const id = match && !reused.has(match.id) ? match.id : s.id;
        if (match && !reused.has(match.id)) reused.add(match.id);
        return {
          id,
          projectId,
          name: s.name.trim(),
          weight: s.weight,
          order: index + 1,
          frozenAt: now,
        };
      });
      const newMilestones: Milestone[] = plan.flatMap((stage, index) =>
        stage.milestones.map((m) => ({
          id: m.id,
          stageId: newStages[index].id,
          name: m.name.trim(),
          weight: m.weight,
          type: m.type,
          metricKey: m.metricKey,
          targetValue: m.targetValue,
          targetDate: m.targetDate,
          manualState: m.manualState,
          hidden: m.hidden,
          ...(m.manualState === 1 ? { achievedAt: now } : {}),
        })),
      );

      const oldMilestones = current.milestones.filter((m) => oldStages.some((s) => s.id === m.stageId));
      const version = project.decompositionFrozen ? project.decompositionVersion + 1 : 1;
      const entries: Record<string, unknown> = {};
      const removalKeys: string[] = [];

      if (project.decompositionFrozen) {
        const archive: ArchivedVersion = {
          projectId,
          version: project.decompositionVersion,
          hash: project.decompositionHash ?? "",
          lockedAt: project.decompositionAt ?? now,
          stages: oldStages
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((s) => ({ ...s, milestones: oldMilestones.filter((m) => m.stageId === s.id) })),
        };
        entries[KEYS.archive(projectId, archive.version)] = archive;
      }

      for (const s of oldStages) removalKeys.push(KEYS.stage(s.id));
      for (const m of oldMilestones) removalKeys.push(KEYS.milestone(m.id));
      removalKeys.push(KEYS.draft(projectId));

      for (const s of newStages) entries[KEYS.stage(s.id)] = s;
      for (const m of newMilestones) entries[KEYS.milestone(m.id)] = m;

      const updatedProject: Project = {
        ...project,
        decompositionFrozen: true,
        decompositionHash: hash,
        decompositionAt: now,
        decompositionVersion: version,
      };
      entries[KEYS.project(projectId)] = updatedProject;

      const meta: Meta = {
        ...current.meta,
        generatedBy: { ...current.meta.generatedBy, [projectId]: generatedBy },
        comparisons: comparison ? { ...current.meta.comparisons, [projectId]: comparison } : current.meta.comparisons,
      };
      entries[KEYS.meta] = meta;

      if (removalKeys.length > 0) await remove(...removalKeys);
      await put(entries);
      await reload();
      return hash;
    },
    [reload],
  );

  const activeProject = useMemo(() => {
    if (!snap || snap.projects.length === 0) return null;
    const frozen = snap.projects.filter((p) => p.decompositionFrozen);
    const pool = frozen.length > 0 ? frozen : snap.projects;
    return (
      pool
        .slice()
        .sort((a, b) => (b.decompositionAt ?? b.startDate).localeCompare(a.decompositionAt ?? a.startDate))[0] ?? null
    );
  }, [snap]);

  const projectStages = useCallback(
    (projectId: string) =>
      (snap?.stages ?? []).filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order),
    [snap],
  );

  const projectMilestones = useCallback(
    (projectId: string) => {
      if (!snap) return [];
      const ids = new Set(snap.stages.filter((s) => s.projectId === projectId).map((s) => s.id));
      return snap.milestones.filter((m) => ids.has(m.stageId));
    },
    [snap],
  );

  const value: MomentumContextValue = {
    snap,
    ready,
    busy,
    notice,
    activeProject,
    notify,
    reload,
    loadDemo,
    resetAll,
    addManual,
    appendEvents,
    correctAttribution,
    saveSummary,
    dismissCheer,
    setCheerEnabled,
    setManualState,
    createProject,
    updateProject,
    saveDraft,
    lockPlan,
    projectStages,
    projectMilestones,
  };

  return <MomentumContext.Provider value={value}>{children}</MomentumContext.Provider>;
}

export function useMomentum(): MomentumContextValue {
  const ctx = useContext(MomentumContext);
  if (!ctx) throw new Error("useMomentum must be used inside MomentumProvider");
  return ctx;
}
