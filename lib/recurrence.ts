/*! 日程 plugin · 重复规则：周、双周、每月第 N 个周几、每月最后，以及例外日期。 */

import { addDays, isoWeekday, isValidDateKey, parseDateKey } from './time.ts';

export type RepeatMode = 'weekly' | 'biweekly' | 'monthlyNth' | 'monthlyLast';

export type RepeatSpec = {
  mode: RepeatMode;
  nth: number;
  anchor: string;
  skip: string[];
};

const WEEKDAYS = /^[1-7](?:[,、，/][1-7])*$/;

export function parseDaysText(value: string): number[] {
  const compact = value.replace(/\s+/g, '');
  if (!compact) return [1, 2, 3, 4, 5, 6, 7];
  if (compact === '每天' || compact === '天天' || compact === '*' || compact === '每日') return [1, 2, 3, 4, 5, 6, 7];
  if (compact === '工作日' || compact === '周一到周五') return [1, 2, 3, 4, 5];
  if (compact === '周末') return [6, 7];
  if (WEEKDAYS.test(compact)) {
    return [...new Set(compact.split(/[,、，/]/).map(Number))].sort((left, right) => left - right);
  }
  return [];
}

function validSkip(value: string): string[] {
  return [...new Set(value.split(/[,，、\s]+/).map((entry) => entry.trim()).filter((entry) => isValidDateKey(entry)))].sort();
}

function splitSkip(value: string): { body: string; skip: string[] } {
  const index = value.indexOf('!');
  if (index < 0) return { body: value.trim(), skip: [] };
  return { body: value.slice(0, index).trim(), skip: validSkip(value.slice(index + 1)) };
}

/** 把「每周 / 双周 @起始日 / 每月第 N 个 / 每月最后」解析成统一规则。 */
export function parseRepeatText(value: unknown): { repeat: string; error: string } {
  if (value === undefined || value === null || value === '') return { repeat: '', error: '' };
  if (typeof value !== 'string') return { repeat: '', error: '重复规则要是文字' };
  const { body, skip } = splitSkip(value.trim());
  const suffix = skip.length ? `!${skip.join(',')}` : '';
  const compact = body.replace(/\s+/g, ' ');
  if (!compact || compact === '每周' || compact === 'weekly') return { repeat: `weekly${suffix}`, error: '' };
  if (/^(双周|每两周|隔周)/.test(compact)) {
    const anchor = /@([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(compact)?.[1] ?? '';
    if (!isValidDateKey(anchor)) return { repeat: '', error: '双周规则要写 @起始日期，例如 双周 @2026-11-16' };
    return { repeat: `biweekly@${anchor}${suffix}`, error: '' };
  }
  if (compact === '每月最后' || compact === 'last') return { repeat: `last${suffix}`, error: '' };
  const nth = /每月第\s*([1-5])\s*个/.exec(compact)?.[1];
  if (nth) return { repeat: `monthly:${nth}${suffix}`, error: '' };
  return { repeat: '', error: '重复规则支持：每周 / 双周 @日期 / 每月第1-5个 / 每月最后' };
}

/** 固定安排的时间列可以同时写星期和规则，例如「双周 1,3,5 @2026-11-16」。 */
export function parseFixedWhen(value: string): { days: number[]; repeat: string; error: string } {
  const { body, skip } = splitSkip(value.trim());
  const suffix = skip.length ? `!${skip.join(',')}` : '';
  const compact = body.replace(/\s+/g, ' ');
  let rest = compact;
  let prefix = '';
  if (/^(双周|每两周|隔周)/.test(compact)) {
    prefix = 'biweekly';
    rest = compact.replace(/^(双周|每两周|隔周)/, '').trim();
  } else if (/^每月第\s*[1-5]\s*个/.test(compact)) {
    prefix = 'monthly';
    rest = compact.replace(/^每月第\s*[1-5]\s*个/, '').trim();
  } else if (/^每月最后/.test(compact)) {
    prefix = 'last';
    rest = compact.replace(/^每月最后/, '').trim();
  } else if (/^每周/.test(compact)) {
    prefix = 'weekly';
    rest = compact.replace(/^每周/, '').trim();
  }
  const anchor = /@([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(rest)?.[1] ?? '';
  rest = rest.replace(/@[0-9]{4}-[0-9]{2}-[0-9]{2}/g, '').trim();
  const days = parseDaysText(rest || (prefix === 'weekly' ? '每天' : ''));
  if (!days.length) return { days: [], repeat: '', error: '星期写法看不懂' };
  if (prefix === 'biweekly') {
    if (!isValidDateKey(anchor)) return { days, repeat: '', error: '双周要写 @起始日期，例如 双周 1,3,5 @2026-11-16' };
    return { days, repeat: `biweekly@${anchor}${suffix}`, error: '' };
  }
  if (prefix === 'monthly') {
    if (days.length !== 1) return { days, repeat: '', error: '每月第 N 个只能选一个周几' };
    const nth = /每月第\s*([1-5])\s*个/.exec(compact)?.[1] ?? '';
    return { days, repeat: `monthly:${nth}${suffix}`, error: '' };
  }
  if (prefix === 'last') {
    if (days.length !== 1) return { days, repeat: '', error: '每月最后只能选一个周几' };
    return { days, repeat: `last${suffix}`, error: '' };
  }
  return { days, repeat: suffix ? `weekly${suffix}` : '', error: '' };
}

function parseCanonical(repeat: string): RepeatSpec | null {
  const { body, skip } = splitSkip(repeat);
  if (body === 'weekly') return { mode: 'weekly', nth: 0, anchor: '', skip };
  if (body.startsWith('biweekly@')) {
    const anchor = body.slice('biweekly@'.length);
    if (!isValidDateKey(anchor)) return null;
    return { mode: 'biweekly', nth: 0, anchor, skip };
  }
  const nth = /^monthly:([1-5])$/.exec(body);
  if (nth) return { mode: 'monthlyNth', nth: Number(nth[1]), anchor: '', skip };
  if (body === 'last') return { mode: 'monthlyLast', nth: 0, anchor: '', skip };
  return null;
}

/** 保存前把规则压成固定写法；无法识别时退回空规则，避免写坏配置。 */
export function normalizeRepeat(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const canonical = parseCanonical(value.trim());
  if (canonical) return value.trim();
  const parsed = parseRepeatText(value);
  return parsed.error ? '' : parsed.repeat;
}

export function repeatInput(repeat: string): string {
  const spec = parseCanonical(repeat);
  if (!spec) return '';
  const suffix = spec.skip.length ? ` !${spec.skip.join(',')}` : '';
  if (spec.mode === 'weekly') return `每周${suffix}`;
  if (spec.mode === 'biweekly') return `双周 @${spec.anchor}${suffix}`;
  if (spec.mode === 'monthlyNth') return `每月第${spec.nth}个${suffix}`;
  return `每月最后${suffix}`;
}

export function fixedWhenText(days: number[], repeat: string): string {
  const spec = parseCanonical(repeat);
  if (!spec) return days.join(',');
  const suffix = spec.skip.length ? ` !${spec.skip.join(',')}` : '';
  if (spec.mode === 'weekly') return `${days.join(',')}${suffix}`;
  if (spec.mode === 'biweekly') return `双周 ${days.join(',')} @${spec.anchor}${suffix}`;
  if (spec.mode === 'monthlyNth') return `每月第${spec.nth}个 ${days[0] ?? 1}${suffix}`;
  return `每月最后 ${days[0] ?? 1}${suffix}`;
}

function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(parseDateKey(date)));
}

function daysBetween(from: string, to: string): number {
  const left = parseDateKey(from);
  const right = parseDateKey(to);
  const a = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const b = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** 某天是否命中这条重复规则。没有规则时按 days 每周。 */
export function occursOn(days: number[], repeat: string, date: string, weekday: number): boolean {
  const spec = repeat ? parseCanonical(repeat) : null;
  if (spec?.skip.includes(date)) return false;
  if (!days.includes(weekday)) return false;
  if (!spec || spec.mode === 'weekly') return true;
  if (spec.mode === 'biweekly') {
    const offset = daysBetween(mondayOf(spec.anchor), mondayOf(date));
    return offset >= 0 && Math.round(offset / 7) % 2 === 0;
  }
  const dayOfMonth = parseDateKey(date).getDate();
  if (spec.mode === 'monthlyNth') return Math.ceil(dayOfMonth / 7) === spec.nth;
  return addDays(date, 7).slice(0, 7) !== date.slice(0, 7);
}
