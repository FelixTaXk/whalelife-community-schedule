/*! 日程 plugin · 人格日记：按当天日程、天气和穿搭生成，按人格隔离保存，可被同一人格读回。 */

import { createHash } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from '../../../core/context.ts';
import type { JournalConfig, JournalEntry, JournalStyleId, Plan, Routine } from './types.ts';
import { JOURNAL_STYLES } from './types.ts';
import type { ScheduleService } from './service.ts';
import type { WeatherBridge } from './weather-bridge.ts';
import { addDays, dateKey, formatHHMM, isValidDateKey, isoWeekday, minuteOfDay, parseDateKey, parseHHMM, weekdayLabel } from './time.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const JOURNAL_DIR = join(HERE, '..', 'data', 'journals');

type PersonaChoice = { id: string; name: string; model?: string };
type ModelChoice = { id: string; name: string; callable: boolean };
type JournalOrigin = 'auto' | 'manual' | 'edited';

export type JournalStatus = {
  enabled: boolean;
  time: string;
  autoTime: boolean;
  personaId: string;
  personaName: string;
  model: string;
  lastError: string;
  lastGeneratedAt: string;
};

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function bodyText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200)
    : '';
}

export function personaDir(personaId: string): string {
  return createHash('sha256').update(personaId).digest('hex').slice(0, 16);
}

function journalFile(personaId: string, date: string): string {
  return `journals/${personaDir(personaId)}/${date}.json`;
}

function journalPath(personaId: string, date: string): string {
  return join(JOURNAL_DIR, personaDir(personaId), `${date}.json`);
}

/** 留空时按「睡前洗漱开始前 5 分钟」推算，最晚 23:55；不写死任何人的作息。 */
export function derivedJournalMinute(routine: Pick<Routine, 'sleep' | 'windDownMinutes'>): number {
  const sleep = parseHHMM(routine.sleep) ?? 23 * 60 + 30;
  // 00:00–02:59 视为次日凌晨入睡；03:00 之后视为当天清晨/上午入睡（夜班也适用）。
  const sleepAbs = sleep < 3 * 60 ? sleep + 24 * 60 : sleep;
  const windDown = Math.max(0, Number(routine.windDownMinutes) || 0);
  return Math.max(0, Math.min(23 * 60 + 55, sleepAbs - windDown - 5));
}

export function journalMinute(config: JournalConfig, routine: Pick<Routine, 'sleep' | 'windDownMinutes'>): number {
  const custom = config.at ? parseHHMM(config.at) : null;
  return custom === null ? derivedJournalMinute(routine) : Math.min(23 * 60 + 55, custom);
}

export function journalTimeLabel(minute: number): string {
  return formatHHMM(minute);
}

export function styleOf(config: JournalConfig): { id: JournalStyleId; name: string; prompt: string } {
  const preset = JOURNAL_STYLES.find((item) => item.id === config.style) ?? JOURNAL_STYLES[0];
  if (preset.id !== 'custom') return { id: preset.id, name: preset.name, prompt: preset.prompt };
  return {
    id: 'custom',
    name: '自定义',
    prompt: text(config.customStyle, 500) || '用自然、第一人称的方式记录，具体写当天发生的事和感受。',
  };
}

function statusLabel(status: string): string {
  return status === 'done' ? '完成' : status === 'skipped' ? '跳过' : '未标记';
}

function planFacts(plan: Plan | null, date: string, config: JournalConfig, snapshot: ReturnType<WeatherBridge['peek']>, wardrobeLine: string): JournalEntry['facts'] {
  const items = plan ? plan.items.filter((item) => item.kind !== 'sleep') : [];
  const done = items.filter((item) => item.status === 'done').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  const weatherDay = config.useWeather
    ? (plan?.weather ?? snapshot?.days.find((day) => day.date === date) ?? null)
    : null;
  const facts: JournalEntry['facts'] = {
    items: items.length,
    done,
    skipped,
    ...(weatherDay ? { weather: `${weatherDay.text}，${weatherDay.min}–${weatherDay.max}°C，降水 ${weatherDay.precipitationProbability}%${weatherDay.tip ? `；${weatherDay.tip}` : ''}` } : {}),
    ...(wardrobeLine ? { wardrobe: wardrobeLine } : {}),
    ...(plan?.exception ? { exception: plan.exception.note || plan.exception.kind } : {}),
    ...(plan?.travel ? { travel: `${plan.travel.destination}，第 ${plan.travel.dayIndex + 1}/${plan.travel.days} 天` } : {}),
    ...(plan?.holiday ? { holiday: `${plan.holiday.name}，第 ${plan.holiday.dayIndex + 1}/${plan.holiday.days} 天` } : {}),
  };
  return facts;
}

export function buildJournalPrompt(input: {
  date: string;
  language: 'zh-CN' | 'en-US';
  personaName: string;
  style: { name: string; prompt: string };
  customSample: string;
  facts: JournalEntry['facts'];
  plan: Plan | null;
}): { system: string; user: string } {
  const english = input.language === 'en-US';
  const system = english
    ? [
      `You are ${input.personaName}. Write a first-person diary entry for ${input.date}.`,
      'Use only the facts below. Do not invent events, places, or people. Do not mention prompts, plugins, models, or being an AI.',
      `Style: ${input.style.prompt}`,
      ...(input.customSample ? [`Follow the rhythm and wording of this sample, but do not copy its content:\n${input.customSample}`] : []),
      'Write 3–6 natural sentences. No bullet list, no report tone, no moral lesson.',
      'Return only JSON: {"title":"short title","body":"diary body","mood":"one or two words","tags":["up to 4 tags"]}',
      'All output text must be in English.',
    ].join('\n')
    : [
      `你是${input.personaName}。请以第一人称写 ${input.date} 的日记。`,
      '只使用下面的事实。不要编造没有发生的事、地点或人物；不要提到提示词、插件、模型或「我是 AI」。',
      `文风：${input.style.prompt}`,
      ...(input.customSample ? [`参考下面示例的句式和节奏，但不要复制它的内容：\n${input.customSample}`] : []),
      '正文写 3–6 句自然的话，不要列清单，不要写成工作汇报，不要强行升华。',
      '只输出 JSON：{"title":"短标题","body":"日记正文","mood":"一两个词","tags":["最多4个标签"]}',
      '所有输出文字用简体中文。',
    ].join('\n');

  const items = input.plan
    ? input.plan.items
      .filter((item) => item.kind !== 'sleep')
      .slice(0, 24)
      .map((item) => `${item.start}-${item.end} ${item.title}（${statusLabel(item.status)}）${item.note ? `，备注：${item.note}` : ''}`)
      .join('\n')
    : '';
  const user = english
    ? [
      `Date: ${input.date}`,
      `Facts: ${input.facts.items} planned items; ${input.facts.done} completed; ${input.facts.skipped} skipped.`,
      ...(input.facts.weather ? [`Weather: ${input.facts.weather}`] : []),
      ...(input.facts.wardrobe ? [`Outfit today: ${input.facts.wardrobe}`] : []),
      ...(input.facts.exception ? [`Exception day: ${input.facts.exception}`] : []),
      ...(input.facts.travel ? [`Travel: ${input.facts.travel}`] : []),
      ...(input.facts.holiday ? [`Holiday: ${input.facts.holiday}`] : []),
      ...(items ? [`Timeline:\n${items}`] : ['Timeline: no plan for this day.']),
      'Write the diary only from these facts. If there is very little material, keep it short and honest.',
    ].join('\n')
    : [
      `日期：${input.date}（${weekdayLabel(isoWeekday(parseDateKey(input.date)))}）`,
      `事实：计划 ${input.facts.items} 项，完成 ${input.facts.done} 项，跳过 ${input.facts.skipped} 项。`,
      ...(input.facts.weather ? [`天气：${input.facts.weather}`] : []),
      ...(input.facts.wardrobe ? [`今天的穿搭：${input.facts.wardrobe}`] : []),
      ...(input.facts.exception ? [`异常日：${input.facts.exception}`] : []),
      ...(input.facts.travel ? [`旅行：${input.facts.travel}`] : []),
      ...(input.facts.holiday ? [`假期：${input.facts.holiday}`] : []),
      ...(items ? [`时间线：\n${items}`] : ['时间线：这天没有日程。']),
      '只根据上面的事实写。如果素材很少，就写短一点、诚实一点。',
    ].join('\n');
  return { system, user };
}

/** 模型可能带围栏或解释；优先取 JSON，失败时接受足够长的纯文本正文。 */
export function parseJournalReply(raw: string, date: string, fallbackTitle: string): { title: string; body: string; mood: string; tags: string[] } | null {
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
      const body = bodyText(value.body);
      if (body.length >= 12) {
        return {
          title: text(value.title, 30) || fallbackTitle,
          body,
          mood: text(value.mood, 12),
          tags: Array.isArray(value.tags) ? value.tags.map((tag) => text(tag, 12)).filter(Boolean).slice(0, 4) : [],
        };
      }
    } catch {
      // 继续尝试纯文本。
    }
  }
  if (stripped.length < 12 || stripped.startsWith('{')) return null;
  return { title: fallbackTitle, body: bodyText(stripped), mood: '', tags: [] };
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, any>;
  return entry.version === 1
    && isValidDateKey(entry.date)
    && typeof entry.personaId === 'string'
    && typeof entry.body === 'string'
    && typeof entry.title === 'string';
}

export class JournalService {
  private ctx: Context;
  private schedule: ScheduleService;
  private weather: WeatherBridge;
  private running = false;
  private failedDate = '';

  lastError = '';
  lastGeneratedAt = '';

  constructor(ctx: Context, schedule: ScheduleService, weather: WeatherBridge) {
    this.ctx = ctx;
    this.schedule = schedule;
    this.weather = weather;
  }

  get config(): JournalConfig {
    return this.schedule.config.journal;
  }

  private personas(): PersonaChoice[] {
    return this.ctx.personas.list() as PersonaChoice[];
  }

  private resolvePersona(requested?: string): PersonaChoice {
    const list = this.personas();
    const id = text(requested, 80) || text(this.config.persona, 80);
    if (id) {
      const found = list.find((item) => item.id === id);
      if (!found) throw Error('找不到所选日记人格，请在设置里重新选择');
      return found;
    }
    if (list.length === 1) return list[0];
    if (!list.length) throw Error('宿主还没有可用人格，先创建一个人格再写日记');
    throw Error(`有 ${list.length} 个角色，请先在设置里选择写日记的人格`);
  }

  private resolveModel(persona: PersonaChoice): string {
    const models = this.ctx.models.list('chat') as ModelChoice[];
    const configured = text(this.config.model, 80);
    if (configured) {
      const found = models.find((item) => item.id === configured && item.callable);
      if (!found) throw Error('所选日记模型当前不可用，请在设置页重新选择');
      return found.id;
    }
    const personaModel = text(persona.model, 80);
    if (personaModel) {
      const found = models.find((item) => item.id === personaModel && item.callable);
      if (found) return found.id;
      throw Error('这个人格绑定的模型当前不可用，请给日记单独选一个模型');
    }
    const callable = models.filter((item) => item.callable);
    if (callable.length === 1) return callable[0].id;
    throw Error(callable.length ? '有多个可用模型，请给日记选一个' : '当前没有可用的对话模型');
  }

  private async wardrobeLine(date: string, personaId: string): Promise<string> {
    if (!this.config.useWardrobe) return '';
    const wardrobe = this.ctx.get<any>('wardrobe', false);
    if (!wardrobe || typeof wardrobe.current !== 'function') return '';
    try {
      const snapshot = await wardrobe.current({ date, personaId });
      const baseId = snapshot?.day?.base;
      const outfit = (snapshot?.catalog?.items ?? []).find((item: any) => item.id === baseId) ?? snapshot?.outfit;
      return text(outfit?.name, 40);
    } catch (error) {
      this.ctx.logger.warn('读取穿搭给日记失败', { error: errorText(error) });
      return '';
    }
  }

  async read(date: string, personaId?: string): Promise<JournalEntry | null> {
    const persona = this.resolvePersona(personaId);
    const raw = await this.ctx.config.read<unknown>(journalFile(persona.id, date)).catch(() => null);
    return isJournalEntry(raw) && raw.date === date && raw.personaId === persona.id ? raw : null;
  }

  async listRange(from: string, days: number, personaId?: string): Promise<JournalEntry[]> {
    const start = isValidDateKey(from) ? from : dateKey(new Date());
    const total = Math.min(31, Math.max(1, Math.round(days)));
    const wanted = new Set(Array.from({ length: total }, (_, index) => addDays(start, index)));
    const entries = await this.allEntries(personaId);
    return entries.filter((entry) => wanted.has(entry.date));
  }

  private async allEntries(personaId?: string): Promise<JournalEntry[]> {
    let persona: PersonaChoice | null = null;
    if (personaId || this.config.persona) {
      try {
        persona = this.resolvePersona(personaId);
      } catch {
        persona = null;
      }
    }
    let folders: string[] = [];
    try {
      folders = (await readdir(JOURNAL_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
    const out: JournalEntry[] = [];
    for (const folder of folders) {
      if (persona && folder !== personaDir(persona.id)) continue;
      let names: string[] = [];
      try {
        names = await readdir(join(JOURNAL_DIR, folder));
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const raw = await this.ctx.config.read<unknown>(`journals/${folder}/${name}`).catch(() => null);
        if (isJournalEntry(raw)) out.push(raw);
      }
    }
    return out.sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
  }

  async latest(personaId?: string): Promise<JournalEntry | null> {
    const cutoff = addDays(dateKey(new Date()), -14);
    const entries = (await this.allEntries(personaId)).filter((entry) => entry.date >= cutoff);
    return entries.length ? entries[entries.length - 1] : null;
  }

  async search(query: string, personaId?: string, limit = 8): Promise<JournalEntry[]> {
    const needle = text(query, 40).toLowerCase();
    if (!needle) return [];
    const entries = await this.allEntries(personaId);
    return entries
      .filter((entry) => `${entry.title}\n${entry.body}\n${entry.tags.join(' ')}`.toLowerCase().includes(needle))
      .slice(-Math.min(20, Math.max(1, limit)))
      .reverse();
  }

  private async save(entry: JournalEntry): Promise<void> {
    await this.ctx.config.save(journalFile(entry.personaId, entry.date), entry);
  }

  async generate(date: string, options: { force?: boolean; personaId?: string; origin?: JournalOrigin } = {}): Promise<JournalEntry> {
    if (!isValidDateKey(date)) throw Error('日期格式要是 YYYY-MM-DD');
    if (date > dateKey(new Date())) throw Error('未来日期不能写日记');
    const persona = this.resolvePersona(options.personaId);
    const existing = await this.read(date, persona.id);
    if (existing && options.force !== true) return existing;

    const model = this.resolveModel(persona);
    const style = styleOf(this.config);
    if (style.id === 'custom' && !text(this.config.customStyle, 500)) throw Error('自定义文风还没填，先在设置里写清楚想要什么语气');
    const today = dateKey(new Date());
    const plan = await this.schedule.read(date)
      ?? (date === today && this.schedule.config.enabled ? await this.schedule.ensure(date, { allowAi: false }) : null);
    const wardrobe = await this.wardrobeLine(date, persona.id);
    const facts = planFacts(plan, date, this.config, this.weather.peek(), wardrobe);
    const prompt = buildJournalPrompt({
      date,
      language: this.schedule.config.region.language === 'en-US' ? 'en-US' : 'zh-CN',
      personaName: persona.name,
      style,
      customSample: this.config.styleSample,
      facts,
      plan,
    });
    const signal = AbortSignal.any([this.ctx.signal, AbortSignal.timeout(60_000)]);
    const reply = await this.ctx.llm.chat({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: 800,
      signal,
    });
    const parsed = parseJournalReply(reply.text ?? '', date, `${date} 日记`);
    if (!parsed) throw Error('模型没有写出有效的日记，请重试');
    const entry: JournalEntry = {
      version: 1,
      date,
      personaId: persona.id,
      personaName: persona.name,
      title: parsed.title,
      body: parsed.body,
      mood: parsed.mood,
      tags: parsed.tags,
      style: style.id,
      styleName: style.name,
      model,
      source: options.origin ?? 'manual',
      createdAt: new Date().toISOString(),
      facts,
    };
    await this.save(entry);
    this.lastError = '';
    this.lastGeneratedAt = entry.createdAt;
    this.failedDate = '';
    this.ctx.emit('plugin:schedule:journal', { date, personaId: persona.id });
    this.ctx.logger.info('人格日记已生成', { date, personaId: persona.id, style: style.id, model });
    return entry;
  }

  async edit(date: string, input: { body: string; title?: string; mood?: string; tags?: string[]; personaId?: string }): Promise<JournalEntry> {
    const persona = this.resolvePersona(input.personaId);
    const existing = await this.read(date, persona.id);
    const body = bodyText(input.body);
    if (body.length < 10) throw Error('日记正文太短，至少写 10 个字');
    const entry: JournalEntry = {
      version: 1,
      date,
      personaId: persona.id,
      personaName: persona.name,
      title: text(input.title, 30) || existing?.title || `${date} 日记`,
      body,
      mood: text(input.mood, 12) || existing?.mood || '',
      tags: Array.isArray(input.tags) ? input.tags.map((tag) => text(tag, 12)).filter(Boolean).slice(0, 4) : (existing?.tags ?? []),
      style: existing?.style ?? this.config.style,
      styleName: existing?.styleName ?? styleOf(this.config).name,
      model: existing?.model ?? '',
      source: 'edited',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      facts: existing?.facts ?? { items: 0, done: 0, skipped: 0 },
    };
    await this.save(entry);
    return entry;
  }

  async remove(date: string, personaId?: string): Promise<boolean> {
    const persona = this.resolvePersona(personaId);
    try {
      await unlink(journalPath(persona.id, date));
      this.ctx.emit('plugin:schedule:journal', { date, personaId: persona.id, deleted: true });
      return true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  status(): JournalStatus {
    const config = this.config;
    const persona = (() => {
      try {
        return this.resolvePersona();
      } catch {
        return null;
      }
    })();
    const model = (() => {
      try {
        return persona ? this.resolveModel(persona) : '';
      } catch {
        return '';
      }
    })();
    return {
      enabled: config.enabled,
      time: journalTimeLabel(journalMinute(config, this.schedule.config.routine)),
      autoTime: !config.at,
      personaId: persona?.id ?? '',
      personaName: persona?.name ?? '',
      model,
      lastError: this.lastError,
      lastGeneratedAt: this.lastGeneratedAt,
    };
  }

  /** 每轮只注入一行索引，不把整篇日记塞进上下文；人格需要时自己调用 schedule_diary。 */
  async ambient(personaId?: string): Promise<string> {
    if (!personaId) return '';
    try {
      const today = dateKey(new Date());
      const entry = await this.read(today, personaId);
      if (!entry) return '';
      return `【日记】今天你已经写过一篇《${entry.title}》。需要回顾或引用时调用 schedule_diary 读取，不要假装记得没读过的内容。`;
    } catch {
      return '';
    }
  }

  resetFailure(): void {
    this.failedDate = '';
    this.lastError = '';
  }

  async tick(): Promise<void> {
    if (this.running || !this.config.enabled) return;
    const now = new Date();
    const date = dateKey(now);
    if (minuteOfDay(now) < journalMinute(this.config, this.schedule.config.routine)) return;
    let existing: JournalEntry | null = null;
    try {
      existing = await this.read(date);
    } catch (error) {
      this.failedDate = date;
      this.lastError = errorText(error);
      return;
    }
    if (existing || this.failedDate === date) return;
    this.running = true;
    try {
      await this.generate(date, { origin: 'auto' });
    } catch (error) {
      this.failedDate = date;
      this.lastError = errorText(error);
      this.ctx.logger.warn('人格日记自动生成失败', { date, error: this.lastError });
    } finally {
      this.running = false;
    }
  }
}

export function journalSummary(entry: JournalEntry): string {
  const meta = [entry.mood, ...entry.tags].filter(Boolean).join(' · ');
  return `${entry.date} · ${entry.personaName}《${entry.title}》${meta ? `\n${meta}` : ''}\n${entry.body}`;
}
