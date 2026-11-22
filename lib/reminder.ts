/*! 日程 plugin · 第二层：关键节点主动提醒。 */

import type { Context } from '../../../core/context.ts';
import type { ReminderConfig, Plan, PlanItem } from './types.ts';
import type { ScheduleService } from './service.ts';
import { dateKey, minuteOfDay, parseHHMM } from './time.ts';

export const REMINDER_KINDS = ['routine', 'work', 'study', 'commute', 'meal', 'exercise', 'fixed', 'travel', 'sleep', 'todo'] as const;
const REMINDER_KINDS_SET = new Set<string>(REMINDER_KINDS);
const LATE_GRACE_MINUTES = 5;

export type ReminderDue = {
  key: string;
  item: PlanItem;
  remindAt: number;
  minutesUntil: number;
  phase: 'before' | 'now';
};

type ReminderRecord = {
  status: 'sent' | 'failed';
  at: string;
  attempts: number;
  text?: string;
  error?: string;
  uncertain?: boolean;
};

type ReminderState = {
  version: 1;
  date: string;
  sent: Record<string, ReminderRecord>;
  count: number;
  /** 用户点过“稍后提醒”的一次性提醒；到点后由 tick 发送。 */
  snoozed?: Record<string, SnoozeRecord>;
};

type SnoozeRecord = {
  key: string;
  itemId: string;
  text: string;
  dueAt: string;
};

function emptyState(date: string): ReminderState {
  return { version: 1, date, sent: {}, count: 0 };
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

function inQuietHours(now: Date, start: string, end: string): boolean {
  const current = minuteOfDay(now);
  const from = parseHHMM(start) ?? 0;
  const to = parseHHMM(end) ?? 0;
  if (from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/** 到点前 lead 分钟进入窗口；迟到超过 5 分钟就不补发，避免打开软件后收到一串旧提醒。 */
export function dueReminders(plan: Plan, now: Date, config: ReminderConfig): ReminderDue[] {
  if (!config.enabled) return [];
  if (isRestDay(plan) && config.restDaySilent) return [];
  if (inQuietHours(now, config.quietStart, config.quietEnd)) return [];
  const current = minuteOfDay(now);
  const out: ReminderDue[] = [];
  for (const item of plan.items) {
    if (item.status !== 'pending' || !REMINDER_KINDS_SET.has(item.kind)) continue;
    const start = parseHHMM(item.start);
    if (start === null) continue;
    const configLead = config.leads?.[item.kind] ?? config.leadMinutes;
    const lead = item.kind === 'routine' ? Math.min(5, configLead) : configLead;
    const remindAt = Math.max(0, start - lead);
    if (current < remindAt || current > start + LATE_GRACE_MINUTES) continue;
    out.push({
      key: `${plan.date}:${item.id}`,
      item,
      remindAt,
      minutesUntil: Math.max(0, start - current),
      phase: current < start ? 'before' : 'now',
    });
  }
  return out;
}

/** 节假日、异常日，或周末但完全没有正事/学习安排，视为休息日。 */
export function isRestDay(plan: Plan): boolean {
  if (plan.exception) return true;
  if (plan.holiday) return true;
  if (plan.weekday < 6) return false;
  return !plan.items.some((item) => item.kind === 'work' || item.kind === 'study');
}

export function reminderText(reminder: ReminderDue): string {
    const title = clean(reminder.item.title, 24);
    const place = clean(reminder.item.place, 16);
    const when = reminder.phase === 'before' ? `还有 ${reminder.minutesUntil} 分钟` : '到点了';
    return `提醒：${when} ${reminder.item.start}–${reminder.item.end} ${title}${place ? `（${place}）` : ''}`;
}

function normalizeSnoozed(value: unknown): Record<string, SnoozeRecord> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, SnoozeRecord> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.key !== 'string' || typeof record.text !== 'string' || typeof record.dueAt !== 'string') continue;
    if (!record.dueAt) continue;
    out[key] = { key: record.key, itemId: String(record.itemId ?? ''), text: record.text.slice(0, 240), dueAt: record.dueAt };
  }
  return Object.keys(out).length ? out : undefined;
}

class ReminderStore {  private ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  async read(date: string): Promise<ReminderState> {
    const raw = await this.ctx.config.read<ReminderState>(`reminders/${date}.json`).catch(() => null);
    if (!raw || raw.version !== 1 || raw.date !== date || !raw.sent || typeof raw.sent !== 'object') return emptyState(date);
    const sent: Record<string, ReminderRecord> = {};
    for (const [key, value] of Object.entries(raw.sent)) {
      if (!value || !['sent', 'failed'].includes(String(value.status))) continue;
      sent[key] = {
        status: value.status,
        at: typeof value.at === 'string' ? value.at : '',
        attempts: Number.isSafeInteger(value.attempts) ? value.attempts : 0,
        ...(typeof value.text === 'string' ? { text: value.text.slice(0, 300) } : {}),
        ...(typeof value.error === 'string' ? { error: value.error.slice(0, 200) } : {}),
        ...(value.uncertain ? { uncertain: true } : {}),
      };
    }
    return { version: 1, date, sent, count: Number.isSafeInteger(raw.count) && raw.count >= 0 ? raw.count : 0, snoozed: normalizeSnoozed(raw.snoozed) };
  }

  async write(date: string, state: ReminderState): Promise<void> {
    await this.ctx.config.save(`reminders/${date}.json`, state);
  }
}

export class ReminderService {
  private ctx: Context;
  private schedule: ScheduleService;
  private store: ReminderStore;
  private now: () => Date;
  private sending = false;

  lastError = '';
  lastSentAt = '';

  constructor(ctx: Context, schedule: ScheduleService, now: () => Date = () => new Date()) {
    this.ctx = ctx;
    this.schedule = schedule;
    this.store = new ReminderStore(ctx);
    this.now = now;
  }

  get config(): ReminderConfig {
    return this.schedule.config.reminder;
  }

  async sendTest(text = '', target?: { channel?: string; account?: string; peer?: string }): Promise<{ status: string; text: string }> {
    const config = this.config;
    const channel = clean(target?.channel, 40) || config.channel;
    const account = clean(target?.account, 40) || config.account;
    const peer = clean(target?.peer, 80) || config.peer;
    if (!channel || !peer) throw Error('先填好渠道 ID 和联系人 peer');
    if (channel !== 'qq' && !account) throw Error('非 QQ 渠道需要填账号');
    const body = clean(text, 240) || '测试提醒：日程主动提醒已接通。';
    const status = await this.deliver({
      channel,
      account,
      peer,
      messageId: `schedule-reminder-test:${Date.now()}`,
      text: body,
    });
    return { status, text: body };
  }

  /** 主动提醒目前走 QQ 插件的公开工具。 */
  private async deliver(target: { channel: string; account: string; peer: string; messageId: string; text: string }): Promise<string> {
    if (target.channel !== 'qq') throw Error('主动提醒目前只支持 QQ 渠道，渠道 ID 请填 qq');
    const userId = target.peer.replace(/^direct:/, '').trim();
    if (!/^\d{5,15}$/.test(userId)) throw Error('QQ 联系人应为 direct:QQ号');
    const session = await this.ctx.sessions.current().catch(() => '');
    if (!session) throw Error('当前没有会话，无法用 QQ 发送');
    const result = await this.ctx.tools.call('qq_send_message', {
      userId,
      messageId: target.messageId,
      text: target.text,
    }, {
      id: session,
      permission: 'full',
      signal: this.ctx.signal,
      channel: 'qq',
      account: target.account,
      peer: target.peer,
      origin: { plugin: 'schedule', channel: 'qq', platform: '日程提醒' },
    });
    if (!result.ok) throw Error(`QQ 发送失败：${String(result.result).slice(0, 180)}`);
    const value = result.result as any;
    const status = String(value?.status ?? '');
    if (status !== 'sent' && status !== 'uncertain') throw Error(`QQ 发送状态：${status || '未知'}`);
    return status;
  }

  async tick(): Promise<void> {
    if (!this.config.enabled || this.sending) return;
    if (!this.config.channel || !this.config.peer) {
      this.lastError = '主动提醒已开启，但还没有填渠道 ID 和联系人 peer';
      return;
    }
    const now = this.now();
    const date = dateKey(now);
    const plan = await this.schedule.read(date);
    if (!plan) return;
    this.sending = true;
    try {
      const state = await this.store.read(date);
      await this.flushSnoozed(plan, state, now, date);
      const due = dueReminders(plan, now, this.config);
      if (!due.length) {
        await this.store.write(date, state);
        return;
      }
      for (const reminder of due) {
        const previous = state.sent[reminder.key];
        if (previous?.status === 'sent') continue;
        if (previous?.status === 'failed' && previous.attempts >= 2) continue;
        if (state.count >= this.config.maxPerDay) {
          this.lastError = `今天主动提醒已达到上限 ${this.config.maxPerDay} 条`;
          break;
        }
        const attempts = (previous?.attempts ?? 0) + 1;
        let text = '';
        try {
          text = await this.compose(plan, reminder);
          const status = await this.deliver({
            channel: this.config.channel,
            account: this.config.account,
            peer: this.config.peer,
            messageId: `schedule-reminder:${date}:${reminder.item.id}:${attempts}`,
            text,
          });
          if (status !== 'sent' && status !== 'uncertain') throw Error(`发送状态：${status || '未知'}`);
          state.sent[reminder.key] = {
            status: 'sent',
            at: new Date().toISOString(),
            attempts,
            text,
            ...(status === 'uncertain' ? { uncertain: true } : {}),
          };
          state.count += 1;
          this.lastSentAt = new Date().toISOString();
          this.lastError = '';
        } catch (error) {
          state.sent[reminder.key] = {
            status: 'failed',
            at: new Date().toISOString(),
            attempts,
            ...(text ? { text } : {}),
            error: errorText(error),
          };
          this.lastError = errorText(error);
          this.ctx.logger.warn('日程主动提醒发送失败', { key: reminder.key, attempts, error: this.lastError });
        }
        await this.store.write(date, state);
      }
      await this.store.write(date, state);
    } catch (error) {
      this.lastError = errorText(error);
      this.ctx.logger.warn('日程主动提醒失败', { error: this.lastError });
    } finally {
      this.sending = false;
    }
  }

  /** 从日程条目点“稍后提醒”：持久化一条延后提醒，完成/删除条目后自动作废。 */
  async snooze(date: string, itemId: string, minutes = this.config.snoozeMinutes): Promise<{ dueAt: string }> {
    const plan = await this.schedule.read(date);
    if (!plan) throw Error('这天还没有日程');
    const item = plan.items.find((entry) => entry.id === itemId);
    if (!item) throw Error('没有找到这条安排');
    if (item.status === 'done' || item.status === 'skipped') throw Error('这条已经结束，不用再提醒');
    const delay = Math.min(120, Math.max(1, Math.round(Number(minutes) || this.config.snoozeMinutes)));
    const now = this.now();
    const due = new Date(now.getTime() + delay * 60_000);
    const dueAt = due.toISOString();
    const title = clean(item.title, 24);
    const place = clean(item.place, 16);
    const text = `稍后提醒：${item.start}–${item.end} ${title}${place ? `（${place}）` : ''}（原定 ${item.start}）`;
    const state = await this.store.read(date);
    const key = `snooze:${date}:${itemId}:${dueAt}`;
    state.snoozed = { ...(state.snoozed ?? {}), [key]: { key, itemId, text, dueAt } };
    await this.store.write(date, state);
    return { dueAt };
  }

  private async flushSnoozed(plan: Plan, state: ReminderState, now: Date, date: string): Promise<void> {
    const entries = Object.values(state.snoozed ?? {}).sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    if (!entries.length) return;
    let changed = false;
    for (const entry of entries) {
      const item = plan.items.find((value) => value.id === entry.itemId);
      if (!item || item.status === 'done' || item.status === 'skipped') {
        delete state.snoozed![entry.key];
        changed = true;
        continue;
      }
      if (new Date(entry.dueAt).getTime() > now.getTime()) continue;
      if (state.sent[entry.key]) {
        delete state.snoozed![entry.key];
        changed = true;
        continue;
      }
      if (state.count >= this.config.maxPerDay) {
        this.lastError = `今天主动提醒已达到上限 ${this.config.maxPerDay} 条`;
        break;
      }
      try {
        const status = await this.deliver({
          channel: this.config.channel,
          account: this.config.account,
          peer: this.config.peer,
          messageId: `schedule-snooze:${date}:${entry.itemId}:${entry.dueAt}`,
          text: entry.text,
        });
        state.sent[entry.key] = {
          status: 'sent',
          at: new Date().toISOString(),
          attempts: 1,
          text: entry.text,
          ...(status === 'uncertain' ? { uncertain: true } : {}),
        };
        state.count += 1;
        this.lastSentAt = new Date().toISOString();
        this.lastError = '';
      } catch (error) {
        state.sent[entry.key] = { status: 'failed', at: new Date().toISOString(), attempts: 1, text: entry.text, error: errorText(error) };
        this.lastError = errorText(error);
      }
      delete state.snoozed![entry.key];
      changed = true;
      await this.store.write(date, state);
    }
    if (changed) await this.store.write(date, state);
  }

  private async compose(plan: Plan, reminder: ReminderDue): Promise<string> {
    if (this.config.usePersona) {
      const generated = await this.generate(plan, reminder).catch((error) => {
        this.ctx.logger.warn('日程提醒生成失败，使用模板', { key: reminder.key, error: errorText(error) });
        return '';
      });
      if (generated) return generated;
    }
    return reminderText(reminder);
  }

  private async generate(plan: Plan, reminder: ReminderDue): Promise<string> {
    const sessions = await this.ctx.sessions.list().catch(() => []);
    if (!sessions.length) return '';
    const session = await this.ctx.sessions.current().catch(() => '');
    if (!session) return '';
    const item = reminder.item;
    const when = reminder.phase === 'before'
      ? `还有 ${reminder.minutesUntil} 分钟开始`
      : `刚到开始时间`;
    const place = clean(item.place, 16);
    const weather = clean(plan.weather?.text, 40);
    const now = this.now();
    const clock = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const prompt = [
      '【日程提醒触发；这是系统触发的提醒，不是用户发来的消息，也不要把这段当成用户在说话】',
      `现在是 ${clock}。`,
      `日程里「${item.start}–${item.end} ${clean(item.title, 24)}${place ? `（${place}）` : ''}」${when}。`,
      weather ? `天气：${weather}。` : '',
      '请用你自己平时说话的方式，给对方发一条 1–2 句的提醒。',
      '只输出要发出去的话，不要解释、不要括号动作、不要清单、不要写“好的”。',
      '不要调用工具，不要编造日程里没有的事。',
    ].filter(Boolean).join('\n');
    const signal = AbortSignal.any([this.ctx.signal, AbortSignal.timeout(45000)]);
    const result = typeof this.ctx.sessions.enqueueTransient === 'function'
      ? await this.ctx.sessions.enqueueTransient({
          sessionId: session,
          persona: this.config.persona || undefined,
          permission: 'off',
          text: prompt,
          signal,
        })
      : await this.ctx.sessions.runTransient({
          sessionId: session,
          persona: this.config.persona || undefined,
          permission: 'off',
          text: prompt,
          signal,
        });
    const text = String(result ?? '').trim();
    if (!text) return '';
    return text.replace(/\r\n/g, '\n').split('\n').filter(Boolean).slice(0, 2).join('\n').slice(0, 240);
  }
}
