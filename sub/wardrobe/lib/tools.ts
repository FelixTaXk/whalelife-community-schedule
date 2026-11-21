/*! 衣柜 · 模型工具。 */

import type { Context } from '../../../../../core/context.ts';
import type { Catalog } from './catalog.ts';
import { outfitLine, snapshot, todayView, wardrobeFor, wardrobePick, wear } from './service.ts';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function weatherLine(weather: any) {
  if (!weather) return '天气还没排进来';
  const range = Number.isFinite(Number(weather.min)) && Number.isFinite(Number(weather.max)) ? `${weather.min}–${weather.max}℃` : '';
  return `${weather.text ?? ''}${range ? ` ${range}` : ''}${weather.tip ? `，${weather.tip}` : ''}`.trim();
}

export function registerTools(ctx: Context, _catalog: Catalog) {
  ctx.tools.register({
    name: 'wardrobe_today',
    description: '看今天按日程配好的整套穿搭（每段时间穿什么）。未成年人格只会配日常款；成年人格在泳池/晚宴/居家会匹配泳装、礼服、私密款。用户问「今天穿什么」「今天几套衣服」时调用。',
    schema: {
      type: 'object',
      properties: { date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' } },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '衣柜', action: '看今天穿搭' },
    run: async (args: any, session: any) => {
      try {
        const view = await todayView(ctx, args?.date, session?.personaId);
        if (view.missing) return `${view.date} 还没有日程，衣柜暂时没东西可配。`;
        const lines = [`${view.date} ${weatherLine(view.weather)}`];
        if (view.now) {
          lines.push(`现在 ${view.now.time} ${view.now.title}：${outfitLine0(view.now.outfit)}（${view.now.outfit?.id ?? ''}）`);
        }
        for (const item of view.items) {
          lines.push(`${item.time} ${item.title}${item.place ? ` @${item.place}` : ''} · ${item.scene} · ${outfitLine0(item.outfit)}`);
        }
        return lines.join('\n');
      } catch (error) {
        return `衣柜查不到：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_now',
    description: '只看现在这段时间穿什么，包括下一段要换的。用户问「我现在穿的什么」「待会儿出门穿哪套」时调用。',
    schema: { type: 'object', properties: {}, required: [] },
    danger: 'safe',
    origin: { platform: '衣柜', action: '看当前穿搭' },
    run: async (_args: any, session: any) => {
      try {
        const snap = await snapshot(ctx, undefined, undefined, session?.personaId);
        if (!snap.plan) return `${snap.date} 还没有日程，先让日程排一排。`;
        if (!snap.block) return '现在没有对应的日程段，暂时按居家穿着。';
        const lines = [`现在 ${snap.block.start}–${snap.block.end} ${snap.block.title}：${outfitLine(snap.outfit)}（${snap.outfit?.id ?? ''}）`];
        if (snap.next) lines.push(`下一段 ${snap.next.block.start}–${snap.next.block.end} ${snap.next.block.title}：${outfitLine(snap.next.outfit)}`);
        return lines.join('\n');
      } catch (error) {
        return `衣柜查不到：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_for',
    description: '看指定的某段日程或某个时间点穿什么。用户说「下午上课穿什么」「18:30 那会儿穿哪套」时调用。',
    schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
        blockId: { type: 'string', description: '日程段 id，优先用这个' },
        time: { type: 'string', description: '时间点 HH:MM，没给 blockId 时用' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '衣柜', action: '查指定时段穿搭' },
    run: async (args: any, session: any) => {
      try {
        const result = await wardrobeFor(ctx, { date: args?.date, blockId: args?.blockId, time: args?.time, personaId: session?.personaId });
        if (!result.found) return result.reason ?? '没找到对应的日程段。';
        return `${result.block!.time} ${result.block!.title}${result.block!.place ? ` @${result.block!.place}` : ''} · ${result.scene}：${result.line}（${result.outfit?.id ?? ''}）`;
      } catch (error) {
        return `衣柜查不到：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_pick',
    description: '在服装库里按场景/季节/关键词挑几套候选。用户说「找几套适合上课的」「有没有外套」时调用。',
    schema: {
      type: 'object',
      properties: {
        scene: { type: 'string', description: 'daily / cozy / school / outer / active / dress / skirt / pants / home / swim / party；home 给私密居家，swim 给泳池海边，party 给晚宴派对（后三类只有成年人格能匹配）' },
        season: { type: 'string', description: 'spring / summer / autumn / winter，默认按当天天气' },
        keyword: { type: 'string', description: '关键词，比如 毛衣、外套、百褶' },
        count: { type: 'integer', description: '要几套，1–12，默认 5' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '衣柜', action: '翻服装库' },
    run: async (args: any, session: any) => {
      try {
        const result = await wardrobePick(ctx, { scene: args?.scene, season: args?.season, keyword: args?.keyword, count: args?.count, personaId: session?.personaId });
        if (!result.items.length) return '服装库里没挑到，可能还没导入。';
        const head = result.note ? `${result.note}\n` : '';
        return head + result.items.map((item) => `${item.id} · ${item.name} · ${item.season} · ${item.tier} · ${item.scenes.join('/')}`).join('\n');
      } catch (error) {
        return `衣柜查不到：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_wear',
    description: '给某段日程换一套衣服：不给 id 就重新挑一套，给 id 就穿指定那套。用户说「换一套」「就穿刚才那件」时调用。',
    schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
        blockId: { type: 'string', description: '日程段 id，默认当前这段' },
        id: { type: 'string', description: '指定服装 id；不填就重新挑' },
        scene: { type: 'string', description: '重新挑时限定场景，比如 outer' },
      },
      required: [],
    },
    danger: 'ask',
    origin: { platform: '衣柜', action: '换一套穿搭' },
    run: async (args: any, session: any) => {
      try {
        const result = await wear(ctx, { date: args?.date, blockId: args?.blockId, id: args?.id, scene: args?.scene, personaId: session?.personaId });
        if (!result.ok) return result.reason ?? '没换成。';
        return `${result.block!.time} ${result.block!.title}：${result.line}（${result.outfit?.id ?? ''}）`;
      } catch (error) {
        return `换装失败：${errorText(error)}`;
      }
    },
  });
}

function outfitLine0(outfit: any) {
  return outfit?.name ?? '还没配';
}
