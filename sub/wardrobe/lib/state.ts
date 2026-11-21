/*! 穿搭状态：每个人格一份，避免成年人格的泳装/礼服串到未成年人格。 */

import { dateKey } from './plan.ts';
import { defaultPersonaId } from './policy.ts';

export type DayState = {
  /** 当天主穿搭：普通日程段都穿这一套。 */
  base?: string;
  /** 特殊场景固定的一套：home / swim / party / active，避免同类段来回换。 */
  specials?: Record<string, string>;
  blocks: Record<string, string>;
  overrides: Record<string, string>;
};

export type PersonaState = {
  days: Record<string, DayState>;
  recent: Array<{ id: string; date: string }>;
};

export type State = {
  personas: Record<string, PersonaState>;
  updatedAt?: string;
};

export function emptyState(): State {
  return { personas: {} };
}

function normalizePersona(raw: any): PersonaState {
  return {
    days: raw && typeof raw.days === 'object' && raw.days ? raw.days : {},
    recent: Array.isArray(raw?.recent) ? raw.recent.filter((x: any) => x?.id && x?.date) : [],
  };
}

export async function readState(ctx: any, personaId = 'whale'): Promise<State> {
  let raw: any = null;
  try {
    raw = await ctx.config.read('state.json');
  } catch {
    raw = null;
  }
  const state: State = { personas: {}, updatedAt: raw?.updatedAt };
  if (raw?.personas && typeof raw.personas === 'object') {
    for (const [id, value] of Object.entries(raw.personas)) {
      state.personas[id] = normalizePersona(value);
    }
  } else if (raw && (raw.days || raw.recent)) {
    // 老版本是单人份，迁移到宿主的默认人格。
    state.personas[defaultPersonaId(ctx) || personaId] = normalizePersona(raw);
  }
  return state;
}

export async function saveState(ctx: any, state: State): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await ctx.config.save('state.json', state);
}

export function personaState(state: State, personaId: string): PersonaState {
  const id = personaId || 'whale';
  if (!state.personas[id]) state.personas[id] = { days: {}, recent: [] };
  return state.personas[id];
}

export function dayState(state: State, date: string, personaId: string): DayState {
  const bucket = personaState(state, personaId);
  if (!bucket.days[date]) bucket.days[date] = { blocks: {}, overrides: {} };
  const day = bucket.days[date];
  if (!day.blocks) day.blocks = {};
  if (!day.overrides) day.overrides = {};
  return day;
}

export function prune(state: State, personaId: string, keepDays = 45): void {
  const bucket = personaState(state, personaId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffKey = dateKey(cutoff);
  for (const date of Object.keys(bucket.days)) {
    if (date < cutoffKey) delete bucket.days[date];
  }
  bucket.recent = bucket.recent.filter((item) => item.date >= cutoffKey);
}

export function recentIds(state: State, avoidDays: number, today = dateKey(), personaId = 'whale'): Set<string> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - avoidDays);
  const cutoffKey = dateKey(cutoff);
  const ids = new Set<string>();
  for (const item of personaState(state, personaId).recent) {
    if (item.date >= cutoffKey && item.date <= today) ids.add(item.id);
  }
  return ids;
}
