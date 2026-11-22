/*! 日程 plugin · 日程生成（纯函数，不碰网络和文件）。 */

import { createHash } from 'node:crypto';
import type { BlockKind, Config, Plan, PlanItem, Routine, TodoBlock } from './types.ts';
import { NOTES, TONES } from './types.ts';
import { resolveDayInfo } from './holidays.ts';
import type { ExceptionDay } from './exceptions.ts';
import { exceptionKey, exceptionLabel } from './exceptions.ts';
import { occursOn } from './recurrence.ts';
import { resolveTravel, type TravelOverride } from './travel.ts';
import {
  MINUTES_PER_DAY, formatHHMM, hashSeed, isoWeekday, parseDateKey, parseHHMM, pick, weekdayLabel,
} from './time.ts';

export type Gap = { start: number; end: number };

type Segment = {
  start: number;
  end: number;
  title: string;
  kind: BlockKind;
  place?: string;
  note?: string;
  priority: number;
  auto?: boolean;
  todoId?: string;
};

/** 固定安排 1、三餐 2、正事 3、旅行 3.5、运动 4、通勤 5、起床/睡前 6；数字小的先占位。 */
const PRIORITY = { fixed: 1, meal: 2, work: 3, travel: 3.5, exercise: 4, commute: 5, routine: 6 } as const;

const REST_TITLES = ['歇一会儿', '泡杯茶', '躺一会儿', '发呆放空'] as const;
const CHORE_TITLES = ['收拾一下桌子', '洗衣服', '整理照片', '顺手买点菜'] as const;

export function routineHash(routine: Routine): string {
  return createHash('sha256').update(JSON.stringify(routine)).digest('hex').slice(0, 12);
}

/** 作息之外的节假日/旅行设置也参与“过期”判断；只改这些不会留下旧计划。 */
export function configHash(config: Config): string {
  return createHash('sha256').update(JSON.stringify({
    routine: config.routine,
    holiday: config.holiday,
    travel: config.travel,
  })).digest('hex').slice(0, 12);
}

export function isStale(plan: Plan | null, config: Config): boolean {
  return Boolean(plan && !plan.edited && (
    plan.routineHash !== routineHash(config.routine) || plan.configHash !== configHash(config)
  ));
}

function subtract(
  list: Array<[number, number]>,
  start: number,
  end: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [left, right] of list) {
    if (right <= start || left >= end) {
      out.push([left, right]);
      continue;
    }
    if (left < start) out.push([left, Math.min(right, start)]);
    if (right > end) out.push([Math.max(left, end), right]);
  }
  return out.filter(([left, right]) => right - left >= 5);
}

function addSegment(placed: Segment[], segment: Segment) {
  let pieces: Array<[number, number]> = [[segment.start, segment.end]];
  for (const existing of placed) {
    if (existing.priority <= segment.priority) pieces = subtract(pieces, existing.start, existing.end);
  }
  if (!pieces.length) return;
  const kept: Segment[] = [];
  for (const existing of placed) {
    if (existing.priority < segment.priority) {
      kept.push(existing);
      continue;
    }
    let parts: Array<[number, number]> = [[existing.start, existing.end]];
    for (const [left, right] of pieces) parts = subtract(parts, left, right);
    for (const [left, right] of parts) if (right - left >= 5) kept.push({ ...existing, start: left, end: right });
  }
  placed.length = 0;
  placed.push(...kept);
  for (const [left, right] of pieces) {
    if (right - left >= 5) placed.push({ ...segment, start: left, end: right });
  }
}

function chunks(total: number): number[] {
  const sizes: number[] = [];
  let left = total;
  while (left > 0) {
    sizes.push(left <= 120 ? left : 90);
    left -= sizes[sizes.length - 1];
  }
  if (sizes.length > 1 && sizes[sizes.length - 1] < 30) {
    sizes[sizes.length - 2] += sizes.pop() as number;
  }
  return sizes;
}

function freePiece(index: number, seedText: string): { title: string; kind: BlockKind } {
  const seed = hashSeed(`${seedText}|free|${index}`);
  if (index % 5 === 4) return { title: pick(CHORE_TITLES, seed), kind: 'chore' };
  if (index % 4 === 3) return { title: pick(REST_TITLES, seed), kind: 'rest' };
  return { title: '', kind: 'free' };
}

/** 生成一天的日程骨架；空档已用自由安排铺好。 */
export function generatePlan(
  config: Config,
  date: string,
  travelOverride?: TravelOverride | null,
  exception?: ExceptionDay | null,
  todoBlocks: TodoBlock[] = [],
): Plan {
  const routine = config.routine;
  const weekday = isoWeekday(parseDateKey(date));
  const info = resolveDayInfo(config.holiday, date, weekday);
  const travel = resolveTravel(config.travel, info, date, travelOverride);
  const seed = hashSeed(`${date}|${routineHash(routine)}`);

  const wake = parseHHMM(routine.wake) ?? 7 * 60;
  const sleepRaw = parseHHMM(routine.sleep) ?? 23 * 60;
  const sleepCap = sleepRaw <= wake ? MINUTES_PER_DAY : sleepRaw;
  const sleepAt = sleepRaw <= wake ? `${formatHHMM(sleepRaw)}（次日）` : formatHHMM(sleepRaw);

  const placed: Segment[] = [];
  const anchors: Segment[] = [];

  const anchor = (
    start: number,
    end: number,
    title: string,
    kind: BlockKind,
    priority: number,
    extra: { place?: string; note?: string } = {},
  ) => {
    if (!title || end - start < 5) return;
    anchors.push({ start, end, title, kind, priority, place: extra.place, note: extra.note });
  };

  const wakeEnd = wake + routine.wakeMinutes;
  anchor(wake, wakeEnd, '起床 · 洗漱', 'routine', PRIORITY.routine, { place: '家' });
  if (routine.breakfastMinutes > 0) {
    anchor(wakeEnd, wakeEnd + routine.breakfastMinutes, '早餐', 'meal', PRIORITY.meal, { place: '家' });
  }

  if (routine.work.enabled && (info.workday || (occursOn(routine.work.days, routine.work.repeat ?? '', date, weekday) && !info.rest))) {
    const start = parseHHMM(routine.work.start);
    const end = parseHHMM(routine.work.end);
    if (start !== null && end !== null && end - start >= 30) {
      const commute = routine.commuteMinutes;
      if (commute > 0) {
        anchor(start - commute, start, `通勤 · 去${routine.work.place || routine.work.title}`, 'commute', PRIORITY.commute);
      }
      anchor(start, end, routine.work.place ? `${routine.work.title} · ${routine.work.place}` : routine.work.title, 'work', PRIORITY.work, {
        place: routine.work.place,
      });
      if (commute > 0) anchor(end, end + commute, '通勤 · 回家', 'commute', PRIORITY.commute);
    }
  }

  if (routine.lunch.enabled) {
    const start = parseHHMM(routine.lunch.start);
    if (start !== null) anchor(start, start + routine.lunch.minutes, '午饭', 'meal', PRIORITY.meal, { place: '' });
  }
  if (routine.dinner.enabled) {
    const start = parseHHMM(routine.dinner.start);
    if (start !== null) anchor(start, start + routine.dinner.minutes, '晚饭', 'meal', PRIORITY.meal, { place: '家' });
  }
  if (routine.exercise.enabled && occursOn(routine.exercise.days, routine.exercise.repeat ?? '', date, weekday)) {
    const start = parseHHMM(routine.exercise.start);
    if (start !== null) anchor(start, start + routine.exercise.minutes, routine.exercise.title, 'exercise', PRIORITY.exercise);
  }
  for (const item of routine.fixed) {
    if (!occursOn(item.days, item.repeat ?? '', date, weekday)) continue;
    const start = parseHHMM(item.start);
    if (start === null) continue;
    anchor(start, start + item.minutes, item.title, 'fixed', PRIORITY.fixed, { place: item.place });
  }
  if (travel) {
    const start = parseHHMM(travel.start);
    const end = parseHHMM(travel.end);
    if (start !== null && end !== null) {
      anchor(start, end, travel.title, 'travel', PRIORITY.travel, { place: travel.place, note: travel.note });
    }
  }
  if (routine.windDownMinutes > 0) {
    anchor(sleepCap - routine.windDownMinutes, sleepCap, '洗漱 · 准备睡', 'routine', PRIORITY.routine, { note: `睡觉 ${sleepAt}` });
  }

  anchors.sort((left, right) => left.priority - right.priority || left.start - right.start);
  for (const segment of anchors) {
    if (segment.start < wake) segment.start = wake;
    if (segment.end > sleepCap) segment.end = sleepCap;
    if (segment.end - segment.start < 5) continue;
    addSegment(placed, segment);
  }

  // 旅行日不再排常规运动：只有旅行块真的留下时才移除，被上班/正事挤掉的旅行日仍保留运动。
  if (placed.some((segment) => segment.kind === 'travel')) {
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      if (placed[index].kind === 'exercise') placed.splice(index, 1);
    }
  }

  const sorted = [...placed].sort((left, right) => left.start - right.start);
  const gaps: Gap[] = [];
  let cursor = wake;
  for (const segment of sorted) {
    if (segment.start > cursor) gaps.push({ start: cursor, end: segment.start });
    cursor = Math.max(cursor, segment.end);
  }
  if (sleepCap > cursor) gaps.push({ start: cursor, end: sleepCap });

  let freeIndex = 0;
  const restful = Boolean(exception && (exception.kind === 'sick' || exception.kind === 'half' || exception.kind === 'rest'));
  const pendingTodos = [...todoBlocks];
  for (const gap of gaps) {
    let start = gap.start;
    let remaining = gap.end - gap.start;
    // 先塞待办：只有整段放得下才排，放不下就留给自由安排，不切碎。
    for (let index = 0; index < pendingTodos.length;) {
      const todo = pendingTodos[index];
      if (todo.minutes > remaining) {
        index += 1;
        continue;
      }
      placed.push({
        start,
        end: start + todo.minutes,
        title: todo.title,
        kind: 'todo',
        priority: 85,
        auto: false,
        todoId: todo.id,
      });
      start += todo.minutes;
      remaining -= todo.minutes;
      pendingTodos.splice(index, 1);
    }
    if (remaining < 30) continue;
    for (const size of chunks(remaining)) {
      const piece = restful ? { title: '休息', kind: 'rest' as BlockKind } : freePiece(freeIndex, `${date}|${routineHash(routine)}`);
      const title = piece.title || `自由 · ${routine.hobbies[freeIndex % routine.hobbies.length]}`;
      placed.push({
        start,
        end: start + size,
        title,
        kind: piece.kind,
        priority: 90,
        auto: true,
        note: '',
      });
      start += size;
      freeIndex += 1;
    }
  }

  if (sleepCap < MINUTES_PER_DAY) {
    placed.push({ start: sleepCap, end: MINUTES_PER_DAY, title: '睡觉', kind: 'sleep', priority: 99, auto: true });
  }

  placed.sort((left, right) => left.start - right.start || left.end - right.end);

  const items: PlanItem[] = placed.map((segment, index) => ({
    id: `i${index + 1}`,
    start: formatHHMM(segment.start),
    end: formatHHMM(segment.end),
    title: segment.title,
    kind: segment.kind,
    ...(segment.place ? { place: segment.place } : {}),
    ...(segment.note ? { note: segment.note } : {}),
    status: 'pending',
    ...(segment.auto ? { auto: true } : {}),
    ...(segment.todoId ? { todoId: segment.todoId } : {}),
  }));

  const hasTravelItem = items.some((item) => item.kind === 'travel');
  return {
    version: 1,
    date,
    weekday,
    tone: pick(TONES, hashSeed(`${date}|tone`)),
    note: pick(NOTES, hashSeed(`${date}|note`)),
    source: 'auto',
    routineHash: routineHash(routine),
    configHash: configHash(config),
    generatedAt: new Date().toISOString(),
    edited: false,
    items,
    sleepAt,
    ...(info.holiday ? {
      holiday: {
        name: info.holiday.name,
        kind: info.holiday.kind,
        scale: info.holiday.scale,
        dayIndex: info.holiday.dayIndex,
        days: info.holiday.days,
      },
    } : {}),
    ...(info.workday ? { workday: info.workday } : {}),
    ...(travel && hasTravelItem ? {
      travel: {
        destination: travel.destination,
        dayIndex: travel.dayIndex,
        days: travel.days,
        source: travel.source,
      },
    } : {}),
    ...(exception ? {
      exception: {
        kind: exception.kind,
        label: exceptionLabel(exception.kind),
        note: exception.note,
        createdAt: exception.createdAt,
      },
      exceptionKey: exceptionKey(exception),
    } : {}),
  };
}

/** 自动铺的自由段（连续 auto 项合并成一段空档），供模型润色时参考。 */
export function autoGaps(plan: Plan): Gap[] {
  const gaps: Gap[] = [];
  let run: Gap | null = null;
  for (const item of plan.items) {
    const start = parseHHMM(item.start);
    const end = parseHHMM(item.end);
    if (start === null || end === null || !item.auto || item.kind === 'sleep') {
      if (run) gaps.push(run);
      run = null;
      continue;
    }
    if (!run) run = { start, end };
    else run.end = Math.max(run.end, end);
  }
  if (run) gaps.push(run);
  return gaps;
}

export function planDayLabel(plan: Plan): string {
  const parsed = parseDateKey(plan.date);
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${weekdayLabel(plan.weekday)}`;
}

export function minuteRange(item: { start: string; end: string }): Gap | null {
  const start = parseHHMM(item.start);
  const end = parseHHMM(item.end);
  return start === null || end === null || end <= start ? null : { start, end };
}

export function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}
