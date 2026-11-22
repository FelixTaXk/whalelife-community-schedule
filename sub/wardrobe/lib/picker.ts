/*! 选衣：先过分级/性别闸门，再按季节/场景/天气/反馈打分；避开最近穿过的同一套。 */

import type { Feedback } from './state.ts';
import type { Outfit, OutfitTier } from './catalog.ts';
import type { DayState, State } from './state.ts';
import { dayState, feedbackFor, personaState, recentIds } from './state.ts';
import { dateKey, planSeasons, sceneForBlock, weatherFlags, type Plan } from './plan.ts';

export type PickOptions = {
  plan?: Plan | null;
  seasons: string[];
  scene: string;
  adult?: boolean;
  gender?: 'female' | 'male' | null;
  recent?: Set<string>;
  used?: Set<string>;
  keyword?: string;
  feedback?: Feedback;
};

const SEASON_WEIGHT = [42, 22];
const SPECIAL_SCENES = new Set(['home', 'sleep', 'swim', 'party', 'active']);

export function isSpecialScene(scene: string): boolean {
  return SPECIAL_SCENES.has(scene);
}

function tierOf(item: Outfit): OutfitTier {
  return item.tier ?? 'general';
}

function outfitGender(item: Outfit): 'female' | 'male' | 'unisex' {
  return item.gender ?? 'female';
}

/** 旧搭配还算不算当季：all 永远算，其余要在当前季节带里。 */
function seasonFits(item: Outfit, seasons: string[]): boolean {
  return item.season === 'all' || seasons.includes(item.season);
}

/** 未成年人格碰到泳池/晚宴时，回落到日常场景；居家/睡眠走家居服。 */
export function effectiveScene(scene: string, adult = false): string {
  if (adult) return scene;
  if (scene === 'swim') return 'active';
  if (scene === 'party') return 'dress';
  return scene;
}

/** 家居服分类（导入时归到 家居服春/夏/秋/冬）。 */
export function isLounge(item: Outfit): boolean {
  return String((item as any).category ?? '').startsWith('家居服');
}

/**
 * 未成年人格在回家/睡眠场景优先只从家居服里挑；
 * 库里还没有家居服时返回 null，按原逻辑回落。
 */
export function loungePool(items: Outfit[], scene: string, adult = false): Outfit[] | null {
  if (adult || (scene !== 'home' && scene !== 'sleep')) return null;
  const pool = items.filter((item) => isLounge(item) && item.scenes.includes(scene));
  return pool.length ? pool : null;
}

function genderAllowed(item: Outfit, gender?: 'female' | 'male' | null): boolean {
  const value = outfitGender(item);
  if (value === 'unisex') return true;
  if (!gender) return value === 'female';
  return value === gender;
}

function scenePool(items: Outfit[], opts: PickOptions): Outfit[] {
  const base = loungePool(items, opts.scene, opts.adult === true) ?? items;
  const byScene = base.filter((item) => itemAllowed(item, opts.scene, opts.adult === true));
  const byGender = byScene.filter((item) => genderAllowed(item, opts.gender));
  // 没有对应性别/场景的库时，宁可回落到日常款并提示，也不返回空。
  return byGender.length ? byGender : byScene;
}

export function itemAllowed(item: Outfit, scene: string, adult = false): boolean {
  const tier = tierOf(item);
  if (tier === 'general') return true;
  if (!adult) return false;
  if (tier === 'private') return scene === 'home';
  if (tier === 'swim') return scene === 'swim';
  if (tier === 'party') return scene === 'party';
  return false;
}

export function scoreOutfit(item: Outfit, opts: PickOptions): number {
  const adult = opts.adult === true;
  if (!itemAllowed(item, opts.scene, adult)) return -1e9;
  if (opts.feedback?.never.includes(item.id)) return -1e9;
  // 泳池/晚宴对成年人格是硬匹配：只允许泳装/派对，不拿日常款凑数。
  if (adult && opts.scene === 'swim' && tierOf(item) !== 'swim') return -1e9;
  if (adult && opts.scene === 'party' && tierOf(item) !== 'party') return -1e9;

  let score = 0;
  if (item.season === 'all') score += 14;
  else {
    const rank = opts.seasons.indexOf(item.season);
    if (rank >= 0) score += SEASON_WEIGHT[Math.min(rank, SEASON_WEIGHT.length - 1)];
    else score -= 30;
  }

  const scene = effectiveScene(opts.scene, adult);
  if (item.scenes.includes(scene)) score += 24;
  if (scene === 'daily' && item.scenes.includes('daily')) score += 10;
  if (scene === 'school' && item.scenes.includes('school')) score += 8;
  if (scene === 'outer' && item.scenes.includes('outer')) score += 8;
  if (opts.scene === 'home' && adult && tierOf(item) === 'private') score += 10;
  if (opts.scene === 'swim' && adult && tierOf(item) === 'swim') score += 18;
  if (opts.scene === 'party' && adult && tierOf(item) === 'party') score += 18;

  const flags = weatherFlags(opts.plan?.weather);
  if (flags.rainy && item.scenes.includes('outer')) score += 14;
  if (flags.cold && !item.scenes.includes('outer')) score -= 8;
  if (flags.hot && item.scenes.includes('outer')) score -= 10;

  if (opts.keyword) {
    const needle = opts.keyword.toLowerCase();
    const hay = `${item.name} ${item.en} ${item.scenes.join(' ')}`.toLowerCase();
    score += hay.includes(needle) ? 22 : -40;
  }

  if (opts.feedback?.likes.includes(item.id)) score += 28;
  if (opts.feedback?.dislikes.includes(item.id)) score -= 28;
  if (opts.recent?.has(item.id)) score -= 18;
  if (opts.used?.has(item.id)) score -= 26;
  return score + Math.random() * 6;
}

export function pickOutfit(items: Outfit[], opts: PickOptions): Outfit | null {
  if (!items.length) return null;
  const pool = scenePool(items, opts).filter((item) => itemAllowed(item, opts.scene, opts.adult === true));
  let best: Outfit | null = null;
  let bestScore = -Infinity;
  for (const item of pool) {
    const score = scoreOutfit(item, opts);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export function pickMany(items: Outfit[], opts: PickOptions, count = 5): Outfit[] {
  return [...scenePool(items, opts)]
    .filter((item) => itemAllowed(item, opts.scene, opts.adult === true))
    .map((item) => ({ item, score: scoreOutfit(item, opts) }))
    .filter((entry) => entry.score > -1e8)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, count))
    .map((entry) => entry.item);
}

/** 日程/天气/人格分级变化时，需要重新自动配衣。 */
export function contextHash(plan: Plan, adult: boolean, gender?: 'female' | 'male' | null): string {
  return JSON.stringify({
    date: plan.date,
    weather: plan.weather ? {
      text: plan.weather.text ?? '',
      min: plan.weather.min ?? null,
      max: plan.weather.max ?? null,
      precipitation: plan.weather.precipitation ?? null,
    } : null,
    adult,
    gender: gender ?? '',
    items: (plan.items ?? []).map((item) => [item.id, item.start, item.end, item.title, item.kind, item.place ?? '', item.status ?? '']),
  });
}

/** 一天一套主穿搭；只有回家、泳池、晚宴、运动这类特殊段才换。 */
export function ensureDay(
  plan: Plan,
  items: Outfit[],
  state: State,
  avoidDays: number,
  personaId: string,
  adult = false,
  feedback = feedbackFor(state, personaId),
  gender: 'female' | 'male' | null = null,
): { day: DayState; changed: boolean } {
  const date = plan.date || dateKey();
  const day = dayState(state, date, personaId);
  const byId = new Map(items.map((item) => [item.id, item]));
  const seasons = planSeasons(plan);
  const recent = recentIds(state, avoidDays, date, personaId);
  const hash = contextHash(plan, adult, gender);
  const contextChanged = Boolean(day.contextHash && day.contextHash !== hash);
  let changed = false;

  // 锁定后不因日程/天气变化重配；只有旧搭配不再合规（年龄/场景闸门）才换。
  if (contextChanged && !day.locked) {
    if (day.base) {
      delete day.base;
      changed = true;
    }
    if (day.specials && Object.keys(day.specials).length) {
      day.specials = {};
      changed = true;
    }
  }
  day.contextHash = hash;

  const blocks = [...(plan.items ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const scenes = new Map(blocks.map((block) => [block.id, sceneForBlock(block)]));
  const hasSchool = [...scenes.values()].includes('school');
  const firstNormal = blocks.find((block) => !SPECIAL_SCENES.has(scenes.get(block.id)!));
  const baseScene = hasSchool ? 'school' : firstNormal ? scenes.get(firstNormal.id)! : 'cozy';

  // 主穿搭：当天只挑一次，之后就固定，不会每段重摇。
  const savedBase = day.base ? byId.get(day.base) : null;
  let base = savedBase && itemAllowed(savedBase, baseScene, adult) && (day.locked || seasonFits(savedBase, seasons)) ? savedBase : null;
  if (!base) {
    base = pickOutfit(items, { plan, seasons, scene: baseScene, adult, gender, recent, feedback });
  }
  if (!base) return { day, changed };
  if (day.base !== base.id) {
    day.base = base.id;
    changed = true;
  }
  if (!day.specials) day.specials = {};
  const used = new Set<string>([base.id]);

  for (const block of blocks) {
    const scene = scenes.get(block.id)!;
    let id = base.id;
    if (SPECIAL_SCENES.has(scene)) {
      const saved = day.specials[scene] ? byId.get(day.specials[scene]) : null;
      const mustLounge = loungePool(items, scene, adult) !== null;
      let special = saved && itemAllowed(saved, scene, adult) && (day.locked || seasonFits(saved, seasons)) && (!mustLounge || isLounge(saved)) ? saved : null;
      if (!special) {
        special = pickOutfit(items, { plan, seasons, scene, adult, gender, recent, used, feedback });
      }
      if (special) {
        day.specials[scene] = special.id;
        used.add(special.id);
        id = special.id;
      }
    }
    if (day.blocks[block.id] !== id) {
      day.blocks[block.id] = id;
      changed = true;
    }
    const override = day.overrides[block.id];
    const overrideItem = override ? byId.get(override) : null;
    const mustLounge = loungePool(items, scene, adult) !== null;
    if (overrideItem && (!itemAllowed(overrideItem, scene, adult) || (mustLounge && !isLounge(overrideItem)) || feedback.never.includes(overrideItem.id))) {
      delete day.overrides[block.id];
      changed = true;
    }
  }

  if (changed) {
    const bucket = personaState(state, personaId);
    bucket.recent = bucket.recent.filter((entry) => entry.date !== date);
    for (const id of new Set([base.id, ...Object.values(day.specials)])) {
      bucket.recent.push({ id, date });
    }
    bucket.recent = bucket.recent.slice(-120);
  }
  return { day, changed };
}

export function outfitForBlock(
  blockId: string,
  day: DayState,
  byId: Map<string, Outfit>,
  items: Outfit[],
  plan: Plan,
  avoidDays: number,
  state: State,
  personaId: string,
  adult = false,
): Outfit | null {
  const override = day.overrides[blockId];
  const id = override || day.blocks[blockId];
  if (id && byId.has(id)) {
    const item = byId.get(id)!;
    if (itemAllowed(item, sceneForBlock((plan.items ?? []).find((b) => b.id === blockId) ?? ({ id: blockId } as any)), adult)) return item;
  }
  const block = (plan.items ?? []).find((item) => item.id === blockId);
  if (!block) return null;
  return pickOutfit(items, {
    plan,
    seasons: planSeasons(plan),
    scene: sceneForBlock(block),
    adult,
    recent: recentIds(state, avoidDays, plan.date, personaId),
  });
}
