import type { MomentumEvent } from "@/types";

const KINDS = new Set<MomentumEvent["kind"]>(["commit", "note", "activity"]);
const SOURCES = new Set<MomentumEvent["source"]>(["github", "manual", "import"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function parseImport(text: string): { events: MomentumEvent[]; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.events) ? raw.events : null;
  if (!list) throw new Error("需要 { events: [...] } 格式。");

  const events: MomentumEvent[] = [];
  let skipped = 0;
  list.forEach((item, index) => {
    if (!isRecord(item)) {
      skipped += 1;
      return;
    }
    const ts = typeof item.ts === "string" ? item.ts : null;
    const kind = typeof item.kind === "string" && KINDS.has(item.kind as MomentumEvent["kind"]) ? (item.kind as MomentumEvent["kind"]) : null;
    if (!ts || Number.isNaN(new Date(ts).getTime()) || !kind) {
      skipped += 1;
      return;
    }
    const payload = isRecord(item.payload) ? item.payload : {};
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id
        : `import:${typeof payload.sha === "string" ? payload.sha : `${new Date(ts).getTime()}-${index}`}`;
    const source =
      typeof item.source === "string" && SOURCES.has(item.source as MomentumEvent["source"])
        ? (item.source as MomentumEvent["source"])
        : "import";
    events.push({
      id,
      ts,
      duration: typeof item.duration === "number" && item.duration >= 0 ? item.duration : 0,
      source,
      kind,
      payload,
      projectId: typeof item.projectId === "string" ? item.projectId : undefined,
      stageId: typeof item.stageId === "string" ? item.stageId : undefined,
      origin: item.origin === "auto" || item.origin === "user" ? item.origin : "user",
      confidence: typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1 ? item.confidence : 0.8,
    });
  });
  return { events, skipped };
}

export const GIT_LOG_SNIPPET = `git log --since="14 days ago" \\
  --pretty=format:'{"id":"%H","ts":"%aI","duration":0,"source":"import","kind":"commit","payload":{"sha":"%H","message":"%s"},"origin":"user","confidence":0.8}' \\
  > momentum-commits.jsonl

node -e "const fs=require('fs');const rows=fs.readFileSync('momentum-commits.jsonl','utf8').split('\\n').filter(Boolean).map(JSON.parse);fs.writeFileSync('momentum-events.json',JSON.stringify({events:rows}))"`;
