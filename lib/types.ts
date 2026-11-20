/*! 日程 plugin · 配置数据结构、默认作息与校验。 */

import type { WeatherDay } from './weather-types.ts';
import { clamp, formatHHMM, isTime, parseHHMM } from './time.ts';

export type BlockKind =
  | 'routine' | 'meal' | 'commute' | 'work' | 'study'
  | 'exercise' | 'free' | 'chore' | 'rest' | 'social' | 'fixed' | 'sleep';

export const BLOCK_KINDS: readonly BlockKind[] = [
  'routine', 'meal', 'commute', 'work', 'study',
  'exercise', 'free', 'chore', 'rest', 'social', 'fixed', 'sleep',
];

export const KIND_LABEL: Record<BlockKind, string> = {
  routine: '日常',
  meal: '用餐',
  commute: '路上',
  work: '正事',
  study: '学习',
  exercise: '运动',
  free: '自由',
  chore: '家务',
  rest: '休息',
  social: '社交',
  fixed: '固定',
  sleep: '睡觉',
};

export type WorkRoutine = {
  enabled: boolean;
  title: string;
  days: number[];
  start: string;
  end: string;
  place: string;
};

export type MealRoutine = { enabled: boolean; start: string; minutes: number };
export type ExerciseRoutine = { enabled: boolean; title: string; days: number[]; start: string; minutes: number };
export type FixedItem = { title: string; days: number[]; start: string; minutes: number; place: string };

export type Routine = {
  wake: string;
  sleep: string;
  wakeMinutes: number;
  breakfastMinutes: number;
  commuteMinutes: number;
  windDownMinutes: number;
  work: WorkRoutine;
  lunch: MealRoutine;
  dinner: MealRoutine;
  exercise: ExerciseRoutine;
  fixed: FixedItem[];
  hobbies: string[];
};

export type AiConfig = { enabled: boolean; model: string; style: string };

export type Config = {
  version: number;
  enabled: boolean;
  generateAt: string;
  daysAhead: number;
  keepDays: number;
  ai: AiConfig;
  routine: Routine;
};

export type ItemStatus = 'pending' | 'done' | 'skipped';

export type PlanItem = {
  id: string;
  start: string;
  end: string;
  title: string;
  kind: BlockKind;
  place?: string;
  note?: string;
  status: ItemStatus;
  /** 自动铺进空档的自由安排，模型润色时可以整段替换。 */
  auto?: boolean;
};

export type Plan = {
  version: 1;
  date: string;
  weekday: number;
  tone: string;
  note: string;
  source: 'auto' | 'ai' | 'manual';
  routineHash: string;
  generatedAt: string;
  edited: boolean;
  items: PlanItem[];
  aiError?: string;
  /** 睡觉时间；跨过零点时显示「（次日）」。 */
  sleepAt?: string;
  /** 生成/重排时参考的当天天气（仅预报窗口内有）。 */
  weather?: WeatherDay;
  /** 只包含会影响排程的天气类别，用来判断预报变化后要不要重排。 */
  weatherKey?: string;
  /** 因天气做过的调整，展示在日程卡片和工具输出里。 */
  weatherAdjusted?: string[];
};

export const TONES = ['安静', '平稳', '轻快', '有点困', '挺专注', '松松散散', '还不错'] as const;

export const NOTES = [
  '按自己的节奏来，不用赶。',
  '今天给自己留一点空。',
  '事情排得松，慢慢做。',
  '想画就画，不想画就歇会儿。',
  '记得吃点甜的。',
  '晚上早点收笔。',
] as const;

const STUDENT_ROUTINE: Routine = {
  wake: '06:40',
  sleep: '00:30',
  wakeMinutes: 30,
  breakfastMinutes: 25,
  commuteMinutes: 20,
  windDownMinutes: 30,
  work: { enabled: true, title: '上课', days: [1, 2, 3, 4, 5], start: '07:55', end: '17:10', place: '学校' },
  lunch: { enabled: true, start: '12:00', minutes: 60 },
  dinner: { enabled: true, start: '18:30', minutes: 40 },
  exercise: { enabled: false, title: '散步', days: [1, 3, 5], start: '19:30', minutes: 40 },
  fixed: [],
  hobbies: ['画速写', '修照片', '看剧', '听歌', '翻手账', '出去走走'],
};

const OFFICE_ROUTINE: Routine = {
  wake: '07:10',
  sleep: '23:30',
  wakeMinutes: 40,
  breakfastMinutes: 30,
  commuteMinutes: 40,
  windDownMinutes: 30,
  work: { enabled: true, title: '上班', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', place: '公司' },
  lunch: { enabled: true, start: '12:00', minutes: 60 },
  dinner: { enabled: true, start: '19:00', minutes: 45 },
  exercise: { enabled: true, title: '健身', days: [1, 3, 5], start: '20:00', minutes: 45 },
  fixed: [],
  hobbies: ['看剧', '读书', '打游戏', '散步', '做点吃的'],
};

const FREELANCE_ROUTINE: Routine = {
  wake: '08:30',
  sleep: '01:00',
  wakeMinutes: 45,
  breakfastMinutes: 30,
  commuteMinutes: 0,
  windDownMinutes: 30,
  work: { enabled: true, title: '干活', days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00', place: '家' },
  lunch: { enabled: true, start: '12:30', minutes: 45 },
  dinner: { enabled: true, start: '19:30', minutes: 45 },
  exercise: { enabled: true, title: '遛弯', days: [1, 2, 3, 4, 5, 6, 7], start: '19:00', minutes: 30 },
  fixed: [],
  hobbies: ['画画', '剪视频', '看书', '遛弯', '发呆'],
};

export type Preset = { id: string; name: string; hint: string; routine: Routine };

export const PRESETS: readonly Preset[] = [
  { id: 'student', name: '上学（默认）', hint: '白天上课、晚上画画到十二点多', routine: STUDENT_ROUTINE },
  { id: 'office', name: '上班', hint: '朝九晚六，通勤 40 分钟', routine: OFFICE_ROUTINE },
  { id: 'freelance', name: '自由职业', hint: '在家干活，时间自己排', routine: FREELANCE_ROUTINE },
];

export function defaultConfig(): Config {
  return {
    version: 1,
    enabled: true,
    generateAt: '07:00',
    daysAhead: 2,
    keepDays: 60,
    ai: { enabled: false, model: '', style: '' },
    routine: cloneRoutine(STUDENT_ROUTINE),
  };
}

export function cloneRoutine(routine: Routine): Routine {
  return {
    ...routine,
    work: { ...routine.work, days: [...routine.work.days] },
    lunch: { ...routine.lunch },
    dinner: { ...routine.dinner },
    exercise: { ...routine.exercise, days: [...routine.exercise.days] },
    fixed: routine.fixed.map((item) => ({ ...item, days: [...item.days] })),
    hobbies: [...routine.hobbies],
  };
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(Math.round(number), min, max);
}

function time(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const minute = parseHHMM(value);
    if (minute !== null) return formatHHMM(minute);
  }
  return fallback;
}

/** 星期数组：1–7，去重后升序；非数组回落，空数组表示不排。 */
export function normalizeDays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback];
  const set = new Set<number>();
  for (const entry of value) {
    const number = Number(entry);
    if (Number.isInteger(number) && number >= 1 && number <= 7) set.add(number);
  }
  return [...set].sort((a, b) => a - b);
}

function normalizeFixed(value: unknown, fallback: FixedItem[]): FixedItem[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item, days: [...item.days] }));
  const items: FixedItem[] = [];
  for (const entry of value.slice(0, 30)) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    const title = text(source.title, 24);
    if (!title) continue;
    items.push({
      title,
      days: normalizeDays(source.days, [1, 2, 3, 4, 5, 6, 7]),
      start: time(source.start, '09:00'),
      minutes: integer(source.minutes, 60, 10, 480),
      place: text(source.place, 20),
    });
  }
  return items;
}

function normalizeHobbies(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const items: string[] = [];
  for (const entry of value.slice(0, 16)) {
    const name = text(entry, 12);
    if (name && !items.includes(name)) items.push(name);
  }
  return items.length ? items : [...fallback];
}

export function normalizeRoutine(value: unknown): Routine {
  const base = cloneRoutine(STUDENT_ROUTINE);
  if (!value || typeof value !== 'object') return base;
  const raw = value as Record<string, any>;
  const work = raw.work && typeof raw.work === 'object' ? raw.work : {};
  const lunch = raw.lunch && typeof raw.lunch === 'object' ? raw.lunch : {};
  const dinner = raw.dinner && typeof raw.dinner === 'object' ? raw.dinner : {};
  const exercise = raw.exercise && typeof raw.exercise === 'object' ? raw.exercise : {};
  return {
    wake: time(raw.wake, base.wake),
    sleep: time(raw.sleep, base.sleep),
    wakeMinutes: integer(raw.wakeMinutes, base.wakeMinutes, 10, 180),
    breakfastMinutes: integer(raw.breakfastMinutes, base.breakfastMinutes, 0, 120),
    commuteMinutes: integer(raw.commuteMinutes, base.commuteMinutes, 0, 180),
    windDownMinutes: integer(raw.windDownMinutes, base.windDownMinutes, 0, 120),
    work: {
      enabled: bool(work.enabled, base.work.enabled),
      title: text(work.title, 12) || base.work.title,
      days: normalizeDays(work.days, base.work.days),
      start: time(work.start, base.work.start),
      end: time(work.end, base.work.end),
      place: text(work.place, 20),
    },
    lunch: {
      enabled: bool(lunch.enabled, base.lunch.enabled),
      start: time(lunch.start, base.lunch.start),
      minutes: integer(lunch.minutes, base.lunch.minutes, 10, 240),
    },
    dinner: {
      enabled: bool(dinner.enabled, base.dinner.enabled),
      start: time(dinner.start, base.dinner.start),
      minutes: integer(dinner.minutes, base.dinner.minutes, 10, 240),
    },
    exercise: {
      enabled: bool(exercise.enabled, base.exercise.enabled),
      title: text(exercise.title, 12) || base.exercise.title,
      days: normalizeDays(exercise.days, base.exercise.days),
      start: time(exercise.start, base.exercise.start),
      minutes: integer(exercise.minutes, base.exercise.minutes, 10, 180),
    },
    fixed: normalizeFixed(raw.fixed, base.fixed),
    hobbies: normalizeHobbies(raw.hobbies, base.hobbies),
  };
}

export function normalizeConfig(value: unknown, fallback: Config = defaultConfig()): Config {
  const raw = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const ai = raw.ai && typeof raw.ai === 'object' ? raw.ai : {};
  return {
    version: 1,
    enabled: bool(raw.enabled, fallback.enabled),
    generateAt: time(raw.generateAt, fallback.generateAt),
    daysAhead: integer(raw.daysAhead, fallback.daysAhead, 1, 7),
    keepDays: integer(raw.keepDays, fallback.keepDays, 7, 365),
    ai: {
      enabled: bool(ai.enabled, false),
      model: text(ai.model, 80),
      style: text(ai.style, 300),
    },
    routine: raw.routine === undefined ? cloneRoutine(fallback.routine) : normalizeRoutine(raw.routine),
  };
}

/** 固定安排文本框：每行「标题 | 星期 | 开始 | 分钟 | 地点」。 */
export function parseFixedText(value: unknown): { items: FixedItem[]; errors: string[] } {
  if (typeof value !== 'string') return { items: [], errors: [] };
  const items: FixedItem[] = [];
  const errors: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (items.length >= 30) {
      errors.push('固定安排最多 30 条，后面的没有保存');
      break;
    }
    const parts = line.split(/\||｜/).map((part) => part.trim());
    const title = parts[0] ?? '';
    if (!title) {
      errors.push(`第 ${items.length + 1} 条缺少标题`);
      continue;
    }
    const days = parseDaysText(parts[1] ?? '每天');
    if (!days.length) {
      errors.push(`「${title}」的星期写法看不懂，用 1,3,5 或 每天 / 工作日 / 周末`);
      continue;
    }
    const start = parseHHMM(parts[2] ?? '');
    if (start === null) {
      errors.push(`「${title}」的开始时间不是 HH:MM`);
      continue;
    }
    const minutes = Number(parts[3] ?? 60);
    if (!Number.isFinite(minutes) || minutes < 10 || minutes > 480) {
      errors.push(`「${title}」的分钟数要在 10–480 之间`);
      continue;
    }
    items.push({
      title: title.slice(0, 24),
      days,
      start: formatHHMM(start),
      minutes: Math.round(minutes),
      place: (parts[4] ?? '').slice(0, 20),
    });
  }
  return { items, errors };
}

function parseDaysText(value: string): number[] {
  const compact = value.replace(/\s+/g, '');
  if (!compact) return [1, 2, 3, 4, 5, 6, 7];
  if (compact === '每天' || compact === '天天' || compact === '*' || compact === '每日') return [1, 2, 3, 4, 5, 6, 7];
  if (compact === '工作日' || compact === '周一到周五') return [1, 2, 3, 4, 5];
  if (compact === '周末') return [6, 7];
  if (/^[1-7](?:[,、，/][1-7])*$/.test(compact)) {
    return normalizeDays(compact.split(/[,、，/]/).map(Number), []);
  }
  return [];
}

export function formatFixedText(items: FixedItem[]): string {
  return items
    .map((item) => [item.title, item.days.join(','), item.start, String(Math.round(item.minutes)), item.place]
      .join(' | ').replace(/ \| $/, ''))
    .join('\n');
}

export function isPlan(value: unknown, date: string): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Record<string, unknown>;
  if (plan.version !== 1 || plan.date !== date) return false;
  if (!Array.isArray(plan.items)) return false;
  return plan.items.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const entry = item as Record<string, unknown>;
    return typeof entry.id === 'string' && isTime(entry.start)
      && (isTime(entry.end) || entry.end === '24:00')
      && typeof entry.title === 'string' && BLOCK_KINDS.includes(entry.kind as BlockKind)
      && ['pending', 'done', 'skipped'].includes(String(entry.status));
  });
}
