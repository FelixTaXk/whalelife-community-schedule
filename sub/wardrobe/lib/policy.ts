/*! 人格分级：只用宿主公开接口和插件自己的显式资料，不读宿主私有配置文件或人格正文。 */

import { readConfig, type PersonaPolicy } from './config.ts';

export type Audience = {
  id: string;
  name: string;
  age: number | null;
  adult: boolean;
  threshold: number;
  source: 'age' | 'policy' | 'unknown' | 'fallback';
  hasAdultTiers: boolean;
  /** 只用于提示：当前库里没有对应性别的衣服时，生图会不匹配。 */
  gender: 'female' | 'male' | null;
  genderSource: 'config' | 'host' | 'none';
};

type HostPersona = { id: string; name: string; age?: number; gender?: 'female' | 'male' };

function hostPersonas(ctx?: any): HostPersona[] {
  try {
    const listed = typeof ctx?.personas?.list === 'function' ? ctx.personas.list() : [];
    if (!Array.isArray(listed)) return [];
    return listed
      .filter((item: any) => item && typeof item.id === 'string' && item.id)
      .map((item: any) => {
        const age = Number(item.age);
        return {
          id: String(item.id),
          name: String(item.name ?? item.id),
          age: Number.isFinite(age) && age >= 1 && age <= 120 ? Math.round(age) : undefined,
          gender: item.gender === 'male' || item.gender === 'female' ? item.gender : undefined,
        };
      });
  } catch {
    return [];
  }
}

export function defaultPersonaId(ctx?: any): string {
  const first = hostPersonas(ctx)[0];
  // 宿主连人格都没配：用一个中性桶，别把状态写到某个具体人格名下。
  return first?.id ?? 'default';
}

export function personaName(ctx: any, id: string): string {
  return hostPersonas(ctx).find((item) => item.id === id)?.name ?? id;
}

export async function audienceFor(ctx: any, personaId?: string): Promise<Audience> {
  const config = await readConfig(ctx);
  const id = String(personaId ?? '').trim() || defaultPersonaId(ctx);
  const listed = hostPersonas(ctx).find((item) => item.id === id);
  const configuredAge = config.personaAge[id];
  const age = configuredAge ?? listed?.age ?? null;
  const override: PersonaPolicy | undefined = config.personaPolicy[id];
  const threshold = config.adultThreshold;

  let adult = false;
  let source: Audience['source'] = 'unknown';
  if (override === 'minor') {
    adult = false;
    source = 'policy';
  } else if (override === 'adult') {
    // 读到年龄未满线时，手动“成年”也不生效，避免把未成年人格改成成年。
    adult = age === null || age >= threshold;
    source = 'policy';
  } else if (age !== null) {
    adult = age >= threshold;
    source = 'age';
  } else {
    adult = config.unknownPersona === 'adult';
    source = 'unknown';
  }

  const configuredGender = config.personaGender[id];
  const hostGender = listed?.gender ?? null;
  const gender: Audience['gender'] = configuredGender ?? hostGender;
  const genderSource: Audience['genderSource'] = configuredGender ? 'config' : hostGender ? 'host' : 'none';

  return {
    id,
    name: personaName(ctx, id),
    age,
    adult,
    threshold,
    source,
    hasAdultTiers: adult,
    gender,
    genderSource,
  };
}

export async function listAudiences(ctx: any): Promise<Audience[]> {
  const ids = new Set<string>();
  for (const item of hostPersonas(ctx)) ids.add(item.id);
  if (!ids.size) ids.add(defaultPersonaId(ctx));
  const list: Audience[] = [];
  for (const id of ids) list.push(await audienceFor(ctx, id));
  return list;
}
