/*! 衣柜配置：凡是和本机有关的东西都放这里，用户可以在设置页改。 */

export type PersonaPolicy = 'minor' | 'adult';
export type PersonaGender = 'female' | 'male';
export type OutfitGender = 'female' | 'male' | 'unisex';
export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter' | 'all';
export type TierName = 'general' | 'private' | 'swim' | 'party';

export type CategoryRule = {
  season: SeasonName;
  tier: TierName;
  /** 留空则按关键词自动打场景标签。 */
  scenes?: string[];
  /** 男装/中性库用；不填按女装处理。 */
  gender?: OutfitGender;
};

export type WardrobeConfig = {
  inject: boolean;
  avoidDays: number;
  /** 服装库根目录：绝对路径，或相对插件目录；留空 = 插件内置的 library/。 */
  libraryRoot: string;
  /** 图片 CDN 前缀；留空 = 从 libraryRoot 读图，填了就 302 到 CDN（HOM-* 仍走本地）。 */
  assetBaseUrl: string;
  /** 重新导入时的源目录；留空 = 用 libraryRoot。 */
  importRoot: string;
  /** 成年年龄线，默认 18；不允许低于 18。 */
  adultThreshold: number;
  /** 显式年龄：商城环境下不读宿主私有文件，由用户在设置页填写。 */
  personaAge: Record<string, number>;
  /** 显式年龄和宿主公开资料都拿不到时，默认按未成年处理。 */
  unknownPersona: PersonaPolicy;
  /** 手动覆盖：只对读不到年龄的人格生效；读到的年龄未满 18 时强制未成年。 */
  personaPolicy: Record<string, PersonaPolicy>;
  /** 手动标记人格性别；用于服装库性别筛选，不参与年龄分级。 */
  personaGender: Record<string, PersonaGender>;
  /** 服装库分类 → 季节/分级/场景。换库、换分类名时改这里，不用改代码。 */
  categoryMap: Record<string, CategoryRule>;
};

/** 默认映射按 ComfyUI 服装库现有分类写；用户可在设置页整体替换。 */
export const DEFAULT_CATEGORY_MAP: Record<string, CategoryRule> = {
  春装: { season: 'spring', tier: 'general' },
  夏装: { season: 'summer', tier: 'general' },
  秋装: { season: 'autumn', tier: 'general' },
  冬装: { season: 'winter', tier: 'general' },
  家居服春: { season: 'spring', tier: 'general', scenes: ['home', 'sleep'] },
  家居服夏: { season: 'summer', tier: 'general', scenes: ['home', 'sleep'] },
  家居服秋: { season: 'autumn', tier: 'general', scenes: ['home', 'sleep'] },
  家居服冬: { season: 'winter', tier: 'general', scenes: ['home', 'sleep'] },
  内衣: { season: 'all', tier: 'private', scenes: ['home'] },
  性感: { season: 'all', tier: 'private', scenes: ['home'] },
  泳装: { season: 'summer', tier: 'swim', scenes: ['swim'] },
  派对: { season: 'all', tier: 'party', scenes: ['party', 'dress'] },
  男装: { season: 'all', tier: 'general', gender: 'male', scenes: ['daily', 'school', 'outer', 'active', 'cozy'] },
};

export const DEFAULT_CONFIG: WardrobeConfig = {
  inject: true,
  avoidDays: 3,
  libraryRoot: '',
  assetBaseUrl: 'https://paipiange.github.io/nvzhuang/assets/',
  importRoot: '',
  adultThreshold: 18,
  personaAge: {},
  unknownPersona: 'minor',
  personaPolicy: {},
  personaGender: {},
  categoryMap: DEFAULT_CATEGORY_MAP,
};

const SEASONS: SeasonName[] = ['spring', 'summer', 'autumn', 'winter', 'all'];
const TIERS: TierName[] = ['general', 'private', 'swim', 'party'];

function cleanScenes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scenes = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return scenes.length ? [...new Set(scenes)].slice(0, 12) : undefined;
}

/** 只接受 http(s) 的 CDN 前缀，统一补结尾斜杠；留空 = 本地图。 */
function normalizeAssetBase(value: unknown): string {
  const raw = String(value ?? '').trim().slice(0, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString().endsWith('/') ? url.toString() : url.toString() + '/';
  } catch {
    return '';
  }
}

function normalizeCategoryMap(raw: any): Record<string, CategoryRule> {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CATEGORY_MAP };
  const map: Record<string, CategoryRule> = { ...DEFAULT_CATEGORY_MAP };
  for (const [name, value] of Object.entries(raw as Record<string, any>)) {
    const key = String(name ?? '').trim().slice(0, 40);
    if (!key || !value || typeof value !== 'object') continue;
    const season = SEASONS.includes(value.season) ? value.season : null;
    const tier = TIERS.includes(value.tier) ? value.tier : null;
    if (!season || !tier) continue;
    const scenes = cleanScenes(value.scenes);
    const gender = value.gender === 'male' || value.gender === 'female' || value.gender === 'unisex'
      ? value.gender : undefined;
    const rule: CategoryRule = gender
      ? { season, tier, ...(scenes ? { scenes } : {}), gender }
      : { season, tier, ...(scenes ? { scenes } : {}) };
    map[key] = rule;
  }
  return map;
}

export function normalizeConfig(raw: any): WardrobeConfig {
  const inject = raw?.inject === undefined ? DEFAULT_CONFIG.inject : raw.inject === true;
  const avoid = Number(raw?.avoidDays);
  const avoidDays = Number.isFinite(avoid) ? Math.min(10, Math.max(1, Math.round(avoid))) : DEFAULT_CONFIG.avoidDays;
  const libraryRoot = String(raw?.libraryRoot ?? '').trim().slice(0, 400) || DEFAULT_CONFIG.libraryRoot;
  const assetBaseUrl = normalizeAssetBase(raw?.assetBaseUrl);
  const importRoot = String(raw?.importRoot ?? '').trim().slice(0, 400);
  const threshold = Number(raw?.adultThreshold);
  const adultThreshold = Number.isFinite(threshold)
    ? Math.min(30, Math.max(18, Math.round(threshold)))
    : DEFAULT_CONFIG.adultThreshold;
  const unknownPersona = raw?.unknownPersona === 'adult' ? 'adult' : 'minor';
  const personaAge: Record<string, number> = {};
  if (raw?.personaAge && typeof raw.personaAge === 'object') {
    for (const [id, value] of Object.entries(raw.personaAge)) {
      const age = Number(value);
      if (id && Number.isFinite(age) && age >= 1 && age <= 120) personaAge[id] = Math.round(age);
    }
  }
  const personaPolicy: Record<string, PersonaPolicy> = {};
  if (raw?.personaPolicy && typeof raw.personaPolicy === 'object') {
    for (const [id, value] of Object.entries(raw.personaPolicy)) {
      if (id && (value === 'minor' || value === 'adult')) personaPolicy[id] = value;
    }
  }
  const personaGender: Record<string, PersonaGender> = {};
  if (raw?.personaGender && typeof raw.personaGender === 'object') {
    for (const [id, value] of Object.entries(raw.personaGender)) {
      if (id && (value === 'female' || value === 'male')) personaGender[id] = value;
    }
  }
  return {
    inject,
    avoidDays,
    libraryRoot,
    assetBaseUrl,
    importRoot,
    adultThreshold,
    personaAge,
    unknownPersona,
    personaPolicy,
    personaGender,
    categoryMap: normalizeCategoryMap(raw?.categoryMap),
  };
}

export async function readConfig(ctx: any): Promise<WardrobeConfig> {
  try {
    return normalizeConfig(await ctx.config.read('config.json'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
