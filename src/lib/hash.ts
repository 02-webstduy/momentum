import type { PlanStage } from "@/types";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const v = record[key];
      if (v === undefined || v === null) continue;
      out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function planForHash(stages: PlanStage[]) {
  return {
    stages: stages.map((s) => ({
      name: s.name.trim(),
      weight: s.weight,
      milestones: s.milestones.map((m) => ({
        name: m.name.trim(),
        weight: m.weight,
        type: m.type,
        ...(m.type === "metric" ? { metricKey: m.metricKey, targetValue: m.targetValue } : {}),
      })),
    })),
  };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function decompositionHash(stages: PlanStage[]): Promise<string> {
  const hex = await sha256Hex(canonicalJson(planForHash(stages)));
  return hex.slice(0, 8);
}
