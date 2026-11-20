import { useEffect, useId, useRef, type ReactNode } from "react";

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" width="19" height="19" aria-hidden="true">
      <path
        d="M5 24h6v-6h6v-6h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDown({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.2" y="7" width="9.6" height="6.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5.4a2.5 2.5 0 015 0V7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UploadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 10V3M5 5.5L8 2.5l3 3M3 11v2h10v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ label = "处理中" }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <svg className="spin" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </span>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => boxRef.current?.focus(), 20);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={boxRef}
        style={wide ? { maxWidth: 720 } : undefined}
      >
        <div className="dialog-head">
          <h2 className="h2" id={titleId}>
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Notice({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "error" | "success";
  children: ReactNode;
}) {
  return <div className={`notice${tone === "error" ? " notice-error" : tone === "success" ? " notice-success" : ""}`}>{children}</div>;
}

export function EmptyState({
  mark,
  title,
  children,
  actions,
}: {
  mark: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        {mark}
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  expected,
  label = "实际进度",
}: {
  value: number;
  expected: number | null;
  label?: string;
}) {
  const pct = Math.round(value * 1000) / 10;
  const expectedPct = expected === null ? null : Math.round(expected * 1000) / 10;
  const expectedLeft = expected === null ? 0 : Math.min(95, Math.max(5, expected * 100));
  return (
    <div className="progress-wrap">
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
        {expectedPct !== null ? (
          <div className="progress-expected" style={{ left: `${expectedLeft}%` }}>
            <span className="progress-expected-label">今天应到 {expectedPct}%</span>
          </div>
        ) : null}
      </div>
      <div className="progress-meta">
        <span>实际 {pct}%</span>
        <span>{expectedPct === null ? "时间进度 —" : `时间进度 ${expectedPct}%`}</span>
      </div>
    </div>
  );
}

export function TrendText({ trend }: { trend: number | null }) {
  if (trend === null) return <span className="muted">—</span>;
  const positive = trend > 0.005;
  const negative = trend < -0.005;
  const word = positive ? "上升" : negative ? "下降" : "持平";
  const arrow = positive ? "↑" : negative ? "↓" : "→";
  return (
    <span className="tabular" style={{ color: positive ? "var(--site-accent)" : negative ? "var(--behind)" : undefined }}>
      {arrow} {word} {Math.abs(trend * 100).toFixed(1)} 个百分点
    </span>
  );
}

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="badge badge-demo" title="当前内容来自内置演示数据">
      <span className="dot" />
      演示数据
    </span>
  );
}
