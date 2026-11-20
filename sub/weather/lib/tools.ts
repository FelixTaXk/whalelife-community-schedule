/*! 日程 · 天气子插件 · 模型工具。 */

import type { Context } from '../../../../../core/context.ts';
import type { WeatherCore } from './core.ts';
import { forecastText, summaryText } from '../../../lib/weather-format.ts';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerTools(ctx: Context, core: WeatherCore) {
  ctx.tools.register({
    name: 'weather_now',
    description: '查当前城市的实时天气和今天的温度、降水、出门建议。用户问「今天天气怎么样」「要不要带伞」「现在冷不冷」时调用，不要凭感觉编。',
    schema: { type: 'object', properties: {}, required: [] },
    danger: 'safe',
    origin: { platform: '天气', action: '查实时天气' },
    run: async () => {
      try {
        const snapshot = await core.refresh();
        if (!snapshot.now && !snapshot.days.length) {
          return `天气暂时取不到：${snapshot.error ?? '接口没有返回数据'}`;
        }
        const today = snapshot.days[0];
        const lines = [summaryText(snapshot, today?.date)];
        if (today?.tip) lines.push(`出门建议：${today.tip}`);
        return lines.join('\n');
      } catch (error) {
        return `天气暂时取不到：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'weather_forecast',
    description: '查未来几天的天气预报（最多 7 天）。用户问「明天天气」「周末会下雨吗」「接下来几天冷不冷」时调用。',
    schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '看几天，1–7，默认 3' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '天气', action: '查天气预报' },
    run: async (args: any) => {
      try {
        const snapshot = await core.refresh();
        const days = Math.min(7, Math.max(1, Math.round(Number(args?.days) || 3)));
        return forecastText(snapshot, days);
      } catch (error) {
        return `天气暂时取不到：${errorText(error)}`;
      }
    },
  });
}
