/*! 日程：按作息自动生成每天的安排，缺了就补，改过就不覆盖；天气由 sub/weather 提供，可选并参与排程。
 * 第一层：通过宿主 context 服务，每轮把当前/下一项注入当前人格的对话上下文。
 * 第二层：关键节点通过已注册渠道主动发一条提醒，QQ 等渠道可用。
 * 公开契约：plugins/<id>/plugin.yaml + index.ts 导出 apply(ctx)。
 */

import { readFileSync } from 'node:fs';
import type { Context } from '../../core/context.ts';
import { ScheduleService } from './lib/service.ts';
import { ReminderService } from './lib/reminder.ts';
import { WeatherBridge } from './lib/weather-bridge.ts';
import { registerTools } from './lib/tools.ts';
import { registerWeb } from './lib/web.ts';

function manifestVersion(): string {
  try {
    const yaml = readFileSync(new URL('./plugin.yaml', import.meta.url), 'utf8');
    return /^version:\s*(\S+)/m.exec(yaml)?.[1] ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = manifestVersion();

export async function apply(ctx: Context) {
  const service = await ScheduleService.create(ctx);
  const weather = WeatherBridge.create(ctx);
  const reminder = new ReminderService(ctx, service);
  service.setWeather(weather);
  registerTools(ctx, service, weather);
  registerWeb(ctx, service, weather, reminder, { version: VERSION });

  // 第一层：每轮把“现在/下一项”注入当前人格的上下文。宿主没有 context 服务时静默跳过。
  const ambient = (ctx as any).context;
  if (ambient && typeof ambient.register === 'function') {
    ctx.effect(() => ambient.register(async () => service.ambient()));
  }

  // 每分钟检查一次：跨天、过生成时间、配置改动后都能补上；不做集中补发。
  const ticker = setInterval(() => {
    void service.tick().catch(() => undefined);
    void reminder.tick().catch(() => undefined);
  }, 60_000);
  ticker.unref?.();
  ctx.effect(() => () => clearInterval(ticker));

  const kick = () => {
    void service.tick().catch(() => undefined);
    void reminder.tick().catch(() => undefined);
  };
  kick();
  ctx.on('whalelife/ready', () => { kick(); });

  // 有真人消息进来时顺手补今天的计划：只是读文件，缺失才生成。
  ctx.on('channel/message', async () => {
    try {
      await service.ensureToday();
      void reminder.tick().catch(() => undefined);
    } catch (error) {
      ctx.logger.warn('日程补生成失败', { error: error instanceof Error ? error.message : String(error) });
    }
  });

  ctx.logger.info('日程已启用', {
    enabled: service.config.enabled,
    generateAt: service.config.generateAt,
    ai: service.config.ai.enabled,
    weather: weather.available,
    reminder: service.config.reminder.enabled,
  });
}
