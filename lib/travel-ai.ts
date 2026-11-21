/*! 日程 plugin · 让模型从旅行地点池里选一个目的地；失败由调用方回退规则。 */

import type { Context } from '../../../core/context.ts';
import type { Config, TravelSpot } from './types.ts';
import type { DayInfo } from './holidays.ts';
import { travelKey, type TravelChoice } from './travel.ts';

type AiTravel = { spot: string; days: number; reason: string };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function parseTravelChoice(raw: string, spots: TravelSpot[]): AiTravel | null {
  const body = raw.replace(/```(?:json)?/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = text(record.spot ?? record.destination, 24);
  const spot = spots.find((entry) => entry.name === name);
  if (!spot) return null;
  const requested = Math.round(Number(record.days));
  const days = Number.isFinite(requested) ? Math.max(spot.minDays, Math.min(spot.maxDays, requested)) : spot.minDays;
  return { spot: spot.name, days, reason: text(record.reason, 60) };
}

export async function chooseTravelWithModel(
  ctx: Context,
  config: Config,
  info: DayInfo,
  spots: TravelSpot[],
  limit: number,
): Promise<TravelChoice | null> {
  if (!config.travel.aiChoose || !spots.length) return null;
  if (!config.ai.model) throw Error('旅行 AI 选择已开启，但没有选择模型');
  const model = ctx.models.list('chat').find((entry) => entry.id === config.ai.model && entry.callable);
  if (!model) throw Error('所选模型当前不可用，请在设置页重新选择');
  const candidates = spots.map((spot) => `${spot.name}｜${spot.distance === 'far' ? '远途' : '近处'}｜${spot.minDays}-${spot.maxDays} 天${spot.note ? `｜${spot.note}` : ''}`).join('\n');
  const system = [
    '你是旅行安排助手，只能从用户给出的候选地点里选一个，不要编造候选以外的地点。',
    '只输出一个 JSON 对象，不要解释，不要代码块。',
    '按假期长短选择：周末/短假选近处、1–2 天；长假选远途、3–6 天。',
    '返回格式：{"spot":"候选地点名","days":整数,"reason":"不超过30字"}',
  ].join('\n');
  const user = [
    `日期：${info.date}`,
    `假期：${info.holiday?.name ?? '周末'}（${info.holiday?.days ?? 1} 天，${info.holiday?.scale === 'long' ? '长假' : '短假'}）`,
    `本次最多安排 ${limit} 天。`,
    `候选地点：\n${candidates}`,
    config.travel.style ? `偏好：${config.travel.style}` : '',
  ].filter(Boolean).join('\n\n');
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]);
  const reply = await ctx.llm.chat({
    model: config.ai.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 200,
    signal,
  });
  const picked = parseTravelChoice(reply.text ?? '', spots);
  if (!picked) throw Error('模型的旅行选择不是候选地点，已回退规则');
  const key = travelKey(info, info.date);
  ctx.logger.info('日程旅行地点由模型选择', { date: info.date, spot: picked.spot, days: picked.days });
  return {
    key,
    destination: picked.spot,
    days: Math.min(picked.days, limit),
    source: 'ai',
    reason: picked.reason,
  };
}
