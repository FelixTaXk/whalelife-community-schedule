/*! 选衣：先过分级闸门，再按季节/场景/天气打分；避开最近穿过的同一套。 */

import type { Outfit, OutfitTier } from './catalog.ts';
import type { DayState, State } from './state.ts';
import { dayState, personaState, recentIds } from './state.ts';
import { dateKey, sceneForBlock, seasonBand, weatherFlags, type Plan } from './plan.ts';

export type PickOptions = {
  plan?: Plan | null;
  seasons: string[];
  scene: string;
  adult?: boolean;
  recent?: Set<string>;
  used?: Set<string>;
  keyword?: string;
};

const SEASON_WEIGHT = [42, 22];
const SPECIAL_SCENES = new Set(['home', 'swim', 'party', 'active']);

export function isSpecialScene(scene: string): boolean {
  return SPECIAL_SCENES.has(scene);
}

function tierOf(item: Outfit): OutfitTier {
  return item.tier ?? 'general';
}

/** 未成年人格碰到泳池/晚宴/居家时，回落到日常场景，不匹配成人分类。 */
export function effectiveScene(scene: string, adult = false): string {
  if (adult) return scene;
  if (scene === 'swim') return 'active';
  if (scene === 'party') return 'dress';
  if (scene === 'home') return 'cozy';
  return scene;
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

  if (opts.recent?.has(item.id)) score -= 18;
  if (opts.used?.has(item.id)) score -= 26;
  return score + Math.random() * 6;
}

export function pickOutfit(items: Outfit[], opts: PickOptions): Outfit | null {
  if (!items.length) return null;
  let best: Outfit | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const score = scoreOutfit(item, opts);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export function pickMany(items: Outfit[], opts: PickOptions, count = 5): Outfit[] {
  return [...items]
    .map((item) => ({ item, score: scoreOutfit(item, opts) }))
    .filter((entry) => entry.score > -1e8)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, count))
    .map((entry) => entry.item);
}

/** 一天一套主穿搭；只有回家、泳池、晚宴、运动这类特殊段才换。 */
export function ensureDay(
  plan: Plan,
  items: Outfit[],
  state: State,
  avoidDays: number,
  personaId: string,
  adult = false,
): { day: DayState; changed: boolean } {
  const date = plan.date || dateKey();
  const day = dayState(state, date, personaId);
  const byId = new Map(items.map((item) => [item.id, item]));
  const seasons = seasonBand(plan.weather);
  const recent = recentIds(state, avoidDays, date, personaId);
  let changed = false;

  const blocks = [...(plan.items ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const scenes = new Map(blocks.map((block) => [block.id, sceneForBlock(block)]));
  const hasSchool = [...scenes.values()].includes('school');
  const firstNormal = blocks.find((block) => !SPECIAL_SCENES.has(scenes.get(block.id)!));
  const baseScene = hasSchool ? 'school' : firstNormal ? scenes.get(firstNormal.id)! : 'cozy';

  // 主穿搭：当天只挑一次，之后就固定，不会每段重摇。
  const savedBase = day.base ? byId.get(day.base) : null;
  let base = savedBase && itemAllowed(savedBase, baseScene, adult) ? savedBase : null;
  if (!base) {
    base = pickOutfit(items, { plan, seasons, scene: baseScene, adult, recent });
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
      let special = saved && itemAllowed(saved, scene, adult) ? saved : null;
      if (!special) {
        special = pickOutfit(items, { plan, seasons, scene, adult, recent, used });
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
    if (overrideItem && !itemAllowed(overrideItem, scene, adult)) {
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
    seasons: seasonBand(plan.weather),
    scene: sceneForBlock(block),
    adult,
    recent: recentIds(state, avoidDays, plan.date, personaId),
  });
}
