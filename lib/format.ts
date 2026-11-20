/*! 日程 plugin · 给模型和页面看的文字格式。 */

import type { Plan, PlanItem } from './types.ts';
import { KIND_LABEL } from './types.ts';
import { dateKey, formatHHMM, minuteOfDay, parseDateKey, parseHHMM, weekdayLabel } from './time.ts';

export type NowInfo = {
  at: string;
  date: string;
  minute: number;
  current: PlanItem | null;
  next: PlanItem | null;
  minutesLeft: number | null;
  minutesToNext: number | null;
  free: boolean;
};

export function sourceLabel(plan: Plan): string {
  if (plan.source === 'ai') return '模型润色';
  if (plan.source === 'manual') return '手动';
  return '自动';
}

export function planHeader(plan: Plan): string {
  const date = parseDateKey(plan.date);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayLabel(plan.weekday)} · ${plan.tone} · ${sourceLabel(plan)}`;
}

export function itemLine(item: PlanItem, detail: 'brief' | 'full'): string {
  const base = `${item.start}-${item.end}  ${item.title}`;
  if (detail === 'brief') return base;
  const extra: string[] = [];
  if (item.place) extra.push(item.place);
  if (item.note) extra.push(item.note);
  let line = extra.length ? `${base}（${extra.join('；')}）` : base;
  if (item.status === 'done') line += ' ✓';
  if (item.status === 'skipped') line += '（跳过）';
  return line;
}

export function formatPlan(plan: Plan, detail: 'brief' | 'full' = 'brief'): string {
  const lines = [planHeader(plan)];
  if (plan.weatherAdjusted?.length) lines.push(`已按天气调整：${plan.weatherAdjusted.join('；')}`);
  if (detail === 'full' && plan.note) lines.push(plan.note);
  for (const item of plan.items) lines.push(itemLine(item, detail));
  if (plan.aiError) lines.push(`（模型润色没成功，用的是自动骨架：${plan.aiError}）`);
  return lines.join('\n');
}

export function nowInfo(plan: Plan | null, now: Date = new Date()): NowInfo {
  const minute = minuteOfDay(now);
  const today = dateKey(now);
  const entry: NowInfo = {
    at: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    date: today,
    minute,
    current: null,
    next: null,
    minutesLeft: null,
    minutesToNext: null,
    free: false,
  };
  if (!plan || plan.date !== today) return entry;
  let next: PlanItem | null = null;
  for (const item of plan.items) {
    const start = parseHHMM(item.start);
    const end = parseHHMM(item.end);
    if (start === null || end === null) continue;
    if (start <= minute && minute < end) {
      entry.current = item;
      entry.minutesLeft = end - minute;
      entry.free = ['free', 'rest', 'chore', 'social'].includes(item.kind);
    } else if (start > minute && !next) {
      next = item;
    }
  }
  entry.next = next;
  if (next) {
    const start = parseHHMM(next.start);
    if (start !== null) entry.minutesToNext = start - minute;
  }
  return entry;
}

export function formatNow(plan: Plan | null, info: NowInfo): string {
  const lines = [`现在 ${info.at} · ${plan ? planHeader(plan).split(' · ').slice(0, 2).join(' · ') : '今天还没有日程'}`];
  if (info.current) {
    const left = info.minutesLeft ?? 0;
    lines.push(`正在进行：${info.current.title}（${info.current.start}-${info.current.end}，还剩 ${left} 分钟）`);
  } else if (info.next) {
    lines.push('现在没有排着的事。');
  } else {
    lines.push('今天的安排都结束了。');
    if (plan?.sleepAt) lines.push(`睡觉时间：${plan.sleepAt}`);
  }
  if (info.next) {
    const gap = info.minutesToNext ?? 0;
    lines.push(`下一项：${info.next.start}-${info.next.end} ${info.next.title}（${gap} 分钟后）`);
  }
  return lines.join('\n');
}

export function formatEditResult(plan: Plan, item?: PlanItem): string {
  const lines = [planHeader(plan)];
  if (item) lines.push(`${item.start}-${item.end}  ${item.title}（${KIND_LABEL[item.kind]}）`);
  lines.push(`共 ${plan.items.length} 项。`);
  return lines.join('\n');
}

export function briefRange(entries: Array<{ date: string; plan: Plan | null }>): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (!entry.plan) {
      lines.push(`${entry.date}：还没有生成`);
      continue;
    }
    const date = parseDateKey(entry.date);
    lines.push(`${date.getMonth() + 1}月${date.getDate()}日 ${weekdayLabel(entry.plan.weekday)} · ${entry.plan.tone} · ${sourceLabel(entry.plan)}`);
    for (const item of entry.plan.items) {
      if (item.kind === 'sleep') continue;
      lines.push(`  ${item.start}-${item.end} ${item.title}`);
    }
  }
  return lines.join('\n');
}

export function clockLabel(minute: number): string {
  return formatHHMM(minute);
}
