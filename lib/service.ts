/*! 日程 plugin · 运行时服务：配置、补生成、编辑、清理。 */

import { randomUUID } from 'node:crypto';
import type { Context } from '../../../core/context.ts';
import { augmentWithModel } from './ai.ts';
import { applyException, exceptionKey, isExceptionKind, makeException, type ExceptionDay, type ExceptionKind } from './exceptions.ts';
import { resolveDayInfo } from './holidays.ts';
import { generatePlan, isStale } from './plan.ts';
import { weeklyReview, weekStartOf, type WeeklyReview } from './review.ts';
import type { BlockKind, Config, ItemStatus, Plan, PlanItem, TodoBlock, TodoItem } from './types.ts';
import { BLOCK_KINDS, normalizeConfig } from './types.ts';
import { resolveTravel, travelCandidates, travelKey, attachItinerary, type TravelOverride } from './travel.ts';
import { chooseTravelWithModel } from './travel-ai.ts';
import type { WeatherBridge } from './weather-bridge.ts';
import type { WeatherDay } from './weather-types.ts';
import { applyWeatherRules, applyHourlyRules, weatherKey } from './weather-rules.ts';
import { Store } from './store.ts';
import { addDays, dateKey, formatHHMM, isValidDateKey, isoWeekday, minuteOfDay, parseDateKey, parseHHMM } from './time.ts';

export type EnsureOptions = { force?: boolean; allowAi?: boolean };

export type EditInput = {
  id?: string;
  action: string;
  start?: string;
  end?: string;
  title?: string;
  note?: string;
  place?: string;
  kind?: string;
  status?: string;
};

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export class ScheduleService {
  private ctx: Context;
  private store: Store;
  private inFlight = new Map<string, Promise<Plan>>();
  private chains = new Map<string, Promise<unknown>>();
  private ticking = false;
  private current: Config;
  private weather: WeatherBridge | null = null;

  lastError = '';
  lastTickAt = '';

  constructor(ctx: Context, config: Config) {
    this.ctx = ctx;
    this.store = new Store(ctx);
    this.current = config;
  }

  /** 由父插件 index 注入；没有天气时一切照旧。 */
  setWeather(weather: WeatherBridge): void {
    this.weather = weather;
  }

  private liveDay(date: string): WeatherDay | null {
    const snapshot = this.weather?.peek();
    return snapshot?.days.find((entry) => entry.date === date) ?? null;
  }

  private async fetchDay(date: string): Promise<WeatherDay | null> {
    const live = this.liveDay(date);
    if (live) return live;
    const snapshot = await this.weather?.refresh();
    return snapshot?.days.find((entry) => entry.date === date) ?? null;
  }

  /** 长假/周末的旅行目的地：指定地点优先，其次 AI 从池里挑，最后用规则轮换。 */
  private async travelOverride(config: Config, date: string): Promise<TravelOverride | null> {
    if (!config.travel.enabled || !config.travel.aiChoose || config.travel.target) return null;
    const info = resolveDayInfo(config.holiday, date, isoWeekday(parseDateKey(date)));
    const base = resolveTravel(config.travel, info, date);
    if (!base) return null;
    const cached = await this.store.readTravelChoice(base.key).catch(() => null);
    if (cached) return { destination: cached.destination, days: cached.days, source: 'ai', reason: cached.reason };
    if (base.dayIndex !== 0) return null;
    const candidates = travelCandidates(config.travel, info, date);
    if (!candidates.length) return null;
    const limit = info.holiday ? Math.min(info.holiday.days, 6) : 1;
    try {
      const choice = await chooseTravelWithModel(this.ctx, config, info, candidates, limit);
      if (!choice) return null;
      await this.store.writeTravelChoice({ ...choice, key: travelKey(info, date) });
      return { destination: choice.destination, days: choice.days, source: 'ai', reason: choice.reason };
    } catch (error) {
      this.ctx.logger.warn('旅行 AI 选择失败，改用规则', { date, error: errorText(error) });
      return null;
    }
  }

  static async create(ctx: Context): Promise<ScheduleService> {
    const raw = await ctx.config.read<unknown>('config.json').catch(() => ({}));
    return new ScheduleService(ctx, normalizeConfig(raw ?? {}));
  }

  get config(): Config {
    return this.current;
  }

  async saveConfig(next: unknown): Promise<Config> {
    const normalized = normalizeConfig(next, this.current);
    await this.ctx.config.save('config.json', normalized);
    this.current = normalized;
    return normalized;
  }

  async read(date: string): Promise<Plan | null> {
    if (!isValidDateKey(date)) return null;
    return this.store.read(date);
  }

  async list(from: string, days: number): Promise<Array<{ date: string; plan: Plan | null }>> {
    const start = isValidDateKey(from) ? from : dateKey(new Date());
    const total = Math.min(31, Math.max(1, Math.round(days)));
    const out: Array<{ date: string; plan: Plan | null }> = [];
    for (let index = 0; index < total; index += 1) {
      const date = addDays(start, index);
      out.push({ date, plan: await this.store.read(date) });
    }
    return out;
  }

  /** 今天优先放「今天必须做」和池里的待办；未来日期只放已经钉到那天或已排期的。 */
  private async todoBlocksFor(date: string): Promise<TodoBlock[]> {
    const today = dateKey(new Date());
    const items = await this.store.readTodos();
    const candidates = items
      .filter((item) => item.status !== 'done')
      .filter((item) => (item.status === 'scheduled' ? item.scheduledDate === date : date === today))
      .sort((left, right) => {
        if (left.priority !== right.priority) return left.priority === 'must' ? -1 : 1;
        return left.createdAt.localeCompare(right.createdAt);
      });
    const blocks: TodoBlock[] = [];
    let normal = 0;
    for (const item of candidates) {
      if (item.priority === 'normal' && normal >= 2) continue;
      blocks.push({ id: item.id, title: item.title, minutes: item.minutes });
      if (item.priority === 'normal') normal += 1;
      if (blocks.length >= 6) break;
    }
    return blocks;
  }

  /** 计划落盘后同步待办状态：排进计划的变 scheduled，完成的保持 done。 */
  private async syncTodos(plan: Plan): Promise<void> {
    const assigned = new Set(plan.items.map((item) => item.todoId).filter((id): id is string => Boolean(id)));
    const items = await this.store.readTodos();
    let changed = false;
    for (const item of items) {
      if (!assigned.has(item.id) || item.status === 'done') continue;
      if (item.status !== 'scheduled' || item.scheduledDate !== plan.date) {
        item.status = 'scheduled';
        item.scheduledDate = plan.date;
        changed = true;
      }
    }
    if (changed) await this.store.writeTodos(items);
  }

  /** 读不到就生成；已手动改过且未 force 的计划原样保留。 */
  async ensure(date: string, options: EnsureOptions = {}): Promise<Plan> {
    if (!isValidDateKey(date)) throw Error('日期格式应为 YYYY-MM-DD');
    const running = this.inFlight.get(date);
    if (running) return running;
    const snapshot = this.current;
    const task = (async () => {
      const existing = await this.store.read(date);
      const exception = await this.store.readException(date);
      const effective = exception ? applyException(snapshot, exception) : snapshot;
      const live = this.liveDay(date);
      if (existing && !options.force) {
        if (existing.edited) return existing;
        const stale = isStale(existing, effective);
        const weatherChanged = live ? existing.weatherKey !== weatherKey(live) : false;
        const exceptionChanged = (existing.exceptionKey ?? '') !== exceptionKey(exception);
        if (!stale && !weatherChanged && !exceptionChanged) return existing;
      }
      const day = live ?? await this.fetchDay(date);
      const override = options.allowAi === false ? null : await this.travelOverride(effective, date);
      const todoBlocks = await this.todoBlocksFor(date);
      let plan = generatePlan(effective, date, override, exception, todoBlocks);
      plan = applyWeatherRules(plan, day, effective.routine);
      if (options.allowAi !== false && effective.ai.enabled && effective.ai.model) {
        try {
          plan = await augmentWithModel(this.ctx, effective, plan);
        } catch (error) {
          plan.aiError = errorText(error);
          this.ctx.logger.warn('日程模型润色失败', { date, error: plan.aiError });
        }
      }
      // 模型可能忽略天气提示，最后再兜一次；这段是幂等的。
      plan = applyWeatherRules(plan, day, effective.routine);
      plan = attachItinerary(plan, effective.travel, day);
      plan = applyHourlyRules(plan, day ? this.weather?.peek()?.hours : undefined, day);
      const current = await this.store.read(date);
      if (current?.edited && !options.force) return current;
      await this.store.write(plan);
      await this.syncTodos(plan);
      this.ctx.emit('plugin:schedule:generated', { date, source: plan.source, weather: day?.text ?? '' });
      return plan;
    })().finally(() => this.inFlight.delete(date));
    this.inFlight.set(date, task);
    return task;
  }

  async ensureToday(): Promise<Plan | null> {
    if (!this.current.enabled) return null;
    return this.ensure(dateKey(new Date()));
  }

  /**
   * 每轮对话注入的短日程。只读今天的计划；缺计划时短暂等待生成，
   * 但不会因为天气/AI 润色慢而拖住聊天。
   */
  async ambient(): Promise<string> {
    const today = dateKey(new Date());
    let plan = await this.store.read(today);
    if (!plan && this.current.enabled) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1200);
        timer.unref?.();
      });
      plan = await Promise.race([this.ensure(today, { allowAi: false }), timeout]).catch(() => null);
      if (timer) clearTimeout(timer);
    }
    if (!plan || !plan.items.length) return '';

    const minute = minuteOfDay();
    const items = [...plan.items]
      .filter((item) => item.status !== 'skipped' && item.status !== 'done')
      .sort((a, b) => (parseHHMM(a.start) ?? 0) - (parseHHMM(b.start) ?? 0));
    const startOf = (item: PlanItem) => parseHHMM(item.start) ?? 0;
    const endOf = (item: PlanItem) => parseHHMM(item.end) ?? 0;
    const active = items.find((item) => startOf(item) <= minute && endOf(item) > minute) ?? null;
    const next = items.find((item) => startOf(item) > minute) ?? null;
    const upcoming = items.filter((item) => startOf(item) > minute).slice(0, 3);

    const label = (item: PlanItem) => {
      const title = cleanText(item.title, 24);
      const place = cleanText(item.place, 16);
      return `${item.start}–${item.end} ${title}${place ? `（${place}）` : ''}`;
    };
    const lines = [
      `【今天的日程 · ${today} · 现在 ${formatHHMM(minute)}】`,
      active ? `正在：${label(active)}，到 ${active.end} 结束。` : `现在没有正在进行的安排。`,
      next ? `下一项：${label(next)}。` : '下一项：今天没有后续安排了。',
    ];
    if (upcoming.length > 1) lines.push('后面：' + upcoming.slice(1).map(label).join('；') + '。');
    if (plan.weather?.text) lines.push(`天气：${cleanText(plan.weather.text, 40)}。`);
    if (plan.exception) lines.push(`今天是异常日（${plan.exception.label}）：${cleanText(plan.exception.note, 40)}，安排已按这个状态压缩。`);
    if (plan.weatherAdjusted?.length) lines.push('已按天气调整：' + plan.weatherAdjusted.slice(0, 2).join('；') + '。');
    lines.push('这是你自己的安排。按现在这个时段自然说话和行动；被问到安排时直接用它，不要编，也不用再调 schedule_now。');
    return lines.join('\n');
  }

  /** 每分钟调用；漏过的生成在下一次触发时补上，不集中重放。 */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!this.current.enabled) return;
      const now = new Date();
      const today = dateKey(now);
      const target = parseHHMM(this.current.generateAt) ?? 7 * 60;
      const dates = [today];
      if (minuteOfDay(now) >= target) {
        for (let index = 1; index < this.current.daysAhead; index += 1) dates.push(addDays(today, index));
      }
      for (const date of dates) {
        try {
          await this.ensure(date);
        } catch (error) {
          this.lastError = errorText(error);
          this.ctx.logger.warn('日程自动生成失败', { date, error: this.lastError });
        }
      }
      await this.store.prune(this.current.keepDays, today);
      this.lastTickAt = new Date().toISOString();
    } finally {
      this.ticking = false;
    }
  }

  /** 保存设置后按新作息重排缺的/过期的天；手动改过的不动。 */
  async refreshAfterConfig(): Promise<void> {
    if (!this.current.enabled) return;
    const today = dateKey(new Date());
    const dates = [today];
    for (let index = 1; index < this.current.daysAhead; index += 1) dates.push(addDays(today, index));
    for (const date of dates) {
      try {
        await this.ensure(date);
      } catch (error) {
        this.lastError = errorText(error);
        this.ctx.logger.warn('按新作息重排失败', { date, error: this.lastError });
      }
    }
  }

  async edit(date: string, input: EditInput): Promise<Plan> {
    if (!isValidDateKey(date)) throw Error('日期格式应为 YYYY-MM-DD');
    // 同一天的人工改动排队执行，避免页面和工具同时读改写丢一项。
    return this.serial(date, () => this.applyEdit(date, input));
  }

  private serial<T>(date: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(date) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.chains.set(date, next.then(() => undefined, () => undefined));
    return next;
  }

  private async applyEdit(date: string, input: EditInput): Promise<Plan> {
    const plan = await this.ensure(date);
    const items = plan.items.map((item) => ({ ...item }));
    const action = String(input.action ?? '');
    const index = input.id ? items.findIndex((item) => item.id === input.id) : -1;
    const before = index >= 0 ? { ...items[index] } : null;

    if (action === 'add') {
      const start = parseHHMM(input.start);
      const end = parseHHMM(input.end);
      const title = cleanText(input.title, 24);
      if (start === null || end === null || end <= start) throw Error('开始和结束时间要先填好（HH:MM）');
      if (!title) throw Error('缺少标题');
      assertFree(items, start, end, -1);
      items.push({
        id: '',
        start: formatHHMM(start),
        end: formatHHMM(end),
        title,
        kind: BLOCK_KINDS.includes(input.kind as BlockKind) ? (input.kind as BlockKind) : 'fixed',
        ...(cleanText(input.place, 20) ? { place: cleanText(input.place, 20) } : {}),
        ...(cleanText(input.note, 60) ? { note: cleanText(input.note, 60) } : {}),
        status: 'pending',
      });
    } else {
      if (index < 0) throw Error('没有找到这条安排，刷新页面再试');
      const item = items[index];
      if (action === 'remove') {
        items.splice(index, 1);
      } else if (action === 'status') {
        if (!['pending', 'done', 'skipped'].includes(String(input.status))) throw Error('状态只能是 pending / done / skipped');
        item.status = input.status as ItemStatus;
      } else if (action === 'update') {
        const start = input.start === undefined ? parseHHMM(item.start) : parseHHMM(input.start);
        const end = input.end === undefined ? parseHHMM(item.end) : parseHHMM(input.end);
        if (start === null || end === null || end <= start) throw Error('开始和结束时间要先填好（HH:MM）');
        const title = input.title === undefined ? item.title : cleanText(input.title, 24);
        if (!title) throw Error('标题不能为空');
        assertFree(items, start, end, index);
        item.start = formatHHMM(start);
        item.end = formatHHMM(end);
        item.title = title;
        if (input.note !== undefined) {
          const note = cleanText(input.note, 60);
          if (note) item.note = note;
          else delete item.note;
        }
        if (input.place !== undefined) {
          const place = cleanText(input.place, 20);
          if (place) item.place = place;
          else delete item.place;
        }
        if (input.kind && BLOCK_KINDS.includes(input.kind as BlockKind)) item.kind = input.kind as BlockKind;
        if (input.status && ['pending', 'done', 'skipped'].includes(String(input.status))) item.status = input.status as ItemStatus;
      } else {
        throw Error('编辑动作只能是 add / update / remove / status');
      }
    }

    const next: Plan = {
      ...plan,
      edited: true,
      items: renumber(items),
    };
    await this.store.write(next);
    if (action === 'remove' && before?.todoId) {
      await this.releaseTodo(before.todoId);
    } else if (action === 'status' && before?.todoId) {
      await this.setTodoDone(before.todoId, input.status === 'done');
    }
    this.ctx.emit('plugin:schedule:edited', { date });
    return next;
  }

  async todos(): Promise<TodoItem[]> {
    const items = await this.store.readTodos();
    return items.sort((left, right) => {
      if (left.status !== right.status) {
        const order = { pool: 0, scheduled: 1, done: 2 } as const;
        return order[left.status] - order[right.status];
      }
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  async addTodo(input: { title?: unknown; minutes?: unknown; priority?: unknown; note?: unknown }): Promise<TodoItem> {
    const title = cleanText(input.title, 60);
    if (!title) throw Error('待办要有个标题');
    const minutes = Math.min(480, Math.max(10, Math.round(Number(input.minutes) || 30)));
    const item: TodoItem = {
      id: `t${randomUUID().slice(0, 8)}`,
      title,
      minutes,
      priority: input.priority === 'must' ? 'must' : 'normal',
      status: 'pool',
      createdAt: new Date().toISOString(),
      ...(cleanText(input.note, 120) ? { note: cleanText(input.note, 120) } : {}),
    };
    const items = await this.store.readTodos();
    if (items.filter((entry) => entry.status !== 'done').length >= 100) throw Error('待办最多保留 100 条，先清理一些');
    items.push(item);
    await this.store.writeTodos(items);
    this.ctx.emit('plugin:schedule:todos', { action: 'add', id: item.id });
    return item;
  }

  async removeTodo(id: string): Promise<void> {
    const items = await this.store.readTodos();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) throw Error('没有找到这条待办');
    await this.store.writeTodos(next);
    this.ctx.emit('plugin:schedule:todos', { action: 'remove', id });
  }

  async completeTodo(id: string, done: boolean): Promise<TodoItem> {
    await this.setTodoDone(id, done);
    const item = (await this.store.readTodos()).find((entry) => entry.id === id);
    if (!item) throw Error('没有找到这条待办');
    return item;
  }

  /** 把待办钉到某天：当天有现成计划就找空档插入，没有就重新生成。 */
  async scheduleTodo(date: string, id: string): Promise<Plan> {
    if (!isValidDateKey(date)) throw Error('日期格式应为 YYYY-MM-DD');
    return this.serial(date, async () => {
      const items = await this.store.readTodos();
      const todo = items.find((item) => item.id === id);
      if (!todo) throw Error('没有找到这条待办');
      if (todo.status === 'done') throw Error('这条待办已经完成');
      const plan = await this.ensure(date);
      const gap = findGap(plan, todo.minutes);
      if (!gap) throw Error(`这天没有 ${todo.minutes} 分钟的空档，先挪开别的安排`);
      const next: Plan = {
        ...plan,
        edited: true,
        items: renumber([...plan.items, {
          id: '',
          start: formatHHMM(gap.start),
          end: formatHHMM(gap.end),
          title: todo.title,
          kind: 'todo',
          status: 'pending',
          todoId: todo.id,
        }]),
      };
      await this.store.write(next);
      todo.status = 'scheduled';
      todo.scheduledDate = date;
      await this.store.writeTodos(items);
      this.ctx.emit('plugin:schedule:edited', { date, todo: id });
      return next;
    });
  }

  /** 放回池子并清掉计划里的引用；计划条目保留成普通待办块。 */
  async unscheduleTodo(id: string): Promise<void> {
    const items = await this.store.readTodos();
    const todo = items.find((item) => item.id === id);
    if (!todo) throw Error('没有找到这条待办');
    todo.status = 'pool';
    delete todo.scheduledDate;
    await this.store.writeTodos(items);
  }

  private async setTodoDone(id: string, done: boolean): Promise<void> {
    const items = await this.store.readTodos();
    const todo = items.find((item) => item.id === id);
    if (!todo) return;
    todo.status = done ? 'done' : 'scheduled';
    await this.store.writeTodos(items);
  }

  private async releaseTodo(id: string): Promise<void> {
    const items = await this.store.readTodos();
    const todo = items.find((item) => item.id === id);
    if (!todo || todo.status === 'done') return;
    todo.status = 'pool';
    delete todo.scheduledDate;
    await this.store.writeTodos(items);
  }

  async readException(date: string): Promise<ExceptionDay | null> {
    if (!isValidDateKey(date)) return null;
    return this.store.readException(date);
  }

  /** 设定异常日并立即重排当天；失败时异常记录保留，下次生成会自动套用。 */
  async setException(date: string, kind: string, note = '', options: EnsureOptions = {}): Promise<{ exception: ExceptionDay; plan: Plan }> {
    if (!isValidDateKey(date)) throw Error('日期格式应为 YYYY-MM-DD');
    if (!isExceptionKind(kind)) throw Error('异常类型只能是 sick / leave / overtime / rest');
    return this.serial(date, async () => {
      const exception = makeException(date, kind as ExceptionKind, note);
      await this.store.writeException(exception);
      const plan = await this.ensure(date, { ...options, force: true });
      return { exception, plan };
    });
  }

  /** 撤销异常日并恢复常规排程。 */
  async clearException(date: string): Promise<Plan> {
    if (!isValidDateKey(date)) throw Error('日期格式应为 YYYY-MM-DD');
    return this.serial(date, async () => {
      await this.store.removeException(date);
      return this.ensure(date, { force: true });
    });
  }

  async exceptions(from: string, to: string): Promise<ExceptionDay[]> {
    const start = isValidDateKey(from) ? from : dateKey(new Date());
    const end = isValidDateKey(to) ? to : addDays(start, 6);
    return this.store.exceptions(start, end);
  }

  /** 周复盘：本周 + 上周对比，只看已落盘的计划。 */
  async review(date: string): Promise<WeeklyReview> {
    const anchor = isValidDateKey(date) ? date : dateKey(new Date());
    const start = weekStartOf(anchor, this.current.region.weekStart);
    const from = addDays(start, -7);
    const plans = (await this.list(from, 14)).map((entry) => entry.plan).filter((plan): plan is Plan => Boolean(plan));
    const exceptions = await this.store.exceptions(from, addDays(start, 6));
    return weeklyReview(plans, exceptions, anchor, this.current.region.weekStart);
  }

  status(): { lastError: string; lastTickAt: string; ticking: boolean } {
    return { lastError: this.lastError, lastTickAt: this.lastTickAt, ticking: this.ticking };
  }
}

function assertFree(items: PlanItem[], start: number, end: number, ignoreIndex: number) {
  for (let index = 0; index < items.length; index += 1) {
    if (index === ignoreIndex) continue;
    const item = items[index];
    const left = parseHHMM(item.start);
    const right = parseHHMM(item.end);
    if (left === null || right === null) continue;
    if (start < right && left < end) {
      throw Error(`和 ${item.start}-${item.end}「${item.title}」重叠了`);
    }
  }
}

function findGap(plan: Plan, minutes: number): { start: number; end: number } | null {
  const occupied = plan.items
    .map((item) => ({ start: parseHHMM(item.start), end: parseHHMM(item.end) }))
    .filter((item): item is { start: number; end: number } => item.start !== null && item.end !== null)
    .sort((left, right) => left.start - right.start);
  let cursor = occupied.length ? occupied[0].start : 0;
  for (const block of occupied) {
    if (block.start - cursor >= minutes) return { start: cursor, end: cursor + minutes };
    cursor = Math.max(cursor, block.end);
  }
  if (24 * 60 - cursor >= minutes) return { start: cursor, end: cursor + minutes };
  return null;
}

function renumber(items: PlanItem[]): PlanItem[] {
  const sorted = [...items].sort((left, right) => (parseHHMM(left.start) ?? 0) - (parseHHMM(right.start) ?? 0)
    || (parseHHMM(left.end) ?? 0) - (parseHHMM(right.end) ?? 0));
  return sorted.map((item, index) => ({ ...item, id: `i${index + 1}` }));
}
