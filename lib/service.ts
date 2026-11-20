/*! 日程 plugin · 运行时服务：配置、补生成、编辑、清理。 */

import type { Context } from '../../../core/context.ts';
import { augmentWithModel } from './ai.ts';
import { generatePlan, isStale } from './plan.ts';
import type { BlockKind, Config, ItemStatus, Plan, PlanItem } from './types.ts';
import { BLOCK_KINDS, normalizeConfig } from './types.ts';
import type { WeatherBridge } from './weather-bridge.ts';
import type { WeatherDay } from './weather-types.ts';
import { applyWeatherRules, weatherKey } from './weather-rules.ts';
import { Store } from './store.ts';
import { addDays, dateKey, formatHHMM, isValidDateKey, minuteOfDay, parseHHMM } from './time.ts';

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

  /** 读不到就生成；已手动改过且未 force 的计划原样保留。 */
  async ensure(date: string, options: EnsureOptions = {}): Promise<Plan> {
    if (!isValidDateKey(date)) throw Error('日期格式应为 YYYY-MM-DD');
    const running = this.inFlight.get(date);
    if (running) return running;
    const snapshot = this.current;
    const task = (async () => {
      const existing = await this.store.read(date);
      const live = this.liveDay(date);
      if (existing && !options.force) {
        if (existing.edited) return existing;
        const stale = isStale(existing, snapshot);
        const weatherChanged = live ? existing.weatherKey !== weatherKey(live) : false;
        if (!stale && !weatherChanged) return existing;
      }
      const day = live ?? await this.fetchDay(date);
      let plan = generatePlan(snapshot, date);
      plan = applyWeatherRules(plan, day, snapshot.routine);
      if (options.allowAi !== false && snapshot.ai.enabled && snapshot.ai.model) {
        try {
          plan = await augmentWithModel(this.ctx, snapshot, plan);
        } catch (error) {
          plan.aiError = errorText(error);
          this.ctx.logger.warn('日程模型润色失败', { date, error: plan.aiError });
        }
      }
      // 模型可能忽略天气提示，最后再兜一次；这段是幂等的。
      plan = applyWeatherRules(plan, day, snapshot.routine);
      const current = await this.store.read(date);
      if (current?.edited && !options.force) return current;
      await this.store.write(plan);
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
      `【周小迟的今日日程 · ${today} · 现在 ${formatHHMM(minute)}】`,
      active ? `正在：${label(active)}，到 ${active.end} 结束。` : `现在没有正在进行的安排。`,
      next ? `下一项：${label(next)}。` : '下一项：今天没有后续安排了。',
    ];
    if (upcoming.length > 1) lines.push('后面：' + upcoming.slice(1).map(label).join('；') + '。');
    if (plan.weather?.text) lines.push(`天气：${cleanText(plan.weather.text, 40)}。`);
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
    this.ctx.emit('plugin:schedule:edited', { date });
    return next;
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

function renumber(items: PlanItem[]): PlanItem[] {
  const sorted = [...items].sort((left, right) => (parseHHMM(left.start) ?? 0) - (parseHHMM(right.start) ?? 0)
    || (parseHHMM(left.end) ?? 0) - (parseHHMM(right.end) ?? 0));
  return sorted.map((item, index) => ({ ...item, id: `i${index + 1}` }));
}
