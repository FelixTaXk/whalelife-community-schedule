/*! 读日程数据、判断当前时段该穿什么场景。 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const SCHEDULE_DIR = resolve(DIR, '..', '..', '..'); // plugins/schedule
const DAYS_DIR = join(SCHEDULE_DIR, 'data', 'days');

export type PlanItem = {
  id: string;
  start: string;
  end: string;
  title: string;
  kind: string;
  place?: string;
  note?: string;
  status?: string;
  auto?: boolean;
};

export type Plan = {
  date: string;
  weekday?: number;
  tone?: string;
  note?: string;
  items: PlanItem[];
  weather?: any;
  weatherAdjusted?: string[];
  sleepAt?: string;
  source?: string;
  edited?: boolean;
};

export function dateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function minuteOfDay(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function toMinutes(value: string): number {
  const raw = String(value ?? '').trim();
  if (raw === '24:00') return 1440;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function readPlan(date: string): Plan | null {
  const file = join(DAYS_DIR, `${date}.json`);
  if (!existsSync(file)) return null;
  try {
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(plan.items)) return null;
    return plan as Plan;
  } catch {
    return null;
  }
}

export function blockAt(plan: Plan, minutes = minuteOfDay()): { block: PlanItem; state: 'now' | 'next' | 'idle' } | null {
  const items = plan.items ?? [];
  for (const item of items) {
    const start = toMinutes(item.start);
    const end = toMinutes(item.end);
    if (minutes >= start && minutes < end) return { block: item, state: 'now' };
  }
  const next = items.find((item) => toMinutes(item.start) > minutes);
  if (next) return { block: next, state: 'next' };
  return null;
}

export function blockById(plan: Plan, id: string): PlanItem | null {
  return (plan.items ?? []).find((item) => item.id === id) ?? null;
}

export function blockByTime(plan: Plan, minutes: number): PlanItem | null {
  const hit = blockAt(plan, minutes);
  return hit?.block ?? null;
}

/** 日程某一段对应什么穿衣场景。默认按这一段的开始时间判断，不按当前钟点。 */
export function sceneForBlock(block: PlanItem, nowMinutes = toMinutes(String(block.start ?? '00:00'))): string {
  const title = String(block.title ?? '');
  const place = String(block.place ?? '');
  const kind = String(block.kind ?? '');
  const where = `${title} ${place}`;

  // 特殊场合优先，成年人格才解锁对应分类；未成年人格在 picker 里回落到日常款。
  if (/泳池|游泳池|海边|海滩|沙滩|游泳|戏水|水上乐园|温泉|潜水|冲浪/.test(where)) return 'swim';
  if (/晚宴|宴会|酒会|婚礼|年会|派对|舞会|庆功|红毯|典礼/.test(where)) return 'party';
  if (/居家|在家|宅家|回家|睡前|起床|洗漱|午睡|休息|洗澡/.test(title) || nowMinutes >= 23 * 60 || nowMinutes < 7 * 60) return 'home';
  if (/上课|上班|通勤/.test(title) || kind === 'work') return place.includes('学校') || title.includes('上课') ? 'school' : 'daily';
  if (/运动|健身|跑步|散步|打球/.test(title) || kind === 'exercise') return 'active';
  if (/出去|逛|买菜|户外|走走/.test(title)) return 'outer';
  if (/洗衣|整理|打扫|收拾|家务/.test(title) || kind === 'chore') return 'cozy';
  if (/早餐|午饭|晚饭|吃饭/.test(title) || kind === 'meal') return place.includes('家') || !place ? 'cozy' : 'daily';
  if (kind === 'routine' || kind === 'rest' || kind === 'free') return 'cozy';
  return 'daily';
}

export function seasonBand(weather: any, date = new Date()): string[] {
  const tmax = Number(weather?.max);
  if (Number.isFinite(tmax)) {
    if (tmax >= 27) return ['summer'];
    if (tmax >= 22) return ['summer', 'spring'];
    if (tmax >= 16) return ['spring', 'autumn'];
    if (tmax >= 10) return ['autumn', 'spring'];
    return ['winter', 'autumn'];
  }
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return ['spring'];
  if (month >= 6 && month <= 8) return ['summer'];
  if (month >= 9 && month <= 11) return ['autumn'];
  return ['winter'];
}

export function weatherFlags(weather: any) {
  const text = String(weather?.text ?? '');
  const precip = Number(weather?.precipitation ?? 0) + Number(weather?.precipitationProbability ?? 0);
  const tmax = Number(weather?.max);
  return {
    rainy: /雨|雪|雷/.test(text) || precip > 0,
    cold: Number.isFinite(tmax) && tmax <= 15,
    hot: Number.isFinite(tmax) && tmax >= 28,
    text,
    tmax: Number.isFinite(tmax) ? tmax : null,
    tmin: Number.isFinite(Number(weather?.min)) ? Number(weather.min) : null,
  };
}

export function blockLabel(block: PlanItem) {
  return `${block.start}–${block.end} ${block.title}`;
}
