/*! 日程 · 衣柜子插件：只用 ComfyUI 服装库，按日程和天气给迟宝配穿搭。 */

import type { Context } from '../../../../core/context.ts';
import { loadCatalog } from './lib/catalog.ts';
import { registerTools } from './lib/tools.ts';
import { registerWeb } from './lib/web.ts';
import { ensureToday, currentOutfit } from './lib/service.ts';
import { readConfig } from './lib/config.ts';

const VERSION = '0.2.1';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function apply(ctx: Context) {
  // 服装库是只读导入，加载时就把统计带出来，页面不用每次重扫。
  const catalog = loadCatalog();

  registerTools(ctx, catalog);
  registerWeb(ctx, catalog, { version: VERSION });

  // 每轮把“现在穿什么”补进迟宝的上下文；只对 whale / 周小迟生效，失败静默。
  const ambient = (ctx as any).context;
  if (ambient && typeof ambient.register === 'function') {
    ctx.effect(() =>
      ambient.register(async (input: { personaId?: string; personaName?: string }) => {
        if (input?.personaId !== 'whale' && input?.personaName !== '周小迟') return '';
        try {
          const config = await readConfig(ctx);
          if (!config.inject) return '';
          const snap = await currentOutfit(ctx, undefined, input?.personaId);
          if (!snap || !snap.outfit) return '';
          const where = snap.block ? `${snap.block.start}–${snap.block.end} ${snap.block.title}` : '现在';
          return `【穿搭】${where}穿的是 ${snap.outfit.name}。这是按日程和天气选好的，不用再查衣柜。`;
        } catch {
          return '';
        }
      }),
    );
  }

  // 加载时把今天的穿搭固定下来，后面聊天、页面看到的都是同一套。
  void ensureToday(ctx).catch((error) => {
    ctx.logger.warn('衣柜初始化失败', { error: errorText(error) });
  });

  ctx.logger.info('衣柜子插件已启用', {
    version: VERSION,
    outfits: catalog.items.length,
    tiers: catalog.report?.tiers ?? {},
    library: catalog.report?.library ?? '',
  });
}


