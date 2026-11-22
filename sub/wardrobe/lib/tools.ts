/*! 衣柜 · 模型工具。 */

import type { Context } from '../../../../../core/context.ts';
import type { Catalog } from './catalog.ts';
import { outfitLine, snapshot, todayView, wardrobeFor, wardrobePick, wear, alternatives, setLocked, setFeedback, pack, outfitReference, combine } from './service.ts';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function weatherLine(weather: any) {
  if (!weather) return '天气还没排进来';
  const range = Number.isFinite(Number(weather.min)) && Number.isFinite(Number(weather.max)) ? `${weather.min}–${weather.max}℃` : '';
  return `${weather.text ?? ''}${range ? ` ${range}` : ''}${weather.tip ? `，${weather.tip}` : ''}`.trim();
}

function maleNote(gender: unknown) {
  return gender === 'male'
    ? '\n注意：当前服装库没有男装/中性款，当前人格是男性；这套是从现有库回落的，进入生图可能出现服装和角色不匹配。'
    : '';
}

export function registerTools(ctx: Context, _catalog: Catalog) {
  ctx.tools.register({
    name: 'wardrobe_today',
    description: '看今天按日程配好的整套穿搭（每段时间穿什么）。未成年人格只会配日常款；成年人格在泳池/晚宴/居家会匹配泳装、礼服、私密款。注意：当前服装库可能没有男装/中性款；男性人格会按库内筛选，没有对应款时回落并提示生图不匹配。用户问「今天穿什么」「今天几套衣服」时调用。',
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
          const label = view.now.state === 'now' ? '现在' : '下一段';
          lines.push(`${label} ${view.now.time} ${view.now.title}：${outfitLine0(view.now.outfit)}（${view.now.outfit?.id ?? ''}）`);
        }
        for (const item of view.items) {
          lines.push(`${item.time} ${item.title}${item.place ? ` @${item.place}` : ''} · ${item.scene} · ${outfitLine0(item.outfit)}`);
        }
        return lines.join('\n') + maleNote(view.persona?.gender);
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
        const head = snap.moment === 'now'
          ? `现在 ${snap.block.start}–${snap.block.end} ${snap.block.title}：${outfitLine(snap.outfit)}（${snap.outfit?.id ?? ''}）`
          : `现在没有正在进行的日程段，下一段 ${snap.block.start}–${snap.block.end} ${snap.block.title}：${outfitLine(snap.outfit)}（${snap.outfit?.id ?? ''}）`;
        const lines = [head];
        if (snap.next) lines.push(`${snap.moment === 'now' ? '下一段' : '再下一段'} ${snap.next.block.start}–${snap.next.block.end} ${snap.next.block.title}：${outfitLine(snap.next.outfit)}`);
        return lines.join('\n') + maleNote(snap.audience.gender);
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
        return `${result.block!.time} ${result.block!.title}${result.block!.place ? ` @${result.block!.place}` : ''} · ${result.scene}：${result.line}（${result.outfit?.id ?? ''}）` + maleNote(result.persona?.gender);
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
        return head + result.items.map((item) => `${item.id} · ${item.name} · ${item.season} · ${item.tier} · ${(item.scenes ?? []).join('/')}`).join('\n') + maleNote(result.persona?.gender);
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
        return `${result.block!.time} ${result.block!.title}：${result.line}（${result.outfit?.id ?? ''}）` + maleNote(result.persona?.gender);
      } catch (error) {
        return `换装失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_alternatives',
    description: '给某段日程看 3–5 套备选，带匹配理由；用户说「还有别的吗」「给我几个选择」时调用。选定后用 wardrobe_wear 的 id 参数穿上。',
    schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
        blockId: { type: 'string', description: '日程段 id，默认当前这段' },
        count: { type: 'integer', description: '要几套，1–8，默认 3' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '衣柜', action: '看备选穿搭' },
    run: async (args: any, session: any) => {
      try {
        const result = await alternatives(ctx, { date: args?.date, blockId: args?.blockId, count: args?.count, personaId: session?.personaId });
        if (!result.found) return result.reason ?? '没有可用的日程段。';
        const head = [`${result.date} ${result.block!.time} ${result.block!.title} · ${result.scene}`, `当前：${result.current?.name ?? '还没配'}`];
        if (!result.items.length) return head.concat('没有更多备选，可能是服装库太小或都被排除了。').join('\n');
        return head.concat(result.items.map((item: any) => `${item.id} · ${item.name} · ${item.score} 分 · ${item.reason}`)).join('\n');
      } catch (error) {
        return `衣柜查不到：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_lock',
    description: '锁定或解锁某天的穿搭。锁定后日程/天气变化不会自动改衣，手动换装仍然有效。用户说「今天就穿这套，别再变」「解锁衣柜」时调用。',
    schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
        locked: { type: 'boolean', description: 'true 锁定，false 解锁，默认 true' },
      },
      required: [],
    },
    danger: 'ask',
    origin: { platform: '衣柜', action: '锁定或解锁穿搭' },
    run: async (args: any, session: any) => {
      try {
        const result = await setLocked(ctx, { date: args?.date, locked: args?.locked === false ? false : true, personaId: session?.personaId });
        if (!result.ok) return result.reason ?? '没锁成。';
        return `${result.date} 已${result.locked ? '锁定' : '解锁'}，${result.locked ? '之后不再自动改衣' : '恢复自动重配'}。`;
      } catch (error) {
        return `锁定失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_feedback',
    description: '给当前人格记录穿搭反馈：喜欢、不喜欢、以后别再出现，或重置。用户说「这件好看」「别再给我这件」「恢复默认」时调用。只影响当前人格的打分，不改服装库。',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '服装 id，比如 AUT-0136' },
        action: { type: 'string', description: 'like / dislike / never / reset' },
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
      },
      required: ['id', 'action'],
    },
    danger: 'ask',
    origin: { platform: '衣柜', action: '记录穿搭反馈' },
    run: async (args: any, session: any) => {
      try {
        const result = await setFeedback(ctx, { id: args?.id, action: args?.action, date: args?.date, personaId: session?.personaId });
        if (!result.ok) return result.reason ?? '没记下。';
        const label = args.action === 'like' ? '喜欢' : args.action === 'dislike' ? '不喜欢' : args.action === 'never' ? '不再出现' : '已重置';
        return `${result.id} 已记为「${label}」。当前：喜欢 ${result.feedback!.likes}、不喜欢 ${result.feedback!.dislikes}、不再出现 ${result.feedback!.never}。`;
      } catch (error) {
        return `记录失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_pack',
    description: '按多天日程生成旅行/出差打包清单：每天主穿搭、特殊场景和可复用套数。用户说「出差三天穿什么」「帮我打包」时调用。',
    schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: '开始日期 YYYY-MM-DD，默认今天' },
        end: { type: 'string', description: '结束日期 YYYY-MM-DD，默认同 start；最多 31 天' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '衣柜', action: '多日打包' },
    run: async (args: any, session: any) => {
      try {
        const result = await pack(ctx, { start: args?.start, end: args?.end, personaId: session?.personaId });
        if (!result.ok) return result.reason ?? '打包失败。';
        const days = result.days ?? [];
        const lines = [`${result.start} → ${result.end} · 共 ${days.length} 天 · ${result.uniqueOutfits ?? 0} 套`];
        for (const day of days) {
          const specials = Object.entries(day.specials).map(([scene, outfit]: [string, any]) => `${scene}:${outfit?.name ?? '—'}`);
          lines.push(`${day.date} ${day.base?.name ?? '—'}${specials.length ? `；${specials.join('，')}` : ''}`);
        }
        return lines.join('\n') + `\n${result.note}`;
      } catch (error) {
        return `打包失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_ref',
    description: '把当前/指定日程的穿搭变成画室可用的参考图与提示词。用户说「穿这套画一张」「把衣服给画室」时调用；返回 imageUrl 或 referencePath，交给画室生图。',
    schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
        blockId: { type: 'string', description: '日程段 id，默认当前这段' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '衣柜', action: '生成画室参考' },
    run: async (args: any, session: any) => {
      try {
        const result = await outfitReference(ctx, { date: args?.date, blockId: args?.blockId, personaId: session?.personaId });
        if (!result.ok) return result.reason ?? '没找到参考图。';
        const lines = [
          `${result.date} ${result.block!.time} ${result.block!.title} · ${result.outfit!.name}`,
          `参考图：${result.referencePath || result.imageUrl}`,
          `提示词：${result.prompt}`,
        ];
        return lines.join('\n');
      } catch (error) {
        return `取参考图失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'wardrobe_combine',
    description: '把两到四套服装的关键词拆成上衣/下装/外套/鞋/配饰并生成混搭提示词和参考图。用户说「把这两套搭一下」时调用。服装库是整套图，不会合成新图。',
    schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: '2–4 个服装 id' },
      },
      required: ['ids'],
    },
    danger: 'safe',
    origin: { platform: '衣柜', action: '混搭提示词' },
    run: async (args: any) => {
      try {
        const result = await combine(ctx, { ids: args?.ids });
        if (!result.ok) return result.reason ?? '没搭成。';
        const refs = result.references!.map((ref: any) => `${ref.id}：${ref.referencePath || ref.imageUrl}`).join('\n');
        return `提示词：${result.prompt}\n参考图：\n${refs}\n${result.note}`;
      } catch (error) {
        return `混搭失败：${errorText(error)}`;
      }
    },
  });
}

function outfitLine0(outfit: any) {
  return outfit?.name ?? '还没配';
}
