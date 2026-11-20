import { Link, RouterProvider, useRouter } from "@/router";
import { MomentumProvider, useMomentum } from "@/store/state";
import { Shell } from "@/components/Shell";
import { EmptyState } from "@/components/ui";
import { TodayPage } from "@/pages/TodayPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { DecomposePage } from "@/pages/DecomposePage";
import { ReviewPage } from "@/pages/ReviewPage";

function Routes() {
  const { path } = useRouter();
  if (path === "/") return <TodayPage />;
  if (path === "/project") return <ProjectPage projectId={null} />;
  if (path.startsWith("/project/")) {
    return <ProjectPage projectId={decodeURIComponent(path.slice("/project/".length))} />;
  }
  if (path === "/decompose") return <DecomposePage />;
  if (path === "/review") return <ReviewPage />;
  return (
    <EmptyState
      mark="—"
      title="这个地址没有页面"
      actions={
        <Link to="/" className="btn btn-primary">
          回到今日
        </Link>
      }
    >
      检查链接是否正确，或从顶部导航回到今日、进度、分解与回顾。
    </EmptyState>
  );
}

function Toast() {
  const { notice } = useMomentum();
  if (!notice) return null;
  return (
    <div
      className={`toast${notice.tone === "info" ? "" : ` toast-${notice.tone}`}`}
      role="status"
      aria-live="polite"
      key={notice.id}
    >
      {notice.text}
    </div>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <MomentumProvider>
        <Shell>
          <Routes />
        </Shell>
        <Toast />
      </MomentumProvider>
    </RouterProvider>
  );
}
