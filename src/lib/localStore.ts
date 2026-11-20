const enabled = () => {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
};

export function lsGet(key: string): string | null {
  if (!enabled()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  if (!enabled()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota errors */
  }
}

export function lsRemove(key: string): void {
  if (!enabled()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function lsGetJson<T>(key: string): T | null {
  const raw = lsGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function lsSetJson(key: string, value: unknown): void {
  lsSet(key, JSON.stringify(value));
}
