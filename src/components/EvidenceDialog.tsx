import type { MomentumEvent, SummaryEvidence } from "@/types";
import { evidenceRefOf, eventRepo, eventTitle } from "@/lib/dayFact";
import { formatDateTimeCn } from "@/lib/date";
import { Dialog, Notice } from "@/components/ui";
import { useMomentum } from "@/store/state";

const KIND_LABEL: Record<string, string> = {
  commit: "提交",
  note: "笔记",
  activity: "活动",
};

export function EvidenceChips({
  items,
  onOpen,
}: {
  items: SummaryEvidence[];
  onOpen: (item: SummaryEvidence) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="evidence-row" aria-label="证据">
      {items.map((item, index) => (
        <button
          type="button"
          key={`${item.ref}-${index}`}
          className="chip"
          onClick={() => onOpen(item)}
          title="查看证据"
        >
          <span className="chip-kind">{item.kind === "github" ? "GitHub" : item.kind === "manual" ? "手动" : item.kind}</span>
          {item.ref}
        </button>
      ))}
    </div>
  );
}

export function EvidenceDialog({
  evidence,
  onClose,
}: {
  evidence: SummaryEvidence | null;
  onClose: () => void;
}) {
  const { snap } = useMomentum();
  const event = evidence && snap ? snap.events.find((e) => evidenceRefOf(e) === evidence.ref) : undefined;

  return (
    <Dialog open={evidence !== null} onClose={onClose} title="证据">
      {evidence ? (
        <div className="stack-sm">
          <div className="row" style={{ gap: 8 }}>
            <span className="badge">{KIND_LABEL[event?.kind ?? ""] ?? evidence.kind}</span>
            <span className="hash">{evidence.ref}</span>
          </div>
          {event ? <EventDetail event={event} /> : <Notice>这条证据不在当前本地事件中，可能来自已归档的历史数据。</Notice>}
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </Dialog>
  );
}

function EventDetail({ event }: { event: MomentumEvent }) {
  const { snap } = useMomentum();
  const stage = snap?.stages.find((s) => s.id === event.stageId);
  const project = snap?.projects.find((p) => p.id === (stage?.projectId ?? event.projectId));
  const repo = eventRepo(event);
  const rows: [string, string][] = [
    ["时间", formatDateTimeCn(event.ts)],
    ["来源", event.source === "github" ? "GitHub" : event.source === "manual" ? "手动录入" : "导入"],
    ["归因", project ? `${project.name}${stage ? ` · ${stage.name}` : " · 未归阶段"}` : "未归类"],
    ["置信度", event.confidence.toFixed(2)],
  ];
  if (repo) rows.splice(2, 0, ["仓库", repo]);
  return (
    <div className="stack-sm">
      <p style={{ fontSize: 15, lineHeight: 1.6 }}>{eventTitle(event)}</p>
      <dl style={{ margin: 0, display: "grid", gap: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 10 }}>
            <dt className="muted" style={{ fontSize: 12.5 }}>
              {k}
            </dt>
            <dd style={{ margin: 0, fontSize: 13.5 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
