/*! 衣柜配置。 */

export type PersonaPolicy = 'minor' | 'adult';

export type WardrobeConfig = {
  inject: boolean;
  avoidDays: number;
  libraryRoot: string;
  /** 成年年龄线，默认 18；不允许低于 18。 */
  adultThreshold: number;
  /** 人格设定里读不到年龄时，默认按未成年处理。 */
  unknownPersona: PersonaPolicy;
  /** 手动覆盖：只对读不到年龄的人格生效；读到的年龄未满 18 时强制未成年。 */
  personaPolicy: Record<string, PersonaPolicy>;
};

export const DEFAULT_CONFIG: WardrobeConfig = {
  inject: true,
  avoidDays: 3,
  libraryRoot: '',
  adultThreshold: 18,
  unknownPersona: 'minor',
  personaPolicy: {},
};

export function normalizeConfig(raw: any): WardrobeConfig {
  const inject = raw?.inject === undefined ? DEFAULT_CONFIG.inject : raw.inject === true;
  const avoid = Number(raw?.avoidDays);
  const avoidDays = Number.isFinite(avoid) ? Math.min(10, Math.max(1, Math.round(avoid))) : DEFAULT_CONFIG.avoidDays;
  const libraryRoot = String(raw?.libraryRoot ?? '').trim() || DEFAULT_CONFIG.libraryRoot;
  const threshold = Number(raw?.adultThreshold);
  const adultThreshold = Number.isFinite(threshold)
    ? Math.min(30, Math.max(18, Math.round(threshold)))
    : DEFAULT_CONFIG.adultThreshold;
  const unknownPersona = raw?.unknownPersona === 'adult' ? 'adult' : 'minor';
  const personaPolicy: Record<string, PersonaPolicy> = {};
  if (raw?.personaPolicy && typeof raw.personaPolicy === 'object') {
    for (const [id, value] of Object.entries(raw.personaPolicy)) {
      if (id && (value === 'minor' || value === 'adult')) personaPolicy[id] = value;
    }
  }
  return { inject, avoidDays, libraryRoot, adultThreshold, unknownPersona, personaPolicy };
}

export async function readConfig(ctx: any): Promise<WardrobeConfig> {
  try {
    return normalizeConfig(await ctx.config.read('config.json'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
