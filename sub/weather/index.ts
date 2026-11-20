/*! 日程 · 天气子插件：给父插件和模型提供天气，独立配置、独立启停。 */

import type { Context } from '../../../../core/context.ts';
import { WeatherCore } from './lib/core.ts';
import { registerTools } from './lib/tools.ts';
import { registerWeb } from './lib/web.ts';
import { WEATHER_REQUEST_EVENT, WEATHER_SNAPSHOT_EVENT } from '../../lib/weather-types.ts';

const VERSION = '0.1.0';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function apply(ctx: Context) {
  const core = await WeatherCore.create(ctx);

  // 父插件读不到子插件的本地服务，所以通过宿主事件总线应答快照请求。
  ctx.on(WEATHER_REQUEST_EVENT, async (payload: any) => {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id) return;
    try {
      const snapshot = await core.refresh(payload?.force === true);
      ctx.emit(WEATHER_SNAPSHOT_EVENT, { id, snapshot });
    } catch (error) {
      ctx.emit(WEATHER_SNAPSHOT_EVENT, { id, error: errorText(error) });
    }
  });

  registerTools(ctx, core);
  registerWeb(ctx, core, { version: VERSION });

  // 插件加载时预热一次；失败也只是把错误放进快照，不影响宿主。
  void core.refresh().catch((error) => {
    ctx.logger.warn('天气预热失败', { error: errorText(error) });
  });

  ctx.logger.info('天气子插件已启用', { place: core.place, version: VERSION });
}
