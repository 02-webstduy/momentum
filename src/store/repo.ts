import type {
  ArchivedVersion,
  AttributionOverride,
  Cheer,
  DaySummary,
  DecompositionDraft,
  Meta,
  Milestone,
  MomentumEvent,
  Project,
  Snapshot,
  Stage,
} from "@/types";
import { emptyMeta } from "@/types";

export const STORAGE_PREFIX = "momentum:v1:";
const DB_NAME = "momentum:v1";
const STORE_NAME = "kv";
const LS_FALLBACK_ROOT = `${STORAGE_PREFIX}kv:`;

const key = (suffix: string) => `${STORAGE_PREFIX}${suffix}`;

export const KEYS = {
  meta: key("meta"),
  project: (id: string) => key(`project:${id}`),
  stage: (id: string) => key(`stage:${id}`),
  milestone: (id: string) => key(`milestone:${id}`),
  event: (id: string) => key(`event:${id}`),
  summary: (date: string) => key(`summary:${date}`),
  cheer: (id: string) => key(`cheer:${id}`),
  archive: (projectId: string, version: number) => key(`archive:${projectId}:${version}`),
  draft: (projectId: string) => key(`draft:${projectId}`),
  attribution: (eventId: string) => key(`attr:${eventId}`),
  githubToken: key("github:token"),
  githubUser: key("github:user"),
  githubCache: (user: string) => key(`github:cache:${user}`),
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
  return dbPromise;
}

async function idbGetAll(): Promise<Map<string, unknown>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const keysReq = store.getAllKeys();
    const valuesReq = store.getAll();
    tx.oncomplete = () => {
      const out = new Map<string, unknown>();
      keysReq.result.forEach((k, i) => out.set(String(k), valuesReq.result[i]));
      resolve(out);
    };
    tx.onerror = () => reject(tx.error ?? new Error("read failed"));
  });
}

async function idbPut(entries: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const [k, v] of Object.entries(entries)) store.put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("write failed"));
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
  });
}

function lsAll(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_FALLBACK_ROOT)) continue;
      const raw = localStorage.getItem(k);
      if (raw === null) continue;
      out.set(k.slice(LS_FALLBACK_ROOT.length), JSON.parse(raw) as unknown);
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

async function getAll(): Promise<Map<string, unknown>> {
  try {
    return await idbGetAll();
  } catch {
    return lsAll();
  }
}

export async function put(entries: Record<string, unknown>): Promise<void> {
  const prefixed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entries)) prefixed[k.startsWith(STORAGE_PREFIX) ? k : key(k)] = v;
  try {
    await idbPut(prefixed);
  } catch {
    try {
      for (const [k, v] of Object.entries(prefixed)) {
        localStorage.setItem(`${LS_FALLBACK_ROOT}${k.slice(STORAGE_PREFIX.length)}`, JSON.stringify(v));
      }
    } catch {
      /* ignore quota errors */
    }
  }
}

export async function remove(...keys: string[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const k of keys) store.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
    });
  } catch {
    for (const k of keys) {
      try {
        localStorage.removeItem(`${LS_FALLBACK_ROOT}${k.slice(STORAGE_PREFIX.length)}`);
      } catch {
        /* ignore */
      }
    }
  }
}

export async function clearAll(): Promise<void> {
  try {
    await idbClear();
  } catch {
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_FALLBACK_ROOT)) localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
  }
}

export async function replaceAll(snapshot: Snapshot): Promise<void> {
  await clearAll();
  await put(flatten(snapshot));
}

export function flatten(snapshot: Snapshot): Record<string, unknown> {
  const entries: Record<string, unknown> = { [KEYS.meta]: snapshot.meta };
  for (const p of snapshot.projects) entries[KEYS.project(p.id)] = p;
  for (const s of snapshot.stages) entries[KEYS.stage(s.id)] = s;
  for (const m of snapshot.milestones) entries[KEYS.milestone(m.id)] = m;
  for (const e of snapshot.events) entries[KEYS.event(e.id)] = e;
  for (const [date, s] of Object.entries(snapshot.summaries)) entries[KEYS.summary(date)] = s;
  for (const [id, c] of Object.entries(snapshot.cheers)) entries[KEYS.cheer(id)] = c;
  for (const [projectId, versions] of Object.entries(snapshot.archives)) {
    for (const v of versions) entries[KEYS.archive(projectId, v.version)] = v;
  }
  for (const [projectId, d] of Object.entries(snapshot.drafts)) entries[KEYS.draft(projectId)] = d;
  for (const [eventId, a] of Object.entries(snapshot.attributions)) entries[KEYS.attribution(eventId)] = a;
  return entries;
}

function groupArchive(raw: Map<string, unknown>): Record<string, ArchivedVersion[]> {
  const out: Record<string, ArchivedVersion[]> = {};
  for (const [k, v] of raw) {
    if (!k.startsWith("archive:")) continue;
    const rest = k.slice("archive:".length);
    const version = Number(rest.split(":").pop());
    if (!Number.isFinite(version)) continue;
    const record = v as ArchivedVersion;
    const projectId = record.projectId;
    (out[projectId] ??= []).push(record);
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.version - a.version);
  return out;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const raw = await getAll();
  const snapshot: Snapshot = {
    projects: [],
    stages: [],
    milestones: [],
    events: [],
    summaries: {},
    cheers: {},
    archives: {},
    drafts: {},
    attributions: {},
    meta: emptyMeta(),
  };
  const archiveMap = new Map<string, unknown>();

  for (const [rawKey, v] of raw) {
    const k = rawKey.startsWith(STORAGE_PREFIX) ? rawKey.slice(STORAGE_PREFIX.length) : rawKey;
    if (k.startsWith("project:")) snapshot.projects.push(v as Project);
    else if (k.startsWith("stage:")) snapshot.stages.push(v as Stage);
    else if (k.startsWith("milestone:")) snapshot.milestones.push(v as Milestone);
    else if (k.startsWith("event:")) snapshot.events.push(v as MomentumEvent);
    else if (k.startsWith("summary:")) snapshot.summaries[k.slice("summary:".length)] = v as DaySummary;
    else if (k.startsWith("cheer:")) snapshot.cheers[k.slice("cheer:".length)] = v as Cheer;
    else if (k.startsWith("draft:")) snapshot.drafts[k.slice("draft:".length)] = v as DecompositionDraft;
    else if (k.startsWith("attr:")) snapshot.attributions[k.slice("attr:".length)] = v as AttributionOverride;
    else if (k.startsWith("archive:")) archiveMap.set(k, v);
    else if (k === "meta") snapshot.meta = { ...emptyMeta(), ...(v as Meta), generatedBy: { ...((v as Meta).generatedBy ?? {}) } };
  }
  snapshot.archives = groupArchive(archiveMap);

  snapshot.events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  snapshot.stages.sort((a, b) => a.order - b.order);
  snapshot.projects.sort((a, b) => a.startDate.localeCompare(b.startDate));

  const attr = snapshot.attributions;
  snapshot.events = snapshot.events.map((e) => {
    const o = attr[e.id];
    if (!o) return e;
    return {
      ...e,
      projectId: o.projectId ?? undefined,
      stageId: o.stageId ?? undefined,
      origin: "user",
    };
  });
  return snapshot;
}
