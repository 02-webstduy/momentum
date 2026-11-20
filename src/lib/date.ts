const pad = (n: number) => String(n).padStart(2, "0");

export function dateKeyOf(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(): string {
  return dateKeyOf(new Date());
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = parseDateKey(key);
  return dateKeyOf(d) === key;
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKeyOf(d);
}

export function daysBetween(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey).getTime();
  const b = parseDateKey(toKey).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function formatCnDate(key: string): string {
  const d = parseDateKey(key);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatShortDate(key: string): string {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function weekdayCn(key: string): string {
  return WEEKDAYS[parseDateKey(key).getDay()];
}

export function formatClock(ts: string | number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTimeCn(ts: string | number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${formatCnDate(dateKeyOf(d))} ${formatClock(d)}`;
}

export function weekdayShort(index: number): string {
  return ["日", "一", "二", "三", "四", "五", "六"][index];
}

export function lastNDays(n: number, endKey = todayKey()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(addDays(endKey, -i));
  return out;
}
