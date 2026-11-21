/*! 日程 plugin · 可选的模型润色：只填空档，失败一律回退骨架。 */

import type { Context } from '../../../core/context.ts';
import type { BlockKind, Config, Plan, PlanItem } from './types.ts';
import { autoGaps, type Gap } from './plan.ts';
import { aiWeatherHint, weatherPromptLine } from './weather-rules.ts';
import { formatHHMM, isTime, parseHHMM } from './time.ts';

const AI_KINDS: readonly BlockKind[] = ['free', 'rest', 'chore', 'social', 'study', 'exercise'];

type AiFill = { start: string; end: string; title: string; kind: BlockKind; note: string };
type AiPayload = { tone: string; note: string; fills: AiFill[] };

export type AiOutcome = { plan: Plan; used: boolean };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** 只认出 JSON 主体；模型多写解释或围栏都不影响解析。 */
export function parseAiPayload(raw: string, gaps: Gap[]): AiPayload | null {
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
  const rawFills = Array.isArray(record.fills) ? record.fills.slice(0, 8) : [];
  const fills: AiFill[] = [];
  for (const entry of rawFills) {
    if (!entry || typeof entry !== 'object') continue;
    const fill = entry as Record<string, unknown>;
    if (!isTime(fill.start) || !isTime(fill.end)) continue;
    const startMinute = parseHHMM(fill.start) as number;
    const endMinute = parseHHMM(fill.end) as number;
    if (endMinute - startMinute < 20 || endMinute - startMinute > 180) continue;
    if (!gaps.some((gap) => startMinute >= gap.start && endMinute <= gap.end)) continue;
    const title = text(fill.title, 24);
    if (!title) continue;
    const kind = AI_KINDS.includes(fill.kind as BlockKind) ? (fill.kind as BlockKind) : 'free';
    if (fills.some((item) => {
      const left = parseHHMM(item.start) as number;
      const right = parseHHMM(item.end) as number;
      return startMinute < right && left < endMinute;
    })) continue;
    fills.push({
      start: formatHHMM(startMinute),
      end: formatHHMM(endMinute),
      title,
      kind,
      note: text(fill.note, 40),
    });
  }
  if (!fills.length) return null;
  return { tone: text(record.tone, 8), note: text(record.note, 30), fills };
}

function mergeFills(plan: Plan, payload: AiPayload): Plan {
  let items: PlanItem[] = plan.items.map((item) => ({ ...item }));
  for (const fill of payload.fills) {
    const start = parseHHMM(fill.start) as number;
    const end = parseHHMM(fill.end) as number;
    const next: PlanItem[] = [];
    for (const item of items) {
      const left = parseHHMM(item.start);
      const right = parseHHMM(item.end);
      if (!item.auto || left === null || right === null || right <= start || left >= end) {
        next.push(item);
        continue;
      }
      if (left < start) next.push({ ...item, end: formatHHMM(Math.min(right, start)) });
      if (right > end) next.push({ ...item, start: formatHHMM(Math.max(left, end)) });
    }
    next.push({
      id: '',
      start: fill.start,
      end: fill.end,
      title: fill.title,
      kind: fill.kind,
      ...(fill.note ? { note: fill.note } : {}),
      status: 'pending',
    });
    items = next;
  }
  items.sort((left, right) => (parseHHMM(left.start) ?? 0) - (parseHHMM(right.start) ?? 0)
    || (parseHHMM(left.end) ?? 0) - (parseHHMM(right.end) ?? 0));
  items = items
    .filter((item) => (parseHHMM(item.end) ?? 0) > (parseHHMM(item.start) ?? 0))
    .map((item, index) => ({ ...item, id: `i${index + 1}` }));
  return {
    ...plan,
    tone: payload.tone || plan.tone,
    note: payload.note || plan.note,
    source: 'ai',
    items,
    aiError: undefined,
  };
}

export function buildPrompt(config: Config, plan: Plan, gaps: Gap[]): { system: string; user: string } {
  const system = [
    '你是「日程」插件的排程助手，只负责把当天空档填成具体的小安排。',
    '只输出一个 JSON 对象，不要解释，不要代码块。',
    '只能用给出的空档，每段 30–120 分钟，不能与已有安排重叠。',
    '标题要具体（例如 看两集剧 / 画一张速写 / 修上周的照片），不要写「自由时间」「休息一下」这类空词。',
    '不要编造外出地点，也不要排上班或上课。',
    '如果给了天气，按天气提示安排：雨雪、雷暴、高温时优先室内，不排户外散步。',
    '返回格式：{"tone":"不超过6字","note":"不超过24字","fills":[{"start":"HH:MM","end":"HH:MM","title":"不超过12字","kind":"free|rest|chore|social|study|exercise","note":"不超过20字，可空"}]}',
  ].join('\n');
  const fixed = plan.items
    .filter((item) => !item.auto && item.kind !== 'sleep')
    .map((item) => `${item.start}-${item.end} ${item.title}`)
    .join('\n');
  const gapText = gaps.map((gap) => `${formatHHMM(gap.start)}-${formatHHMM(gap.end)}`).join('\n');
  const user = [
    `日期：${plan.date}`,
    ...(plan.holiday ? [`今天是${plan.holiday.name}第 ${plan.holiday.dayIndex + 1}/${plan.holiday.days} 天，不排上班/上课。`] : []),
    ...(plan.workday ? [`今天${plan.workday}，按工作日。`] : []),
    ...(plan.travel ? [`已安排旅行：${plan.travel.destination}，第 ${plan.travel.dayIndex + 1}/${plan.travel.days} 天；空档只安排旅行中的吃饭、休息或返程，不要再加新的外出地点。`] : []),
    ...(plan.weather ? [weatherPromptLine(plan.weather), aiWeatherHint(plan.weather)] : []),
    `当天基调参考：${plan.tone}`,
    fixed ? `已有安排：\n${fixed}` : '已有安排：没有固定安排',
    `可填的空档：\n${gapText}`,
    config.ai.style ? `额外要求：${config.ai.style}` : '',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/**
 * 用已配置的对话模型润色空档。任何一步失败都抛错，由调用方保留骨架并记录 aiError。
 */
export async function augmentWithModel(ctx: Context, config: Config, plan: Plan): Promise<Plan> {
  if (!config.ai.enabled) return plan;
  if (!config.ai.model) throw Error('AI 润色已开启，但没有选择模型');
  const model = ctx.models.list('chat').find((entry) => entry.id === config.ai.model && entry.callable);
  if (!model) throw Error('所选模型当前不可用，请在设置页重新选择');
  const gaps = autoGaps(plan);
  if (!gaps.length) return plan;

  const prompt = buildPrompt(config, plan, gaps);
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(45_000)]);
  const reply = await ctx.llm.chat({
    model: config.ai.model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    max_tokens: 600,
    signal,
  });
  const payload = parseAiPayload(reply.text ?? '', gaps);
  if (!payload) throw Error('模型的返回不是有效的空档安排，已保留自动骨架');
  const merged = mergeFills(plan, payload);
  ctx.logger.info('日程模型润色完成', { date: plan.date, fills: payload.fills.length });
  return merged;
}
