/*! 日程 plugin · 周复盘：从已落盘的 done / skipped 状态里算完成率和趋势。 */

import type { ExceptionDay } from './exceptions.ts';
import { EXCEPTION_LABELS } from './exceptions.ts';
import type { Plan, PlanItem } from './types.ts';
import { addDays, isoWeekday, parseDateKey, parseHHMM, weekdayLabel } from './time.ts';

export type ReviewRow = {
  date: string;
  weekday: string;
  total: number;
  done: number;
  skipped: number;
  pending: number;
  rate: number;
};

export type ReviewCount = { title: string; count: number };

export type WeekStats = {
  start: string;
  end: string;
  label: string;
  daysWithPlan: number;
  total: number;
  done: number;
  skipped: number;
  pending: number;
  /** done / 全部可执行项，含 pending。 */
  rate: number;
  /** done / 已处理项（done + skipped），不含 pending。 */
  handledRate: number;
  plannedMinutes: number;
  doneMinutes: number;
  skippedTop: ReviewCount[];
  sleepAverage: string;
  sleepLatest: string;
  sleepEarliest: string;
  travelDays: number;
  exercisePlanned: number;
  exerciseDone: number;
  exceptionDays: number;
  exceptions: ReviewCount[];
  rows: ReviewRow[];
};

export type WeeklyReview = {
  current: WeekStats;
  previous: WeekStats;
  rateDelta: number;
  handledDelta: number;
  doneDelta: number;
};

/** 周一为一周开始。 */
export function weekStartOf(date: string): string {
  return addDays(date, -(isoWeekday(parseDateKey(date)) - 1));
}

function countable(item: PlanItem): boolean {
  if (item.kind === 'sleep' || item.kind === 'routine') return false;
  // 自动铺的自由/家务/休息空档是填充，不是待办；只有明确安排才计入完成率。
  if (item.auto && (item.kind === 'free' || item.kind === 'chore' || item.kind === 'rest')) return false;
  return true;
}

function minutesOf(item: PlanItem): number {
  const start = parseHHMM(item.start);
  const end = parseHHMM(item.end);
  if (start === null || end === null) return 0;
  return end > start ? end - start : end + 1440 - start;
}

function sleepMinutes(text: string | undefined): number | null {
  const raw = String(text ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!raw) return null;
  const value = Number(raw[1]) * 60 + Number(raw[2]);
  return value < 12 * 60 ? value + 1440 : value;
}

function formatSleep(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function percent(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

function planRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function statWeek(start: string, plans: Plan[], exceptions: ExceptionDay[]): WeekStats {
  const end = addDays(start, 6);
  const days = planRange(start, end);
  const rows: ReviewRow[] = [];
  const skipped = new Map<string, number>();
  const exceptionCounts = new Map<string, number>();
  const sleeps: number[] = [];
  let total = 0;
  let done = 0;
  let skippedTotal = 0;
  let pending = 0;
  let plannedMinutes = 0;
  let doneMinutes = 0;
  let travelDays = 0;
  let exercisePlanned = 0;
  let exerciseDone = 0;
  let daysWithPlan = 0;

  for (const date of days) {
    const plan = plans.find((entry) => entry.date === date) ?? null;
    if (!plan) {
      rows.push({ date, weekday: weekdayLabel(isoWeekday(parseDateKey(date))), total: 0, done: 0, skipped: 0, pending: 0, rate: 0 });
      continue;
    }
    daysWithPlan += 1;
    const items = plan.items.filter(countable);
    let dayDone = 0;
    let daySkipped = 0;
    let dayPending = 0;
    for (const item of items) {
      total += 1;
      plannedMinutes += minutesOf(item);
      if (item.kind === 'exercise') exercisePlanned += 1;
      if (item.status === 'done') {
        done += 1;
        dayDone += 1;
        doneMinutes += minutesOf(item);
        if (item.kind === 'exercise') exerciseDone += 1;
      } else if (item.status === 'skipped') {
        skippedTotal += 1;
        daySkipped += 1;
        skipped.set(item.title, (skipped.get(item.title) ?? 0) + 1);
      } else {
        pending += 1;
        dayPending += 1;
      }
    }
    if (plan.travel) travelDays += 1;
    const sleep = sleepMinutes(plan.sleepAt);
    if (sleep !== null) sleeps.push(sleep);
    rows.push({
      date,
      weekday: weekdayLabel(isoWeekday(parseDateKey(date))),
      total: items.length,
      done: dayDone,
      skipped: daySkipped,
      pending: dayPending,
      rate: percent(dayDone, items.length),
    });
  }

  for (const exception of exceptions) {
    const label = EXCEPTION_LABELS[exception.kind] ?? exception.kind;
    exceptionCounts.set(label, (exceptionCounts.get(label) ?? 0) + 1);
  }

  const sleepAverage = sleeps.length
    ? formatSleep(Math.round(sleeps.reduce((sum, value) => sum + value, 0) / sleeps.length))
    : '';
  const sleepLatest = sleeps.length ? formatSleep(Math.max(...sleeps)) : '';
  const sleepEarliest = sleeps.length ? formatSleep(Math.min(...sleeps)) : '';

  return {
    start,
    end,
    label: `${start} → ${end}`,
    daysWithPlan,
    total,
    done,
    skipped: skippedTotal,
    pending,
    rate: percent(done, total),
    handledRate: percent(done, done + skippedTotal),
    plannedMinutes,
    doneMinutes,
    skippedTop: [...skipped.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([title, count]) => ({ title, count })),
    sleepAverage,
    sleepLatest,
    sleepEarliest,
    travelDays,
    exercisePlanned,
    exerciseDone,
    exceptionDays: exceptions.length,
    exceptions: [...exceptionCounts.entries()].map(([kind, count]) => ({ title: kind, count })),
    rows,
  };
}

/**
 * @param plans 覆盖本周和上周的计划（至少 14 天窗口）
 * @param exceptions 同期异常日
 * @param date 用来定位本周的任意一天，默认今天由调用方传
 */
export function weeklyReview(plans: Plan[], exceptions: ExceptionDay[], date: string): WeeklyReview {
  const start = weekStartOf(date);
  const previousStart = addDays(start, -7);
  const current = statWeek(start, plans, exceptions.filter((entry) => entry.date >= start && entry.date <= addDays(start, 6)));
  const previous = statWeek(previousStart, plans, exceptions.filter((entry) => entry.date >= previousStart && entry.date <= addDays(previousStart, 6)));
  return {
    current,
    previous,
    rateDelta: current.rate - previous.rate,
    handledDelta: current.handledRate - previous.handledRate,
    doneDelta: current.done - previous.done,
  };
}
