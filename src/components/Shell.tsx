import type { ReactNode } from "react";
import { Link, useRouter } from "@/router";
import { useMomentum } from "@/store/state";
import { BrandMark, DemoBadge } from "@/components/ui";

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRouter();
  const { snap, activeProject } = useMomentum();
  const projectPath = activeProject ? `/project/${activeProject.id}` : "/project";
  const items = [
    { label: "今日", to: "/", match: (p: string) => p === "/" },
    { label: "进度", to: projectPath, match: (p: string) => p.startsWith("/project") },
    { label: "分解", to: "/decompose", match: (p: string) => p === "/decompose" },
    { label: "回顾", to: "/review", match: (p: string) => p === "/review" },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="Momentum 首页">
            <span className="brand-mark">
              <BrandMark />
            </span>
            <span className="brand-text">
              <span className="brand-name">Momentum</span>
              <span className="brand-sub">进度追踪</span>
            </span>
          </Link>
          <nav className="nav" aria-label="主导航">
            {items.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="nav-link"
                aria-current={item.match(path) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="page">{children}</main>
      <footer className="footer">
        <div className="footer-inner">
          <span>Momentum · 进度由确定性规则计算，数据只写入此浏览器。</span>
          <span className="row" style={{ gap: 10 }}>
            <DemoBadge show={snap?.meta.demo ?? false} />
            <span>无账号 · 无云同步</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
