import type { Milestone, MomentumEvent, Project, Stage } from "@/types";
import { KEYS } from "@/store/repo";
import { lsGetJson, lsSetJson } from "@/lib/localStore";
import { autoAttribute } from "@/lib/attribution";
import { dateKeyOf, todayKey } from "@/lib/date";

export const GITHUB_CACHE_TTL = 30 * 60 * 1000;

export class GithubError extends Error {
  userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = "GithubError";
    this.userMessage = userMessage;
  }
}

interface CachedGithub {
  fetchedAt: string;
  events: MomentumEvent[];
}

interface GithubPushCommit {
  sha?: string;
  message?: string;
}

interface GithubEvent {
  type?: string;
  created_at?: string;
  repo?: { name?: string };
  payload?: { ref?: string; commits?: GithubPushCommit[] };
}

function shaLike(seed: string): string {
  const base = `gh${seed.replace(/[^a-z0-9]/gi, "")}`.toLowerCase();
  return base.padEnd(40, "0").slice(0, 40);
}

export function readGithubSettings(): { username: string; token: string } {
  const username = lsGetJson<string>(KEYS.githubUser) ?? "";
  const token = lsGetJson<string>(KEYS.githubToken) ?? "";
  return { username, token };
}

export function writeGithubSettings(username: string, token: string): void {
  lsSetJson(KEYS.githubUser, username.trim());
  if (token.trim()) lsSetJson(KEYS.githubToken, token.trim());
}

export function cachedGithubAt(username: string): string | null {
  const cache = lsGetJson<CachedGithub>(KEYS.githubCache(username));
  return cache?.fetchedAt ?? null;
}

export async function fetchTodayCommits(
  username: string,
  token: string,
  context: { projects: Project[]; stages: Stage[]; milestones: Milestone[] },
): Promise<{ events: MomentumEvent[]; fetchedAt: string; cached: boolean }> {
  const user = username.trim();
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(user)) {
    throw new GithubError("GitHub 用户名格式不正确。");
  }

  const cache = lsGetJson<CachedGithub>(KEYS.githubCache(user));
  if (cache) {
    const age = Date.now() - new Date(cache.fetchedAt).getTime();
    if (age >= 0 && age < GITHUB_CACHE_TTL) {
      return { events: todayOnly(cache.events), fetchedAt: cache.fetchedAt, cached: true };
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=100`,
      { headers },
    );
  } catch {
    throw new GithubError("网络不可用，已降级为手动录入。");
  }

  if (response.status === 404) throw new GithubError("未找到该 GitHub 用户，已降级为手动录入。");
  if (response.status === 401) throw new GithubError("Token 无效或已过期，已降级为手动录入。");
  if (response.status === 403 || response.status === 429) {
    throw new GithubError("GitHub 限流（未认证 60 次/小时），已降级为手动录入。");
  }
  if (!response.ok) throw new GithubError(`GitHub 请求失败（HTTP ${response.status}），已降级为手动录入。`);

  let items: unknown;
  try {
    items = await response.json();
  } catch {
    throw new GithubError("GitHub 返回内容无法解析，已降级为手动录入。");
  }
  if (!Array.isArray(items)) throw new GithubError("GitHub 返回内容格式异常，已降级为手动录入。");

  const fetchedAt = new Date().toISOString();
  const seen = new Set<string>();
  const events: MomentumEvent[] = [];

  for (const raw of items as GithubEvent[]) {
    if (raw.type !== "PushEvent") continue;
    const repo = raw.repo?.name ?? "unknown";
    const commits = Array.isArray(raw.payload?.commits) ? raw.payload!.commits! : [];
    const ts = raw.created_at ?? fetchedAt;
    commits.forEach((commit, index) => {
      const sha = commit.sha ?? shaLike(`${repo}-${ts}-${index}`);
      if (seen.has(sha)) return;
      seen.add(sha);
      const message = (commit.message ?? "提交").split("\n")[0].trim();
      const base: MomentumEvent = {
        id: `gh:${sha}`,
        ts,
        duration: 0,
        source: "github",
        kind: "commit",
        payload: { repo, sha, message, ref: raw.payload?.ref ?? null },
        origin: "auto",
        confidence: 0.9,
      };
      const attr = autoAttribute(base, context.projects, context.stages, context.milestones);
      events.push({ ...base, ...attr });
    });
  }

  lsSetJson(KEYS.githubCache(user), { fetchedAt, events } satisfies CachedGithub);
  return { events: todayOnly(events), fetchedAt, cached: false };
}

function todayOnly(events: MomentumEvent[]): MomentumEvent[] {
  const today = todayKey();
  return events.filter((e) => dateKeyOf(e.ts) === today);
}
