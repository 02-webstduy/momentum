import type { Milestone, MomentumEvent, Project, Stage } from "@/types";

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function eventText(event: MomentumEvent): string {
  const parts = [event.payload.message, event.payload.text, event.payload.repo, event.payload.ref];
  return parts.filter((p): p is string => typeof p === "string").join(" ").toLowerCase();
}

export function autoAttribute(
  event: MomentumEvent,
  projects: Project[],
  stages: Stage[],
  milestones: Milestone[],
): { projectId?: string; stageId?: string } {
  const text = eventText(event);
  if (!text) return {};

  let bestProject: string | undefined;
  let bestScore = 0;
  for (const project of projects) {
    let score = 0;
    for (const token of tokens(project.name)) {
      if (text.includes(token)) score += 2;
    }
    for (const token of tokens(project.goal)) {
      if (token.length >= 3 && text.includes(token)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestProject = project.id;
    }
  }

  let bestStage: string | undefined;
  let bestStageScore = 0;
  for (const stage of stages) {
    if (bestProject && stage.projectId !== bestProject) continue;
    const keywords = [stage.name, ...milestones.filter((m) => m.stageId === stage.id).map((m) => m.name)];
    let score = 0;
    for (const keyword of keywords) {
      for (const token of tokens(keyword)) {
        if (token.length >= 2 && text.includes(token)) score += 1;
      }
    }
    if (score > bestStageScore) {
      bestStageScore = score;
      bestStage = stage.id;
    }
  }

  if (!bestProject && !bestStage) return {};
  const stage = stages.find((s) => s.id === bestStage);
  const projectId = bestProject ?? stage?.projectId;
  return {
    ...(projectId ? { projectId } : {}),
    ...(bestStage ? { stageId: bestStage } : {}),
  };
}

export function projectStages(stages: Stage[], projectId: string): Stage[] {
  return stages.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
}

export function stageMilestones(milestones: Milestone[], stageId: string): Milestone[] {
  return milestones.filter((m) => m.stageId === stageId);
}
