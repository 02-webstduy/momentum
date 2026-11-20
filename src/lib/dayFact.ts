import type { DayFact, MomentumEvent } from "@/types";
import { dateKeyOf, parseDateKey } from "@/lib/date";
import { mergeSessions } from "@/lib/progress";

export function eventsOnDate(events: MomentumEvent[], dateKey: string): MomentumEvent[] {
  return events.filter((e) => dateKeyOf(e.ts) === dateKey);
}

export function evidenceRefOf(event: MomentumEvent): string {
  const sha = typeof event.payload.sha === "string" ? event.payload.sha : "";
  if (event.kind === "commit" && sha) return `commit:${sha.slice(0, 7)}`;
  return `${event.kind}:${event.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
}

export function eventTitle(event: MomentumEvent): string {
  if (typeof event.payload.message === "string" && event.payload.message.trim()) {
    return event.payload.message.trim();
  }
  if (typeof event.payload.text === "string" && event.payload.text.trim()) {
    return event.payload.text.trim();
  }
  if (typeof event.payload.sha === "string") return `提交 ${event.payload.sha.slice(0, 7)}`;
  return event.kind === "commit" ? "一次提交" : "一条记录";
}

export function eventRepo(event: MomentumEvent): string | null {
  return typeof event.payload.repo === "string" ? event.payload.repo : null;
}

export function activeDates(events: MomentumEvent[]): Set<string> {
  return new Set(events.map((e) => dateKeyOf(e.ts)));
}

export function streakFor(dateKey: string, events: MomentumEvent[]): number {
  const active = activeDates(events);
  let cursor = active.has(dateKey) ? dateKey : previousKey(dateKey);
  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = previousKey(cursor);
  }
  return streak;
}

function previousKey(key: string): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() - 1);
  return dateKeyOf(d);
}

export function buildDayFact(dateKey: string, allEvents: MomentumEvent[]): DayFact {
  const events = eventsOnDate(allEvents, dateKey);
  if (events.length === 0) {
    return {
      date: dateKey,
      sessions: 0,
      activeRepos: 0,
      streak: streakFor(dateKey, allEvents),
      netChange: 0,
      evidenceRefs: [],
      hasData: false,
    };
  }
  const repos = new Set<string>();
  let netChange = 0;
  for (const e of events) {
    const repo = eventRepo(e);
    if (repo) repos.add(repo);
    const additions = Number(e.payload.additions ?? 0);
    const deletions = Number(e.payload.deletions ?? 0);
    if (Number.isFinite(additions)) netChange += additions;
    if (Number.isFinite(deletions)) netChange -= deletions;
  }
  return {
    date: dateKey,
    sessions: mergeSessions(events),
    activeRepos: repos.size,
    streak: streakFor(dateKey, allEvents),
    netChange,
    evidenceRefs: Array.from(new Set(events.map(evidenceRefOf))),
    hasData: true,
  };
}

export function commitsOnDate(events: MomentumEvent[], dateKey: string): number {
  return eventsOnDate(events, dateKey).filter((e) => e.kind === "commit").length;
}
