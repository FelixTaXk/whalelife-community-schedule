/*! 日程 plugin · 异常日：生病 / 请假 / 加班 / 休息，只覆盖当天，不动长期作息。 */

import { cloneRoutine, type Config } from './types.ts';
import { isValidDateKey } from './time.ts';

export type ExceptionKind = 'sick' | 'leave' | 'overtime' | 'half' | 'rest';

export type ExceptionDay = {
  version: 1;
  date: string;
  kind: ExceptionKind;
  note: string;
  createdAt: string;
};

export const EXCEPTION_KINDS: readonly ExceptionKind[] = ['sick', 'leave', 'overtime', 'half', 'rest'];

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  sick: '生病',
  leave: '请假',
  overtime: '加班',
  half: '休息半天',
  rest: '休息',
};

export const EXCEPTION_HINTS: Record<ExceptionKind, string> = {
  sick: '正事、运动、旅行都停掉，只保留吃饭和休息。',
  leave: '正事和旅行停掉，运动保留，白天自己安排。',
  overtime: '下班延到 21:00，晚饭顺延，运动停掉。',
  half: '上午照常，下午从 12:00 起休息，旅行和运动停掉。',
  rest: '正事、运动、旅行都停掉，把时间还给自己。',
};

export function isExceptionKind(value: unknown): value is ExceptionKind {
  return typeof value === 'string' && (EXCEPTION_KINDS as readonly string[]).includes(value);
}

export function isException(value: unknown): value is ExceptionDay {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return raw.version === 1
    && isValidDateKey(raw.date)
    && isExceptionKind(raw.kind)
    && typeof raw.note === 'string'
    && typeof raw.createdAt === 'string';
}

export function makeException(date: string, kind: ExceptionKind, note = '', now = new Date()): ExceptionDay {
  return {
    version: 1,
    date,
    kind,
    note: note.trim().slice(0, 80) || EXCEPTION_HINTS[kind].split('。')[0],
    createdAt: now.toISOString(),
  };
}

export function exceptionLabel(kind: ExceptionKind): string {
  return EXCEPTION_LABELS[kind];
}

/** 复制一份临时配置，只让当天生成用，不写回设置。 */
export function applyException(config: Config, exception: ExceptionDay): Config {
  const next: Config = {
    ...config,
    routine: cloneRoutine(config.routine),
    holiday: { ...config.holiday, periods: [...config.holiday.periods], workdays: [...config.holiday.workdays] },
    travel: { ...config.travel, spots: config.travel.spots.map((spot) => ({ ...spot })) },
    ai: { ...config.ai },
    journal: { ...config.journal },
    reminder: { ...config.reminder },
  };
  if (exception.kind === 'sick' || exception.kind === 'rest') {
    next.routine.work.enabled = false;
    next.routine.exercise.enabled = false;
    next.travel.enabled = false;
  } else if (exception.kind === 'leave') {
    next.routine.work.enabled = false;
    next.travel.enabled = false;
  } else if (exception.kind === 'half') {
    // 上午照常，下午从 12:00 起留给自己；开始时间本来就晚于中午时直接停正事。
    if (next.routine.work.start >= '12:00') next.routine.work.enabled = false;
    else next.routine.work.end = '12:00';
    next.routine.exercise.enabled = false;
    next.travel.enabled = false;
  } else if (exception.kind === 'overtime') {
    next.routine.work.end = next.routine.work.end < '21:00' ? '21:00' : next.routine.work.end;
    if (next.routine.dinner.start < '21:10') {
      next.routine.dinner.start = '21:15';
      next.routine.dinner.minutes = Math.min(next.routine.dinner.minutes, 30);
    }
    next.routine.exercise.enabled = false;
    next.travel.enabled = false;
  }
  return next;
}

export function exceptionKey(exception: ExceptionDay | null): string {
  return exception ? `${exception.kind}:${exception.note}` : '';
}
