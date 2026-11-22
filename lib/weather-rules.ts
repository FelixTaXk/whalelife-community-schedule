/*! 日程 plugin · 天气规则：把预报翻译成排程上的具体调整（纯函数）。 */

import type { Plan, PlanItem, Routine } from './types.ts';
import type { WeatherDay, WeatherHour } from './weather-types.ts';
import { parseHHMM } from './time.ts';

const OUTDOOR_WORDS = [
  '出去走走', '出门', '散步', '遛弯', '跑步', '骑行', '爬山', '野餐', '露营',
  '公园', '户外', '晒太阳', '打球', '钓鱼', '逛街',
];

const INDOOR_FALLBACK = ['看剧', '看书', '画画', '听歌', '收拾房间', '在家做点吃的'];

export function isWetDay(day: WeatherDay): boolean {
  return day.code >= 51 || day.precipitationProbability >= 60;
}

export function isSevereDay(day: WeatherDay): boolean {
  return day.code >= 95
    || (day.code >= 71 && day.code <= 86)
    || day.precipitationProbability >= 80
    || day.windMax >= 40;
}

export function isHotDay(day: WeatherDay): boolean {
  return day.max >= 33;
}

export function isNiceDay(day: WeatherDay): boolean {
  return !isWetDay(day) && !isSevereDay(day)
    && day.code <= 2 && day.precipitationProbability < 30
    && day.max >= 15 && day.max <= 28;
}

/** 只保留影响排程的类别：晴雨、是否恶劣、是否高温、是否适合出门。 */
export function weatherKey(day: WeatherDay): string {
  return [isWetDay(day), isSevereDay(day), isHotDay(day), isNiceDay(day)]
    .map((flag) => (flag ? '1' : '0'))
    .join('');
}

export function aiWeatherHint(day: WeatherDay): string {
  const hints: string[] = [];
  if (isSevereDay(day)) hints.push('有雷暴、大雪或强降水：空档优先室内，别排户外活动。');
  else if (isWetDay(day)) hints.push('有雨雪：空档优先室内；必须出门的，备注带伞，别排散步、遛弯、跑步。');
  if (isHotDay(day)) hints.push('高温：12:00–16:00 不要排户外活动，可以排室内或早晚出门。');
  if (isNiceDay(day)) hints.push('天气不错：可以留一段 60–90 分钟的出门走走。');
  if (day.max <= 3) hints.push('很冷：户外安排缩短，备注穿厚一点。');
  return hints.join(' ');
}

export function weatherPromptLine(day: WeatherDay): string {
  const rain = day.precipitationProbability > 0 ? `，降水概率 ${day.precipitationProbability}%` : '';
  return `天气：${day.text}，${day.min}–${day.max}℃${rain}${day.tip ? `，${day.tip}` : ''}`;
}

function looksOutdoor(text: string): boolean {
  return OUTDOOR_WORDS.some((word) => text.includes(word));
}

function looksIndoor(text: string): boolean {
  return ['室内', '在家', '健身房', '跑步机', '瑜伽'].some((word) => text.includes(word));
}

function appendNote(note: string | undefined, extra: string): string {
  const text = note ? `${note}；${extra}` : extra;
  return text.slice(0, 60);
}

function indoorChoices(routine: Routine): string[] {
  const pool = routine.hobbies.filter((item) => !looksOutdoor(item));
  return pool.length ? pool : INDOOR_FALLBACK;
}

function replaceOutdoorFree(items: PlanItem[], routine: Routine, note: string): boolean {
  let changed = false;
  let index = 0;
  for (const item of items) {
    if (!item.auto || item.kind !== 'free' || !looksOutdoor(item.title)) continue;
    const choices = indoorChoices(routine);
    const title = choices[index % choices.length];
    index += 1;
    const prefix = item.title.startsWith('自由 · ') ? '自由 · ' : '';
    item.title = `${prefix}${title}`.slice(0, 24);
    item.note = appendNote(item.note, note);
    changed = true;
  }
  return changed;
}

/** 生成后按天气改写：运动改室内、户外空档改室内、好天气周末留出门时间。 */
export function applyWeatherRules(plan: Plan, day: WeatherDay | null | undefined, routine: Routine): Plan {
  if (!day) return plan;
  const items: PlanItem[] = plan.items.map((item) => ({ ...item }));
  const adjusted: string[] = [...(plan.weatherAdjusted ?? [])];
  const add = (text: string) => {
    if (text && !adjusted.includes(text)) adjusted.push(text);
  };

  const wet = isWetDay(day);
  const severe = isSevereDay(day);
  const hot = isHotDay(day);

  if (wet || severe || hot) {
    for (const item of items) {
      if (item.kind !== 'exercise' || looksIndoor(item.title)) continue;
      item.title = `室内 · ${item.title}`.slice(0, 24);
      item.note = appendNote(item.note, `天气${day.text}，改在室内`);
      add(`运动改室内（${day.text}）`);
    }
    if (replaceOutdoorFree(items, routine, `${day.text}，改成室内`)) add('户外空档改成室内');
  }

  if (severe) add(day.tip || '天气不好，尽量别出门');
  if (hot) add('午后避开户外');
  if (day.max <= 3) add('很冷，出门穿厚一点');

  const weekend = plan.weekday >= 6;
  if (weekend && !plan.travel && isNiceDay(day)) {
    const existing = items.find((item) => item.title.includes('出去走走') || (item.note ?? '').includes('天气好'));
    if (existing) {
      if (!(existing.note ?? '').includes('天气好')) existing.note = appendNote(existing.note, '天气好，出去走走');
      add('天气好，留了出门时间');
    } else {
      const candidates = items.filter((item) => {
        if (!item.auto || item.kind !== 'free') return false;
        const start = parseHHMM(item.start);
        const end = parseHHMM(item.end);
        return start !== null && end !== null && start >= 12 * 60 && end <= 19 * 60 && end - start >= 60;
      });
      const target = candidates.sort((left, right) => {
        const leftStart = parseHHMM(left.start) ?? 0;
        const rightStart = parseHHMM(right.start) ?? 0;
        return Math.abs(leftStart - 15 * 60) - Math.abs(rightStart - 15 * 60);
      })[0];
      if (target) {
        target.title = '出去走走';
        target.note = '天气好，出去走走';
        add('天气好，留了出门时间');
      }
    }
  }

  return {
    ...plan,
    items,
    weather: day,
    weatherKey: weatherKey(day),
    ...(adjusted.length ? { weatherAdjusted: adjusted.slice(0, 6) } : {}),
  };
}

/** 逐小时：给通勤/户外/旅行标注降水最低的时段，不改动已有占位。 */
export function applyHourlyRules(plan: Plan, hours: WeatherHour[] | undefined, day: WeatherDay | null | undefined): Plan {
  if (!hours?.length || !day) return plan;
  const today = hours.filter((entry) => entry.date === plan.date && entry.hour >= 6 && entry.hour <= 23);
  if (!today.length) return plan;
  const items: PlanItem[] = plan.items.map((item) => ({ ...item }));
  const adjusted: string[] = [...(plan.weatherAdjusted ?? [])];
  const add = (text: string) => {
    if (text && !adjusted.includes(text)) adjusted.push(text);
  };
  const windowAt = (start: number, minutes: number) => {
    const end = start + minutes;
    const slice = today.filter((entry) => entry.hour >= Math.floor(start / 60) && entry.hour < Math.ceil(end / 60));
    if (!slice.length) return null;
    return {
      probability: Math.max(...slice.map((entry) => entry.precipitationProbability)),
      precipitation: Math.max(...slice.map((entry) => entry.precipitation)),
    };
  };
  const best = (minutes: number): WeatherHour | null => {
    let pick: WeatherHour | null = null;
    let score = Infinity;
    for (const entry of today) {
      if (entry.hour < 8 || entry.hour > 20) continue;
      const info = windowAt(entry.hour * 60, minutes);
      if (!info) continue;
      const value = info.probability * 2 + info.precipitation * 10 + Math.abs(entry.hour - 15) * 2;
      if (value < score) {
        score = value;
        pick = entry;
      }
    }
    return pick;
  };

  for (const item of items) {
    const start = parseHHMM(item.start);
    if (start === null) continue;
    const duration = Math.max(30, (parseHHMM(item.end) ?? start + 60) - start);
    if (item.kind === 'commute' || item.kind === 'travel') {
      const info = windowAt(start, duration);
      if (info && info.probability >= 30) {
        item.note = appendNote(item.note, `这个时段降水 ${info.probability}%，带伞并多留 10 分钟`);
        add(`${item.start} ${item.title} 有降水`);
      }
      continue;
    }
    const outdoor = item.kind === 'exercise' || looksOutdoor(item.title);
    if (!outdoor || looksIndoor(item.title)) continue;
    const current = windowAt(start, duration);
    if (!current || current.probability < 30) continue;
    const target = best(Math.min(120, duration));
    if (!target) continue;
    item.note = appendNote(item.note, `户外段可挪到 ${String(target.hour).padStart(2, '0')}:00 附近，降水 ${target.precipitationProbability}%`);
    add(`${item.title} 挪到降水低的时段`);
  }

  let travel = plan.travel;
  if (travel?.itinerary) {
    const target = best(60);
    if (target && target.precipitationProbability <= 30) {
      const tip = `如果出门，优先 ${String(target.hour).padStart(2, '0')}:00–${String((target.hour + 1) % 24).padStart(2, '0')}:00（降水 ${target.precipitationProbability}%）。`;
      travel = { ...travel, itinerary: { ...travel.itinerary, backup: `${travel.itinerary.backup} ${tip}`.slice(0, 220) } };
    }
  }

  return {
    ...plan,
    items,
    travel,
    hourly: today,
    ...(adjusted.length ? { weatherAdjusted: adjusted.slice(0, 8) } : {}),
  };
}
