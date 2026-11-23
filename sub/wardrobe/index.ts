/*! 日程 · 衣柜子插件：用插件内置或用户配置的服装库，按日程和天气给当前人格配穿搭。 */

import type { Context } from '../../../../core/context.ts';
import { loadCatalog } from './lib/catalog.ts';
import { registerTools } from './lib/tools.ts';
import { registerWeb } from './lib/web.ts';
import { ensureToday, currentOutfit } from './lib/service.ts';
import { readConfig } from './lib/config.ts';

const VERSION = '0.5.1';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function apply(ctx: Context) {
  // 服装库是只读导入，加载时就把统计带出来，页面不用每次重扫。
  const catalog = loadCatalog();

  registerTools(ctx, catalog);
  registerWeb(ctx, catalog, { version: VERSION });

  // 给其它插件（提示词小抄等）提供只读的当前穿搭接口；没有提供方时调用方自动降级。
  ctx.provide('wardrobe', {
    current: async (opts: { date?: string; personaId?: string } = {}) =>
      currentOutfit(ctx, opts.date, opts.personaId),
    stats: async () => ({ outfits: catalog.items.length, tiers: catalog.report?.tiers ?? {} }),
  });

  // 每轮把“现在穿什么”补进当前人格的上下文；人格由宿主传入，开关只看配置。
  const ambient = (ctx as any).context;
  if (ambient && typeof ambient.register === 'function') {
    ctx.effect(() =>
      ambient.register(async (input: { personaId?: string; personaName?: string }) => {
        try {
          const config = await readConfig(ctx);
          if (!config.inject) return '';
          const snap = await currentOutfit(ctx, undefined, input?.personaId);
          if (!snap || !snap.outfit) return '';
          const where = snap.block ? `${snap.block.start}–${snap.block.end} ${snap.block.title}` : '现在';
          const when = snap.block && snap.moment !== 'now' ? '下一段 ' : '';
          const genderNote = snap.audience.gender === 'male'
            ? '注意：当前服装库没有男装/中性款，这套是从现有库回落选的，生图可能出现服装和角色不匹配。'
            : '';
          return `【穿搭】${when}${where}，穿的是 ${snap.outfit.name}。这是按日程和天气选好的，不用再查衣柜。${genderNote ? ` ${genderNote}` : ''}`;
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

  // 日程/天气在后台变化时，定时做一次轻量重算；锁定和手动换装不会被覆盖。
  ctx.effect(() => {
    const timer = setInterval(() => {
      void ensureToday(ctx).catch((error) => {
        ctx.logger.warn('衣柜自动重配失败', { error: errorText(error) });
      });
    }, 10 * 60 * 1000);
    return () => clearInterval(timer);
  });

  ctx.logger.info('衣柜子插件已启用', {
    version: VERSION,
    outfits: catalog.items.length,
    tiers: catalog.report?.tiers ?? {},
    library: catalog.report?.library ?? '',
  });
}


