/*! 日程 plugin · 法定节假日、调休与学生假期判断（纯函数，不联网）。 */

import type { HolidayConfig, HolidayKind, HolidayPeriod, HolidayScale } from './types.ts';
import { parseDateKey } from './time.ts';

export type HolidayDay = HolidayPeriod & {
  key: string;
  dayIndex: number;
  days: number;
};

export type DayInfo = {
  date: string;
  weekday: number;
  weekend: boolean;
  /** 当前配置的周末日（1 = 周一 … 7 = 周日），供旅行起算使用。 */
  weekendDays: number[];
  holiday: HolidayDay | null;
  /** 调休上班日名称；有值时当天按工作日。 */
  workday: string;
  /** 法定/自定义假期；普通周末不算，是否上班仍由作息里的星期决定。 */
  rest: boolean;
  /** 学生寒暑假/春秋假；普通法定假期不算。 */
  studentVacation: boolean;
};

/**
 * 国务院办公厅 2026 年部分节假日安排（2025-11-04 发布）。
 * 只用于排程，不依赖网络；后续年份可以在设置页用自定义假期补充。
 */
const BUILTIN_2026: HolidayPeriod[] = [
  { name: '元旦', start: '2026-01-01', end: '2026-01-03', kind: 'statutory', scale: 'short' },
  { name: '春节', start: '2026-02-15', end: '2026-02-23', kind: 'statutory', scale: 'long' },
  { name: '清明节', start: '2026-04-04', end: '2026-04-06', kind: 'statutory', scale: 'short' },
  { name: '劳动节', start: '2026-05-01', end: '2026-05-05', kind: 'statutory', scale: 'long' },
  { name: '端午节', start: '2026-06-19', end: '2026-06-21', kind: 'statutory', scale: 'short' },
  { name: '中秋节', start: '2026-09-25', end: '2026-09-27', kind: 'statutory', scale: 'short' },
  { name: '国庆节', start: '2026-10-01', end: '2026-10-07', kind: 'statutory', scale: 'long' },
];

/** 国务院办公厅 2027 年部分节假日安排（2026-11-05 发布）。 */
const BUILTIN_2027: HolidayPeriod[] = [
  { name: '元旦', start: '2027-01-01', end: '2027-01-03', kind: 'statutory', scale: 'short' },
  { name: '春节', start: '2027-02-05', end: '2027-02-13', kind: 'statutory', scale: 'long' },
  { name: '清明节', start: '2027-04-03', end: '2027-04-05', kind: 'statutory', scale: 'short' },
  { name: '劳动节', start: '2027-05-01', end: '2027-05-05', kind: 'statutory', scale: 'long' },
  { name: '端午节', start: '2027-06-09', end: '2027-06-09', kind: 'statutory', scale: 'short' },
  { name: '中秋节', start: '2027-09-15', end: '2027-09-15', kind: 'statutory', scale: 'short' },
  { name: '国庆节', start: '2027-10-01', end: '2027-10-07', kind: 'statutory', scale: 'long' },
];

/** 官方调休上班日：周末也要按工作日排正事。 */
const BUILTIN_WORKDAYS = [
  '2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10',
  '2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09',
];

export const BUILTIN_HOLIDAYS: readonly HolidayPeriod[] = [...BUILTIN_2026, ...BUILTIN_2027];
export const BUILTIN_WORKDAY_LIST: readonly string[] = BUILTIN_WORKDAYS;

function span(start: string, end: string): number {
  return Math.round((parseDateKey(end).getTime() - parseDateKey(start).getTime()) / 86_400_000) + 1;
}

function activePeriods(config: HolidayConfig): HolidayPeriod[] {
  if (!config.enabled) return [];
  const builtin = config.builtin ? BUILTIN_HOLIDAYS : [];
  const custom = config.periods.filter((period) => period.kind !== 'student' || config.student);
  return [...builtin, ...custom];
}

function activeWorkdays(config: HolidayConfig): Set<string> {
  if (!config.enabled) return new Set();
  return new Set([
    ...(config.builtin ? BUILTIN_WORKDAYS : []),
    ...config.workdays,
  ]);
}

/** 当天命中的假期、调休上班日和是否休息。重叠时取开始更晚的假期，避免旧假期盖住新假期。 */
export function resolveDayInfo(config: HolidayConfig, date: string, weekday: number): DayInfo {
  const weekendDays = config.weekendDays?.length ? config.weekendDays : [6, 7];
  const weekend = weekendDays.includes(weekday);
  const workdays = activeWorkdays(config);
  if (workdays.has(date)) {
    return { date, weekday, weekend, weekendDays, holiday: null, workday: '调休上班', rest: false, studentVacation: false };
  }
  const candidates = activePeriods(config)
    .filter((period) => date >= period.start && date <= period.end)
    .sort((left, right) => right.start.localeCompare(left.start) || span(right.start, right.end) - span(left.start, left.end));
  const period = candidates[0];
  const holiday = period ? {
    ...period,
    key: `${period.kind}:${period.start}:${period.name}`,
    dayIndex: Math.round((parseDateKey(date).getTime() - parseDateKey(period.start).getTime()) / 86_400_000),
    days: span(period.start, period.end),
  } : null;
  return {
    date,
    weekday,
    weekend,
    weekendDays,
    holiday,
    workday: '',
    rest: Boolean(holiday),
    studentVacation: holiday?.kind === 'student',
  };
}

export function holidayScaleLabel(scale: HolidayScale): string {
  return scale === 'long' ? '长假' : '短假';
}

export function holidayKindLabel(kind: HolidayKind): string {
  return kind === 'student' ? '学生假期' : kind === 'statutory' ? '法定假日' : '自定义假期';
}
