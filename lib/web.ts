/*! 日程 plugin · 页面与接口注册。 */

import type { Context, PluginHandler } from '../../../core/context.ts';
import type { ScheduleService } from './service.ts';
import type { ReminderService } from './reminder.ts';
import type { WeatherBridge } from './weather-bridge.ts';
import { settingsPage, type SettingsData } from '../ui/settings.ts';
import { calendarPage } from '../ui/calendar.ts';
import {
  cloneRoutine,
  formatFixedText,
  formatHolidayText,
  formatTravelText,
  formatWorkdaysText,
  parseFixedText,
  parseHolidayText,
  parseTravelText,
  parseWorkdaysText,
  PRESETS,
} from './types.ts';
import { dateKey, isValidDateKey } from './time.ts';

function sendJson(res: any, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendHtml(res: any, html: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

async function readJson(req: any, signal: AbortSignal): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw Error('请求体过大');
    chunks.push(buffer);
  }
  signal.throwIfAborted();
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseHobbies(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .split(/[\n,，、]/)
    .map((item) => item.trim().slice(0, 12))
    .filter(Boolean)
    .slice(0, 16);
}

export type WebOptions = { version: string };

export function registerWeb(ctx: Context, service: ScheduleService, weather: WeatherBridge, reminder: ReminderService, options: WebOptions) {
  const base = '/plugins/schedule/';

  async function snapshot(): Promise<SettingsData> {
    let models: SettingsData['models'] = [];
    try {
      models = ctx.models.list('chat').map((model) => ({ id: model.id, name: model.name, callable: model.callable }));
    } catch (error) {
      ctx.logger.warn('日程读取模型列表失败', { error: errorText(error) });
    }
    const weatherSummary = await weather.settingsSummary();
    return {
      config: service.config,
      fixedText: formatFixedText(service.config.routine.fixed),
      hobbiesText: service.config.routine.hobbies.join('\n'),
      holidayText: formatHolidayText(service.config.holiday.periods),
      holidayWorkdays: formatWorkdaysText(service.config.holiday.workdays),
      travelText: formatTravelText(service.config.travel.spots),
      models,
      status: {
        lastError: service.status().lastError,
        lastTickAt: service.status().lastTickAt,
        reminderLastError: reminder.lastError,
        reminderLastSentAt: reminder.lastSentAt,
      },
      weather: { available: weather.available, summary: weatherSummary },
      today: dateKey(new Date()),
      version: options.version,
    };
  }

  const page = (render: () => Promise<string>, title: string): PluginHandler => {
    return async (_req: any, res: any) => {
      try {
        sendHtml(res, await render());
      } catch (error) {
        ctx.logger.warn('日程页面渲染失败', { title, error: errorText(error) });
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('日程页面加载失败，请稍后重试');
      }
    };
  };

  ctx.web.page(base + 'settings', page(async () => settingsPage(await snapshot()), '日程设置'), {
    title: '日程设置',
    settings: true,
  });

  ctx.web.page(base + 'calendar', page(async () => calendarPage({ today: dateKey(new Date()), version: options.version }), '日程'), {
    title: '日程',
    navigation: true,
  });

  ctx.web.api(base + 'config', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      const action = String(body?.action ?? 'read');
      if (action === 'read') {
        sendJson(res, 200, { ok: true, ...(await snapshot()) });
        return;
      }
      if (action === 'save') {
        const raw = body?.config && typeof body.config === 'object' ? { ...body.config } : {};
        const { items, errors } = parseFixedText(body?.fixedText);
        const hobbies = parseHobbies(body?.hobbiesText);
        const warnings = [...errors];
        const routine = {
          ...(raw.routine && typeof raw.routine === 'object' ? raw.routine : cloneRoutine(service.config.routine)),
        };
        if (typeof body?.fixedText === 'string') routine.fixed = items;
        if (hobbies !== undefined) routine.hobbies = hobbies;
        const holiday = {
          ...service.config.holiday,
          ...(raw.holiday && typeof raw.holiday === 'object' ? raw.holiday : {}),
        };
        if (typeof body?.holidayText === 'string') {
          const parsed = parseHolidayText(body.holidayText);
          holiday.periods = parsed.periods;
          warnings.push(...parsed.errors);
        }
        if (typeof body?.holidayWorkdays === 'string') {
          const parsed = parseWorkdaysText(body.holidayWorkdays);
          holiday.workdays = parsed.workdays;
          warnings.push(...parsed.errors);
        }
        const travel = {
          ...service.config.travel,
          ...(raw.travel && typeof raw.travel === 'object' ? raw.travel : {}),
        };
        if (typeof body?.travelText === 'string') {
          const parsed = parseTravelText(body.travelText);
          travel.spots = parsed.spots;
          warnings.push(...parsed.errors);
        }
        const config = await service.saveConfig({ ...raw, routine, holiday, travel });
        void service.refreshAfterConfig();
        sendJson(res, 200, {
          ok: true,
          config,
          fixedText: formatFixedText(config.routine.fixed),
          hobbiesText: config.routine.hobbies.join('\n'),
          holidayText: formatHolidayText(config.holiday.periods),
          holidayWorkdays: formatWorkdaysText(config.holiday.workdays),
          travelText: formatTravelText(config.travel.spots),
          warnings,
        });
        return;
      }
      if (action === 'preset') {
        const preset = PRESETS.find((entry) => entry.id === String(body?.preset ?? ''));
        if (!preset) throw Error('没有这个模板');
        const config = await service.saveConfig({ ...service.config, routine: cloneRoutine(preset.routine) });
        void service.refreshAfterConfig();
        sendJson(res, 200, { ok: true, config, fixedText: formatFixedText(config.routine.fixed), hobbiesText: config.routine.hobbies.join('\n') });
        return;
      }
      throw Error('操作无效');
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });

  ctx.web.api(base + 'data', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      const from = isValidDateKey(body?.from) ? body.from : dateKey(new Date());
      const days = Math.min(31, Math.max(1, Math.round(Number(body?.days) || 7)));
      const plans = await service.list(from, days);
      const config = service.config;
      sendJson(res, 200, {
        ok: true,
        today: dateKey(new Date()),
        plans,
        config: {
          enabled: config.enabled,
          generateAt: config.generateAt,
          daysAhead: config.daysAhead,
          aiEnabled: config.ai.enabled,
          aiModel: config.ai.model,
        },
        status: service.status(),
        weather: await weather.quick(),
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });

  ctx.web.api(base + 'generate', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      const dates: string[] = Array.isArray(body?.dates)
        ? body.dates.filter((date: unknown) => isValidDateKey(date)).slice(0, 14)
        : [isValidDateKey(body?.date) ? body.date : dateKey(new Date())];
      if (!dates.length) throw Error('日期格式应为 YYYY-MM-DD');
      const force = body?.force === true;
      const plans = [];
      const errors: string[] = [];
      for (const date of dates) {
        try {
          plans.push(await service.ensure(date, { force }));
        } catch (error) {
          errors.push(`${date}：${errorText(error)}`);
        }
      }
      if (!plans.length) {
        sendJson(res, 400, { ok: false, error: errors.join('；') || '生成失败' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        plan: plans[0],
        plans,
        errors,
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });

  ctx.web.api(base + 'reminder/test', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      const result = await reminder.sendTest(
        typeof body?.text === 'string' ? body.text : '',
        {
          channel: typeof body?.channel === 'string' ? body.channel : undefined,
          account: typeof body?.account === 'string' ? body.account : undefined,
          peer: typeof body?.peer === 'string' ? body.peer : undefined,
        },
      );
      sendJson(res, 200, { ok: result.status === 'sent' || result.status === 'uncertain', ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });

  ctx.web.api(base + 'item', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      if (!isValidDateKey(body?.date)) throw Error('日期格式应为 YYYY-MM-DD');
      const plan = await service.edit(body.date, {
        action: String(body?.action ?? ''),
        id: typeof body?.id === 'string' ? body.id : undefined,
        start: typeof body?.start === 'string' ? body.start : undefined,
        end: typeof body?.end === 'string' ? body.end : undefined,
        title: typeof body?.title === 'string' ? body.title : undefined,
        note: typeof body?.note === 'string' ? body.note : undefined,
        place: typeof body?.place === 'string' ? body.place : undefined,
        kind: typeof body?.kind === 'string' ? body.kind : undefined,
        status: typeof body?.status === 'string' ? body.status : undefined,
      });
      sendJson(res, 200, { ok: true, plan });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });
}
