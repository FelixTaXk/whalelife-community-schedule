/*! 日程 plugin · 日期与时间工具（只依赖宿主本地时区，不读主干私有数据）。 */

export const MINUTES_PER_DAY = 1440;

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地日期键 YYYY-MM-DD，不用 UTC，避免晚上 23 点后串到第二天。 */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 2000 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

export function parseDateKey(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(value: string, amount: number): string {
  const date = parseDateKey(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

/** ISO 星期：1 = 周一 … 7 = 周日。 */
export function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export function weekdayLabel(weekday: number): string {
  const names = ['一', '二', '三', '四', '五', '六', '日'];
  return `周${names[Math.min(6, Math.max(0, weekday - 1))]}`;
}

export function dateLabel(value: string): string {
  const date = parseDateKey(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** 接受 7:30 / 07:30，统一成 HH:MM；非法返回 null。 */
export function parseHHMM(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return null;
  if (hour === 24 && minute === 0) return MINUTES_PER_DAY;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

export function formatHHMM(minute: number): string {
  const clamped = Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(minute)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

export function normalizeTime(value: string): string {
  const minute = parseHHMM(value);
  return minute === null ? '00:00' : formatHHMM(minute);
}

export function minuteOfDay(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** FNV-1a，用来让同一天的基调与自由安排稳定且彼此不同。 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function pick<T>(list: readonly T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
