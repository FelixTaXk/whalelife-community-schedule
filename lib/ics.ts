/*! 日程 plugin · 只读 ICS 导出与本地订阅服务（随机令牌，不依赖宿主登录态）。 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Context } from '../../../core/context.ts';
import type { Plan, PlanItem } from './types.ts';
import { KIND_LABEL } from './types.ts';
import { addDays, dateKey, parseHHMM } from './time.ts';
import type { ScheduleService } from './service.ts';

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function stamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** 本地墙上时间，不带 Z，让日历按设备时区解释；跨零点结束自动加一天。 */
function localTime(planDate: string, hhmm: string, plusDay = false): string {
  const [y, m, d] = planDate.split('-').map(Number);
  const minute = parseHHMM(hhmm) ?? 0;
  const day = new Date(y, m - 1, d + (plusDay || minute >= 24 * 60 ? 1 : 0));
  return `${day.getFullYear()}${pad(day.getMonth() + 1)}${pad(day.getDate())}T${pad(Math.floor(minute / 60) % 24)}${pad(minute % 60)}00`;
}

function escapeText(value: string): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 折行：每行最多 75 个 UTF-8 字节，续行以空格开头。 */
function fold(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out: string[] = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 75) {
      out.push(current);
      current = ' ' + char;
    } else {
      current += char;
    }
  }
  if (current) out.push(current);
  return out.join('\r\n');
}

function itemFingerprint(plan: Plan, item: PlanItem): string {
  const raw = `${plan.date}|${item.start}|${item.end}|${item.title}|${item.kind}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 10);
}

const KIND_EN: Record<string, string> = {
  routine: 'Routine', meal: 'Meal', commute: 'Commute', work: 'Work', study: 'Study',
  exercise: 'Exercise', free: 'Free', chore: 'Chores', rest: 'Rest', social: 'Social',
  fixed: 'Fixed', travel: 'Travel', sleep: 'Sleep', todo: 'To-do',
};

function event(plan: Plan, item: PlanItem, lead: number, host: string, language = 'zh-CN'): string[] {
  const kind = language === 'en-US' ? (KIND_EN[item.kind] ?? item.kind) : (KIND_LABEL[item.kind] ?? item.kind);
  const desc = [kind, item.note, item.place].filter(Boolean).join(' · ');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${itemFingerprint(plan, item)}-${item.id}@${host}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${localTime(plan.date, item.start)}`,
    `DTEND:${localTime(plan.date, item.end, parseHHMM(item.end) !== null && (parseHHMM(item.end) as number) <= (parseHHMM(item.start) as number))}`,
    `SUMMARY:${escapeText(item.title)}`,
    desc ? `DESCRIPTION:${escapeText(desc)}` : '',
    item.place ? `LOCATION:${escapeText(item.place)}` : '',
    item.status === 'done' ? 'STATUS:COMPLETED' : 'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:-PT${Math.max(0, lead)}M`,
    `DESCRIPTION:${escapeText(item.title)}`,
    'END:VALARM',
    'END:VEVENT',
  ];
  return lines.filter(Boolean).map(fold);
}

export function buildIcs(plans: Plan[], options: { leadMinutes?: number; host?: string; name?: string; language?: string; timezone?: string } = {}): string {
  const host = options.host ?? 'schedule.whalelife';
  const name = options.name ?? (options.language === 'en-US' ? 'Schedule' : '日程');
  const timezone = options.timezone?.trim() || 'local';
  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WhaleLife//Schedule//ZH-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${escapeText(timezone)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const plan of plans) {
    if (!plan?.items?.length) continue;
    for (const item of plan.items) {
      if (item.kind === 'sleep') continue;
      lines.push(...event(plan, item, options.leadMinutes ?? 10, host, options.language));
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

type TokenFile = { version: 1; token: string };

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);
}

export class IcsServer {
  private ctx: Context;
  private service: ScheduleService;
  private server: Server | null = null;
  private token = '';
  private port = 0;
  private starting: Promise<void> | null = null;

  constructor(ctx: Context, service: ScheduleService) {
    this.ctx = ctx;
    this.service = service;
  }

  private async readToken(): Promise<string> {
    const raw = await this.ctx.config.read<unknown>('ics.json').catch(() => null);
    if (raw && typeof raw === 'object' && isToken((raw as TokenFile).token)) return (raw as TokenFile).token;
    const token = randomBytes(24).toString('hex');
    await this.ctx.config.save('ics.json', { version: 1, token });
    return token;
  }

  private async plans(): Promise<Plan[]> {
    const today = dateKey(new Date());
    const list = await this.service.list(addDays(today, -14), 35);
    return list.map((entry) => entry.plan).filter((plan): plan is Plan => Boolean(plan));
  }

  async start(): Promise<void> {
    if (!this.service.config.ics.enabled) {
      await this.stop();
      return;
    }
    if (this.server) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      this.token = await this.readToken();
      const basePort = this.service.config.ics.port;
      for (let offset = 0; offset < 12; offset += 1) {
        const port = basePort + offset;
        const server = createServer((req, res) => { void this.handle(req, res); });
        const ok = await new Promise<boolean>((resolve) => {
          const fail = () => resolve(false);
          server.once('error', fail);
          server.listen(port, '0.0.0.0', () => {
            server.off('error', fail);
            resolve(true);
          });
        });
        if (!ok) continue;
        this.server = server;
        this.port = port;
        this.ctx.logger.info('日程 ICS 订阅服务已启动', { port });
        return;
      }
      throw Error('订阅端口被占用，换一个端口再试');
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async reload(): Promise<void> {
    await this.stop();
    if (this.service.config.ics.enabled) await this.start();
  }

  private async handle(req: any, res: any): Promise<void> {
    const path = String(req.url ?? '').split('?')[0];
    if (!path || path === '/') {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }
    const match = /^\/schedule\/([a-f0-9]{48})\.ics$/.exec(path);
    if (!match || match[1] !== this.token) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    try {
      const body = buildIcs(await this.plans(), {
        leadMinutes: this.service.config.reminder.leadMinutes,
        host: `schedule-${this.token.slice(0, 8)}`,
        name: 'WhaleLife 日程',
        language: this.service.config.region.language,
        timezone: this.service.config.region.timezone,
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', 'inline; filename="schedule.ics"');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      this.ctx.logger.warn('ICS 订阅生成失败', { error: error instanceof Error ? error.message : String(error) });
      res.statusCode = 500;
      res.end('calendar unavailable');
    }
  }

  urls(): string[] {
    if (!this.port || !this.token) return [];
    const hosts = new Set<string>(['127.0.0.1']);
    try {
      for (const list of Object.values(networkInterfaces())) {
        for (const item of list ?? []) {
          if (item.internal) continue;
          if (item.family !== 'IPv4') continue;
          hosts.add(item.address);
        }
      }
    } catch {
      // 取不到网卡时至少给本机地址。
    }
    return [...hosts].map((host) => `http://${host}:${this.port}/schedule/${this.token}.ics`);
  }

  status(): { running: boolean; port: number; urls: string[] } {
    return { running: Boolean(this.server), port: this.port, urls: this.urls() };
  }
}
