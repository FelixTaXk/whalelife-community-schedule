/*! 日程 plugin · 配置数据结构、默认作息与校验。 */

import type { WeatherDay, WeatherHour } from './weather-types.ts';
import { fixedWhenText, normalizeRepeat, occursOn, parseFixedWhen, repeatInput } from './recurrence.ts';
import { clamp, formatHHMM, isTime, isValidDateKey, parseHHMM } from './time.ts';

export type BlockKind =
  | 'routine' | 'meal' | 'commute' | 'work' | 'study'
  | 'exercise' | 'free' | 'chore' | 'rest' | 'social' | 'fixed' | 'travel' | 'sleep' | 'todo' | 'surf';

export const BLOCK_KINDS: readonly BlockKind[] = [
  'routine', 'meal', 'commute', 'work', 'study',
  'exercise', 'free', 'chore', 'rest', 'social', 'fixed', 'travel', 'sleep', 'todo', 'surf',
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
  travel: '旅行',
  sleep: '睡觉',
  todo: '待办',
  surf: '冲浪',
};

export type WorkRoutine = {
  enabled: boolean;
  title: string;
  days: number[];
  start: string;
  end: string;
  place: string;
  /** 可空的重复规则：weekly / biweekly@日期 / monthly:N / last。 */
  repeat?: string;
};

export type MealRoutine = { enabled: boolean; start: string; minutes: number };
export type ExerciseRoutine = {
  enabled: boolean;
  title: string;
  days: number[];
  start: string;
  minutes: number;
  repeat?: string;
};
export type FixedItem = {
  title: string;
  days: number[];
  start: string;
  minutes: number;
  place: string;
  /** 可空的重复规则；空表示按 days 每周。 */
  repeat?: string;
};

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

/** 人格日记：按当天日程、天气和穿搭自动写一篇，可由写它的人格再读回来。 */
export type JournalStyleId = 'natural' | 'plain' | 'warm' | 'playful' | 'literary' | 'reflection' | 'custom';

export type JournalStyle = { id: JournalStyleId; name: string; hint: string; prompt: string };

export const JOURNAL_STYLES: readonly JournalStyle[] = [
  {
    id: 'natural',
    name: '自然记录',
    hint: '像随手记下的一天，具体、平静，不刻意抒情',
    prompt: '用自然、具体的语气记录今天，写清楚发生了什么、当时的感受和一个小细节；不堆形容词，不写总结报告。',
  },
  {
    id: 'plain',
    name: '克制纪实',
    hint: '按时间线写事实，少评价，像私人日志',
    prompt: '以克制、纪实的方式写，按时间顺序写关键片段；少用比喻和评价，保留一点自己的判断。',
  },
  {
    id: 'warm',
    name: '温柔陪伴',
    hint: '语气柔和，关注身体和情绪，不鸡汤',
    prompt: '用温柔、贴近的语气写，关注今天的身体状态、情绪起伏和被人照顾/照顾自己的瞬间；不要空泛地鼓励。',
  },
  {
    id: 'playful',
    name: '轻松俏皮',
    hint: '带一点吐槽和玩笑，但不刻薄',
    prompt: '用轻松、俏皮的口吻写，可以有一点自嘲和吐槽，但不刻薄、不攻击别人；仍然要写具体发生的事。',
  },
  {
    id: 'literary',
    name: '文学随笔',
    hint: '有画面和节奏，比喻服务事实，不堆砌',
    prompt: '用文学随笔的写法，写出光线、声音、气味和动作的画面；比喻要服务当天真实发生的事，不要堆砌辞藻。',
  },
  {
    id: 'reflection',
    name: '复盘反思',
    hint: '写今天做成了什么、卡在哪、明天想改什么',
    prompt: '用复盘的语气写：今天完成了什么、哪里卡住了、身体和情绪如何、明天最想调整的一件事；不要写成工作汇报。',
  },
  {
    id: 'custom',
    name: '自定义',
    hint: '按你写的风格说明或示例来',
    prompt: '',
  },
];

export type JournalConfig = {
  enabled: boolean;
  /** 空 = 只有一个角色时自动用它；多角色时必须选。 */
  persona: string;
  /** 空 = 跟随所选人格的模型。 */
  model: string;
  /** 空 = 按睡前洗漱时间自动推算；填 HH:MM 则固定。 */
  at: string;
  style: JournalStyleId;
  customStyle: string;
  styleSample: string;
  useWeather: boolean;
  useWardrobe: boolean;
};

export type JournalEntry = {
  version: 1;
  date: string;
  personaId: string;
  personaName: string;
  title: string;
  body: string;
  mood: string;
  tags: string[];
  style: JournalStyleId;
  styleName: string;
  model: string;
  source: 'auto' | 'manual' | 'edited';
  createdAt: string;
  facts: {
    items: number;
    done: number;
    skipped: number;
    weather?: string;
    wardrobe?: string;
    exception?: string;
    travel?: string;
    holiday?: string;
  };
};

/** 网上冲浪排期：只在检测到对应子插件时把刷视频放进自由时间，不自动播放。 */
export type SurfConfig = {
  enabled: boolean;
  /** 空 = 所有当前可用的平台；填平台 ID 只排这些。 */
  platforms: string[];
  minutes: number;
  perDay: number;
};

/** 只读 ICS 订阅：关闭时只能手动下载，开启时在本机起一个带随机令牌的 HTTP 出口。 */
export type IcsConfig = { enabled: boolean; port: number };

export type ReminderConfig = {
  enabled: boolean;
  channel: string;
  account: string;
  peer: string;
  persona: string;
  leadMinutes: number;
  maxPerDay: number;
  quietStart: string;
  quietEnd: string;
  usePersona: boolean;
  /** 按事项类型单独提前分钟；缺省用 leadMinutes。 */
  leads: Record<string, number>;
  /** 休息日/节假日是否跳过提醒。 */
  restDaySilent: boolean;
  /** 稍后提醒的默认延后分钟。 */
  snoozeMinutes: number;
};

export type HolidayKind = 'statutory' | 'student' | 'custom';
export type HolidayScale = 'short' | 'long';

export type HolidayPeriod = {
  name: string;
  start: string;
  end: string;
  kind: HolidayKind;
  scale: HolidayScale;
};

export type HolidayConfig = {
  enabled: boolean;
  /** 内置中国 2026–2027 法定节假日和调休上班日；默认关闭，其他地区用自定义假期。 */
  builtin: boolean;
  /** 只有打开后，kind=student 的自定义假期才生效。 */
  student: boolean;
  /** 哪几天算周末，1 = 周一 … 7 = 周日；默认周六、周日。 */
  weekendDays?: number[];
  periods: HolidayPeriod[];
  /** 额外的调休上班日，YYYY-MM-DD。 */
  workdays: string[];
};

export type TravelDistance = 'near' | 'far';
export type TravelSource = 'user' | 'ai' | 'pool';

export type TravelSpot = {
  name: string;
  distance: TravelDistance;
  minDays: number;
  maxDays: number;
  /** 指定日期段，格式 YYYY-MM-DD~YYYY-MM-DD；空表示不限。 */
  from: string;
  to: string;
  note: string;
};

export type TravelConfig = {
  enabled: boolean;
  weekend: boolean;
  shortHoliday: boolean;
  longHoliday: boolean;
  /** 1 = 每个周末，2 = 隔一个周末，最多 4。 */
  weekendEvery: number;
  /** 有可用模型时，让 AI 从地点池里挑；失败回退规则。 */
  aiChoose: boolean;
  /** 指定目的地；有值时优先于地点池和 AI。 */
  target: string;
  targetFrom: string;
  targetTo: string;
  style: string;
  spots: TravelSpot[];
  /** 整趟旅行的总预算；0 表示未填，只给分配建议。 */
  budget: number;
  /** ISO 货币代码或常用符号；默认 CNY。 */
  currency: string;
};

/** 地区与显示习惯：周起始日、界面语言、时区。时区留空时跟随系统。 */
export type RegionConfig = {
  weekStart: number;
  language: 'zh-CN' | 'en-US';
  timezone: string;
};

export type Config = {
  version: number;
  enabled: boolean;
  generateAt: string;
  daysAhead: number;
  keepDays: number;
  ai: AiConfig;
  journal: JournalConfig;
  reminder: ReminderConfig;
  holiday: HolidayConfig;
  travel: TravelConfig;
  ics: IcsConfig;
  region: RegionConfig;
  routine: Routine;
  surf: SurfConfig;
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
  /** 来自待办池的条目 ID，用于完成时回写待办状态。 */
  todoId?: string;
  /** 重复规则：weekly / biweekly@YYYY-MM-DD / monthly:N / !YYYY-MM-DD。 */
  repeat?: string;
};

/** 待办池条目：pool 未排期，scheduled 已绑定某天，done 已完成。 */
export type TodoItem = {
  id: string;
  title: string;
  minutes: number;
  priority: 'normal' | 'must';
  status: 'pool' | 'scheduled' | 'done';
  createdAt: string;
  scheduledDate?: string;
  note?: string;
};

/** 生成日程时可放进空档的待办摘要。 */
export type TodoBlock = { id: string; title: string; minutes: number };

export function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && item.id.length > 0
    && typeof item.title === 'string'
    && item.title.length > 0
    && typeof item.minutes === 'number'
    && Number.isFinite(item.minutes)
    && (item.priority === 'normal' || item.priority === 'must')
    && (item.status === 'pool' || item.status === 'scheduled' || item.status === 'done')
    && typeof item.createdAt === 'string';
}

export function normalizeTodo(value: unknown): TodoItem | null {
  if (!isTodoItem(value)) return null;
  return {
    id: value.id.slice(0, 40),
    title: value.title.trim().slice(0, 60),
    minutes: integer(value.minutes, 30, 10, 480),
    priority: value.priority === 'must' ? 'must' : 'normal',
    status: value.status,
    createdAt: value.createdAt.slice(0, 40),
    scheduledDate: typeof value.scheduledDate === 'string' && isValidDateKey(value.scheduledDate) ? value.scheduledDate : undefined,
    note: typeof value.note === 'string' ? value.note.trim().slice(0, 120) : undefined,
  };
}

/** 旅行当天可执行的行程单；不写死城市和交通方式，只给可改的骨架。 */
export type TravelItinerary = {
  transport: string;
  lodging: string;
  checklist: string[];
  budget: string;
  backup: string;
};

export type Plan = {
  version: 1;  date: string;
  weekday: number;
  tone: string;
  note: string;
  source: 'auto' | 'ai' | 'manual';
  routineHash: string;
  /** 节假日、旅行等非作息配置的哈希，用来判断旧计划是否需要重排。 */
  configHash?: string;
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
  /** 当天逐小时天气，供页面和户外/通勤排程参考。 */
  hourly?: WeatherHour[];
  /** 因天气做过的调整，展示在日程卡片和工具输出里。 */
  weatherAdjusted?: string[];
  /** 当天命中的法定/自定义假期；调休上班日会单独记在 workday。 */
  holiday?: {
    name: string;
    kind: HolidayKind;
    scale: HolidayScale;
    dayIndex: number;
    days: number;
  };
  /** 调休上班日名称；有值时即便周末也按工作日排正事。 */
  workday?: string;
  /** 当天的旅行安排（短途或长假中的某一天）。 */
  travel?: {
    destination: string;
    dayIndex: number;
    days: number;
    source: TravelSource;
    /** 当天可执行的行程单：交通、住宿、清单、预算、坏天气备选。 */
    itinerary?: TravelItinerary;
  };
  /** 当天是异常日时保留原因，方便复盘和展示。 */
  exception?: {
    kind: 'sick' | 'leave' | 'overtime' | 'half' | 'rest';
    label: string;
    note: string;
    createdAt: string;
  };
  /** 异常日指纹；配置没变但原因改了时也触发重排。 */
  exceptionKey?: string;
};

export const TONES = ['安静', '平稳', '轻快', '有点困', '挺专注', '松松散散', '还不错'] as const;

export const NOTES = [
  '按自己的节奏来，不用赶。',
  '今天给自己留一点空。',
  '事情排得松，慢慢做。',
  '想休息就休息，不用硬撑。',
  '记得吃点喜欢的。',
  '晚上早点收尾。',
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
  hobbies: ['复习', '看剧', '听歌', '运动', '出去走走', '做点手工'],
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
  { id: 'office', name: '上班（默认）', hint: '朝九晚六，通勤 40 分钟', routine: OFFICE_ROUTINE },
  { id: 'student', name: '上学', hint: '白天上课，晚上按自己的节奏安排', routine: STUDENT_ROUTINE },
  { id: 'freelance', name: '自由职业', hint: '在家干活，时间自己排', routine: FREELANCE_ROUTINE },
];

/** 当前作息与哪个模板完全一致；被手动改过时返回空字符串。 */
export function presetIdOfRoutine(routine: Routine): string {
  const value = JSON.stringify(normalizeRoutine(routine));
  for (const preset of PRESETS) {
    if (JSON.stringify(normalizeRoutine(preset.routine)) === value) return preset.id;
  }
  return '';
}

export function defaultConfig(): Config {
  return {
    version: 1,
    enabled: true,
    generateAt: '07:00',
    daysAhead: 2,
    keepDays: 60,
    ai: { enabled: false, model: '', style: '' },
    journal: {
      enabled: false,
      persona: '',
      model: '',
      at: '',
      style: 'natural',
      customStyle: '',
      styleSample: '',
      useWeather: true,
      useWardrobe: true,
    },
    reminder: {
      enabled: false,
      channel: 'qq',
      account: '',
      peer: '',
      persona: '',
      leadMinutes: 10,
      maxPerDay: 6,
      quietStart: '23:30',
      quietEnd: '06:30',
      usePersona: true,
      leads: { fixed: 10, work: 15, todo: 10 },
      restDaySilent: true,
      snoozeMinutes: 10,
    },
    holiday: { enabled: true, builtin: false, student: false, weekendDays: [6, 7], periods: [], workdays: [] },
    travel: {
      enabled: false,
      weekend: true,
      shortHoliday: true,
      longHoliday: true,
      weekendEvery: 1,
      aiChoose: false,
      target: '',
      targetFrom: '',
      targetTo: '',
      style: '',
      spots: [],
      budget: 0,
      currency: 'CNY',
    },
    ics: { enabled: false, port: 38765 },
    region: { weekStart: 1, language: 'zh-CN', timezone: '' },
    surf: { enabled: false, platforms: [], minutes: 30, perDay: 1 },
    routine: cloneRoutine(OFFICE_ROUTINE),
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
      repeat: normalizeRepeat(source.repeat),
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

function dateValue(value: unknown): string {
  return typeof value === 'string' && isValidDateKey(value.trim()) ? value.trim() : '';
}

function normalizeHolidayPeriods(value: unknown): HolidayPeriod[] {
  if (!Array.isArray(value)) return [];
  const items: HolidayPeriod[] = [];
  for (const entry of value.slice(0, 30)) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    const name = text(source.name, 24);
    const start = dateValue(source.start);
    const end = dateValue(source.end);
    if (!name || !start || !end || end < start) continue;
    const kind: HolidayKind = source.kind === 'student' || source.kind === 'statutory' ? source.kind : 'custom';
    const scale: HolidayScale = source.scale === 'short' ? 'short' : 'long';
    items.push({ name, start, end, kind, scale });
  }
  return items;
}

function normalizeWorkdays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 40).map(dateValue).filter(Boolean))].sort();
}

function normalizeHolidayConfig(value: unknown, fallback: HolidayConfig): HolidayConfig {
  const defaultWeekend = fallback.weekendDays?.length ? fallback.weekendDays : [6, 7];
  if (!value || typeof value !== 'object') {
    return {
      ...fallback,
      weekendDays: [...defaultWeekend],
      periods: [...fallback.periods],
      workdays: [...fallback.workdays],
    };
  }
  const raw = value as Record<string, any>;
  const weekendDays = normalizeDays(raw.weekendDays, defaultWeekend);
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    builtin: bool(raw.builtin, fallback.builtin),
    student: bool(raw.student, fallback.student),
    weekendDays: weekendDays.length ? weekendDays : [...defaultWeekend],
    periods: normalizeHolidayPeriods(raw.periods),
    workdays: normalizeWorkdays(raw.workdays),
  };
}

function normalizeTravelSpots(value: unknown): TravelSpot[] {
  if (!Array.isArray(value)) return [];
  const items: TravelSpot[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 20)) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, any>;
    const name = text(source.name, 24);
    if (!name || seen.has(name)) continue;
    const distance: TravelDistance = source.distance === 'far' ? 'far' : 'near';
    const minDays = integer(source.minDays, 1, 1, 15);
    const maxDays = integer(source.maxDays, Math.max(minDays, 3), minDays, 15);
    const from = dateValue(source.from);
    const to = dateValue(source.to);
    if ((from && !to) || (!from && to) || (from && to && to < from)) continue;
    seen.add(name);
    items.push({ name, distance, minDays, maxDays, from, to, note: text(source.note, 40) });
  }
  return items;
}

function normalizeTravelConfig(value: unknown, fallback: TravelConfig): TravelConfig {
  if (!value || typeof value !== 'object') {
    return { ...fallback, spots: [...fallback.spots] };
  }
  const raw = value as Record<string, any>;
  const targetFrom = dateValue(raw.targetFrom);
  const targetTo = dateValue(raw.targetTo);
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    weekend: bool(raw.weekend, fallback.weekend),
    shortHoliday: bool(raw.shortHoliday, fallback.shortHoliday),
    longHoliday: bool(raw.longHoliday, fallback.longHoliday),
    weekendEvery: integer(raw.weekendEvery, fallback.weekendEvery, 1, 4),
    aiChoose: bool(raw.aiChoose, fallback.aiChoose),
    target: text(raw.target, 24),
    targetFrom: targetFrom && targetTo && targetTo < targetFrom ? '' : targetFrom,
    targetTo: targetFrom && targetTo && targetTo < targetFrom ? '' : targetTo,
    style: text(raw.style, 300),
    spots: normalizeTravelSpots(raw.spots),
    budget: integer(raw.budget, fallback.budget ?? 0, 0, 1_000_000),
    currency: text(raw.currency, 8) || fallback.currency || 'CNY',
  };
}

export function normalizeRoutine(value: unknown): Routine {
  const base = cloneRoutine(OFFICE_ROUTINE);  if (!value || typeof value !== 'object') return base;
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
      repeat: normalizeRepeat(work.repeat),
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
      repeat: normalizeRepeat(exercise.repeat),
    },
    fixed: normalizeFixed(raw.fixed, base.fixed),
    hobbies: normalizeHobbies(raw.hobbies, base.hobbies),
  };
}

function normalizeLeads(value: unknown, fallback: Record<string, number>): Record<string, number> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const leads: Record<string, number> = { ...fallback };
  for (const kind of BLOCK_KINDS) {
    if (source[kind] !== undefined) leads[kind] = integer(source[kind], leads[kind] ?? 10, 0, 120);
  }
  return leads;
}

function normalizeJournalConfig(value: unknown, fallback: JournalConfig): JournalConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const style = JOURNAL_STYLES.some((item) => item.id === raw.style) ? raw.style as JournalStyleId : fallback.style;
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    persona: raw.persona === undefined ? fallback.persona : text(raw.persona, 80),
    model: raw.model === undefined ? fallback.model : text(raw.model, 80),
    at: raw.at === undefined ? fallback.at : (raw.at ? time(raw.at, '') : ''),
    style,
    customStyle: raw.customStyle === undefined ? fallback.customStyle : text(raw.customStyle, 500),
    styleSample: raw.styleSample === undefined ? fallback.styleSample : text(raw.styleSample, 800),
    useWeather: bool(raw.useWeather, fallback.useWeather),
    useWardrobe: bool(raw.useWardrobe, fallback.useWardrobe),
  };
}

function normalizeSurfConfig(value: unknown, fallback: SurfConfig): SurfConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const platforms = Array.isArray(raw.platforms)
    ? [...new Set(raw.platforms.map((id: unknown) => text(id, 40)).filter(Boolean))].slice(0, 8)
    : [...fallback.platforms];
  return {
    enabled: bool(raw.enabled, fallback.enabled),
    platforms,
    minutes: integer(raw.minutes, fallback.minutes, 10, 180),
    perDay: integer(raw.perDay, fallback.perDay, 1, 3),
  };
}

export function normalizeConfig(value: unknown, fallback: Config = defaultConfig()): Config {
  const raw = value && typeof value === 'object' ? (value as Record<string, any>) : {};
  const ai = raw.ai && typeof raw.ai === 'object' ? raw.ai : {};
  const reminder = raw.reminder && typeof raw.reminder === 'object' ? raw.reminder : {};
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
    journal: normalizeJournalConfig(raw.journal, fallback.journal),
    reminder: {
      enabled: bool(reminder.enabled, false),
      channel: text(reminder.channel, 40) || fallback.reminder.channel,
      account: text(reminder.account, 40),
      peer: text(reminder.peer, 80),
      persona: reminder.persona === undefined ? fallback.reminder.persona : text(reminder.persona, 40),
      leadMinutes: integer(reminder.leadMinutes, fallback.reminder.leadMinutes, 0, 60),
      maxPerDay: integer(reminder.maxPerDay, fallback.reminder.maxPerDay, 1, 20),
      quietStart: time(reminder.quietStart, fallback.reminder.quietStart),
      quietEnd: time(reminder.quietEnd, fallback.reminder.quietEnd),
      usePersona: bool(reminder.usePersona, fallback.reminder.usePersona),
      leads: normalizeLeads(reminder.leads, fallback.reminder.leads),
      restDaySilent: bool(reminder.restDaySilent, fallback.reminder.restDaySilent),
      snoozeMinutes: integer(reminder.snoozeMinutes, fallback.reminder.snoozeMinutes, 1, 60),
    },
    holiday: normalizeHolidayConfig(raw.holiday, fallback.holiday),
    travel: normalizeTravelConfig(raw.travel, fallback.travel),
    ics: {
      enabled: bool(raw.ics?.enabled, fallback.ics?.enabled ?? false),
      port: integer(raw.ics?.port, fallback.ics?.port ?? 38765, 1024, 65535),
    },
    region: {
      weekStart: integer(raw.region?.weekStart, fallback.region?.weekStart ?? 1, 1, 7),
      language: raw.region?.language === 'en-US' ? 'en-US' : 'zh-CN',
      timezone: text(raw.region?.timezone, 40),
    },
    surf: normalizeSurfConfig(raw.surf, fallback.surf),
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
    const when = parseFixedWhen(parts[1] ?? '每天');
    if (!when.days.length || when.error) {
      errors.push(`「${title}」的星期/重复规则看不懂：${when.error || '用 1,3,5 或 每天 / 工作日 / 周末，也可以写 双周 1,3,5 @2026-11-16'}`);
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
      days: when.days,
      start: formatHHMM(start),
      minutes: Math.round(minutes),
      place: (parts[4] ?? '').slice(0, 20),
      repeat: when.repeat,
    });
  }
  return { items, errors };
}

/** 自定义假期文本框：每行「名称 | 开始 | 结束 | 短假/长假/寒暑假」。 */
export function parseHolidayText(value: unknown): { periods: HolidayPeriod[]; errors: string[] } {
  if (typeof value !== 'string') return { periods: [], errors: [] };
  const periods: HolidayPeriod[] = [];
  const errors: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (periods.length >= 30) {
      errors.push('自定义假期最多 30 条，后面的没有保存');
      break;
    }
    const parts = line.split(/\||｜/).map((part) => part.trim());
    const name = (parts[0] ?? '').slice(0, 24);
    const start = dateValue(parts[1]);
    const end = dateValue(parts[2]);
    if (!name) {
      errors.push(`第 ${periods.length + 1} 条缺少假期名称`);
      continue;
    }
    if (!start || !end || end < start) {
      errors.push(`「${name}」的日期要是 YYYY-MM-DD，且结束不早于开始`);
      continue;
    }
    const type = parts[3] ?? '';
    const kind: HolidayKind = /寒|暑|学生/.test(type) ? 'student' : 'custom';
    const daySpan = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    const scale: HolidayScale = /短/.test(type) ? 'short' : (/长|寒|暑/.test(type) || daySpan > 3 ? 'long' : 'short');
    periods.push({ name, start, end, kind, scale });
  }
  return { periods, errors };
}

export function formatHolidayText(periods: HolidayPeriod[]): string {
  return periods.map((period) => {
    const type = period.kind === 'student' ? '寒暑假' : period.scale === 'short' ? '短假' : '长假';
    return `${period.name} | ${period.start} | ${period.end} | ${type}`;
  }).join('\n');
}

/** 额外调休上班日：每行一个 YYYY-MM-DD，或「YYYY-MM-DD | 名称」。 */
export function parseWorkdaysText(value: unknown): { workdays: string[]; errors: string[] } {
  if (typeof value !== 'string') return { workdays: [], errors: [] };
  const workdays: string[] = [];
  const errors: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const date = dateValue(line.split(/\||｜/)[0].trim());
    if (!date) {
      errors.push(`「${line.slice(0, 30)}」不是有效日期`);
      continue;
    }
    if (!workdays.includes(date)) workdays.push(date);
  }
  return { workdays: workdays.sort(), errors };
}

export function formatWorkdaysText(workdays: string[]): string {
  return workdays.join('\n');
}

/** 旅行地点池：每行「地点 | 近/远 | 最少天 | 最多天 | 日期段(可空) | 备注」。 */
export function parseTravelText(value: unknown): { spots: TravelSpot[]; errors: string[] } {
  if (typeof value !== 'string') return { spots: [], errors: [] };
  const spots: TravelSpot[] = [];
  const errors: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (spots.length >= 20) {
      errors.push('旅行地点最多 20 个，后面的没有保存');
      break;
    }
    const parts = line.split(/\||｜/).map((part) => part.trim());
    const name = (parts[0] ?? '').slice(0, 24);
    if (!name) {
      errors.push(`第 ${spots.length + 1} 条缺少地点名`);
      continue;
    }
    const distance: TravelDistance = /远/.test(parts[1] ?? '') ? 'far' : 'near';
    const minDays = Number(parts[2] ?? 1);
    const maxDays = Number(parts[3] ?? Math.max(1, minDays));
    if (!Number.isFinite(minDays) || !Number.isFinite(maxDays) || minDays < 1 || maxDays < minDays || maxDays > 15) {
      errors.push(`「${name}」的天数要满足 1 ≤ 最少天 ≤ 最多天 ≤ 15`);
      continue;
    }
    const range = (parts[4] ?? '').replace(/[～至]/g, '~');
    const [fromRaw, toRaw] = range.split('~').map((part) => part.trim());
    const from = fromRaw ? dateValue(fromRaw) : '';
    const to = toRaw ? dateValue(toRaw) : (from ? from : '');
    if ((fromRaw && !from) || (toRaw && !to) || (from && to && to < from)) {
      errors.push(`「${name}」的指定日期要写成 YYYY-MM-DD~YYYY-MM-DD`);
      continue;
    }
    if (spots.some((spot) => spot.name === name)) continue;
    spots.push({
      name,
      distance,
      minDays: Math.round(minDays),
      maxDays: Math.round(maxDays),
      from,
      to,
      note: (parts[5] ?? '').slice(0, 40),
    });
  }
  return { spots, errors };
}

export function formatTravelText(spots: TravelSpot[]): string {
  return spots.map((spot) => {
    const range = spot.from ? `${spot.from}~${spot.to}` : '';
    return [spot.name, spot.distance === 'far' ? '远' : '近', String(spot.minDays), String(spot.maxDays), range, spot.note]
      .join(' | ').replace(/ \| $/, '');
  }).join('\n');
}

export function formatFixedText(items: FixedItem[]): string {
  return items
    .map((item) => [item.title, fixedWhenText(item.days, item.repeat ?? ''), item.start, String(Math.round(item.minutes)), item.place]
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
