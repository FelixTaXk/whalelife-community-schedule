/*! 衣柜业务层：工具和页面共用。 */

import { loadCatalog, reloadCatalog, thumbUrl, type Catalog, type Outfit } from './catalog.ts';
import { normalizeConfig, readConfig, type WardrobeConfig } from './config.ts';
import { audienceFor, type Audience } from './policy.ts';
import { effectiveScene, ensureDay, isSpecialScene, itemAllowed, pickMany, pickOutfit, scoreOutfit } from './picker.ts';
import { blockAt, blockById, blockLabel, dateKey, minuteOfDay, readPlan, sceneForBlock, seasonBand, weatherFlags, type Plan, type PlanItem } from './plan.ts';
import { personaState, readState, saveState, prune, recentIds, type DayState, type State } from './state.ts';

export type Snapshot = {
  date: string;
  plan: Plan | null;
  state: State;
  day: DayState | null;
  block: PlanItem | null;
  moment: 'now' | 'next' | 'idle';
  outfit: Outfit | null;
  next: { block: PlanItem; outfit: Outfit | null } | null;
  config: WardrobeConfig;
  catalog: Catalog;
  audience: Audience;
};

export function outfitLine(outfit: Outfit | null): string {
  if (!outfit) return '还没配';
  return outfit.name;
}

export function outfitView(outfit: Outfit | null) {
  if (!outfit) return null;
  return {
    id: outfit.id,
    name: outfit.name,
    season: outfit.season,
    tier: outfit.tier,
    scenes: outfit.scenes,
    thumb: thumbUrl(outfit.id, 'thumb'),
    preview: thumbUrl(outfit.id, 'preview'),
    keywords: outfit.zh,
  };
}

async function loadDay(ctx: any, date: string, personaId?: string) {
  const config = await readConfig(ctx);
  const audience = await audienceFor(ctx, personaId);
  const catalog = loadCatalog();
  const plan = readPlan(date);
  const state = await readState(ctx, audience.id);
  if (!plan) return { config, audience, catalog, plan: null, state, day: null };
  const { day, changed } = ensureDay(plan, catalog.items, state, config.avoidDays, audience.id, audience.adult);
  if (changed) {
    prune(state, audience.id);
    await saveState(ctx, state);
  }
  return { config, audience, catalog, plan, state, day };
}

function outfitForDisplay(byId: Map<string, Outfit>, id: string, scene: string, adult: boolean): Outfit | null {
  const item = id ? byId.get(id) : null;
  if (!item) return null;
  return itemAllowed(item, scene, adult) ? item : null;
}

export async function snapshot(ctx: any, date = dateKey(), minutes = minuteOfDay(), personaId?: string): Promise<Snapshot> {
  const loaded = await loadDay(ctx, date, personaId);
  const { config, audience, catalog, plan, state, day } = loaded;
  const base: Snapshot = { date, plan, state, day, block: null, moment: 'idle', outfit: null, next: null, config, catalog, audience };
  if (!plan || !day) return base;

  const hit = blockAt(plan, minutes);
  if (hit) {
    const id = day.overrides[hit.block.id] || day.blocks[hit.block.id] || '';
    const scene = sceneForBlock(hit.block, minutes);
    base.block = hit.block;
    base.moment = hit.state;
    base.outfit = outfitForDisplay(catalog.byId, id, scene, audience.adult)
      ?? pickOutfit(catalog.items, {
        plan,
        seasons: seasonBand(plan.weather),
        scene,
        adult: audience.adult,
        recent: recentIds(state, config.avoidDays, date, audience.id),
      });
  }

  const items = plan.items ?? [];
  const nextBlock = hit ? items.find((item) => item.start > hit.block.start) : items.find((item) => Number(item.start.slice(0, 2)) * 60 >= minutes);
  if (nextBlock) {
    const id = day.overrides[nextBlock.id] || day.blocks[nextBlock.id] || '';
    base.next = { block: nextBlock, outfit: outfitForDisplay(catalog.byId, id, sceneForBlock(nextBlock), audience.adult) };
  }
  return base;
}

export async function ensureToday(ctx: any, date = dateKey(), personaId?: string) {
  const snap = await snapshot(ctx, date, minuteOfDay(), personaId);
  return snap;
}

export async function currentOutfit(ctx: any, date = dateKey(), personaId?: string) {
  const snap = await snapshot(ctx, date, minuteOfDay(), personaId);
  return { ...snap, line: outfitLine(snap.outfit), blockLabel: snap.block ? blockLabel(snap.block) : '' };
}

export async function todayView(ctx: any, date = dateKey(), personaId?: string) {
  const snap = await snapshot(ctx, date, minuteOfDay(), personaId);
  const audience = {
    id: snap.audience.id,
    name: snap.audience.name,
    age: snap.audience.age,
    adult: snap.audience.adult,
    threshold: snap.audience.threshold,
  };
  if (!snap.plan || !snap.day) {
    return { date, missing: true, weather: null, items: [] as any[], note: '这天还没有日程，先在日程里排一排。', persona: audience };
  }
  const blocks = [...snap.plan.items].sort((a, b) => a.start.localeCompare(b.start)).map((block) => {
    const id = snap.day!.overrides[block.id] || snap.day!.blocks[block.id] || '';
    const scene = sceneForBlock(block);
    const outfit = outfitForDisplay(snap.catalog.byId, id, scene, snap.audience.adult);
    return {
      id: block.id,
      time: `${block.start}–${block.end}`,
      title: block.title,
      kind: block.kind,
      place: block.place ?? '',
      scene,
      isNow: snap.block?.id === block.id && snap.moment === 'now',
      outfit: outfitView(outfit),
    };
  });
  return {
    date,
    weather: snap.plan.weather ?? null,
    weatherFlags: weatherFlags(snap.plan.weather),
    tone: snap.plan.tone ?? '',
    note: snap.plan.note ?? '',
    persona: audience,
    now: snap.block ? { id: snap.block.id, time: `${snap.block.start}–${snap.block.end}`, title: snap.block.title, state: snap.moment, outfit: outfitView(snap.outfit) } : null,
    next: snap.next ? { id: snap.next.block.id, time: `${snap.next.block.start}–${snap.next.block.end}`, title: snap.next.block.title, outfit: outfitView(snap.next.outfit) } : null,
    items: blocks,
    missing: false,
  };
}

export async function wardrobeFor(ctx: any, opts: { date?: string; blockId?: string; time?: string; personaId?: string }) {
  const date = opts.date || dateKey();
  const loaded = await loadDay(ctx, date, opts.personaId);
  if (!loaded.plan || !loaded.day) return { date, found: false, reason: '这天还没有日程。' };
  const { plan, day, catalog, config, state, audience } = loaded;
  let block: PlanItem | null = null;
  if (opts.blockId) block = blockById(plan, opts.blockId);
  else if (opts.time) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(opts.time.trim());
    if (!match) return { date, found: false, reason: '时间要写成 HH:MM。' };
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    const hit = blockAt(plan, minutes);
    block = hit?.block ?? null;
  } else {
    block = blockAt(plan)?.block ?? null;
  }
  if (!block) return { date, found: false, reason: '这个时间没有对应的日程段。' };
  const scene = sceneForBlock(block);
  const id = day.overrides[block.id] || day.blocks[block.id] || '';
  const outfit = outfitForDisplay(catalog.byId, id, scene, audience.adult)
    ?? pickOutfit(catalog.items, {
      plan,
      seasons: seasonBand(plan.weather),
      scene,
      adult: audience.adult,
      recent: recentIds(state, config.avoidDays, date, audience.id),
    });
  return {
    date,
    found: true,
    persona: { id: audience.id, name: audience.name, age: audience.age, adult: audience.adult },
    block: { id: block.id, time: `${block.start}–${block.end}`, title: block.title, place: block.place ?? '', kind: block.kind },
    scene,
    weather: plan.weather ?? null,
    outfit: outfitView(outfit),
    line: outfitLine(outfit),
  };
}

export async function wardrobePick(ctx: any, opts: { scene?: string; season?: string; keyword?: string; count?: number; date?: string; personaId?: string }) {
  const catalog = loadCatalog();
  const config = await readConfig(ctx);
  const audience = await audienceFor(ctx, opts.personaId);
  const date = opts.date || dateKey();
  const plan = readPlan(date);
  const seasons = opts.season ? [opts.season] : seasonBand(plan?.weather);
  const requested = opts.scene || 'daily';
  const scene = effectiveScene(requested, audience.adult);
  const count = Math.min(12, Math.max(1, Number(opts.count) || 5));
  const recent = recentIds(await readState(ctx, audience.id), config.avoidDays, date, audience.id);
  const items = catalog.items;
  const available = items.filter((item) => itemAllowed(item, requested, audience.adult)).length;
  const picked = pickMany(items, { plan, seasons, scene: requested, adult: audience.adult, keyword: opts.keyword, recent }, count);
  const note = !audience.adult && requested !== scene
    ? `当前人格${audience.age !== null ? ` ${audience.age} 岁` : ''}未满 ${audience.threshold} 岁，${requested} 场景不匹配成人分类，已按 ${scene} 挑日常款。`
    : '';
  return {
    date,
    scene,
    requestedScene: requested,
    seasons,
    keyword: opts.keyword ?? '',
    weather: plan?.weather ?? null,
    persona: { id: audience.id, name: audience.name, age: audience.age, adult: audience.adult },
    count: picked.length,
    library: items.length,
    available,
    note,
    items: picked.map((item) => ({
      ...outfitView(item),
      score: Math.round(scoreOutfit(item, { plan, seasons, scene: requested, adult: audience.adult, keyword: opts.keyword, recent })),
    })),
  };
}

export async function wear(ctx: any, opts: { date?: string; blockId?: string; id?: string; reroll?: boolean; scene?: string; personaId?: string }) {
  const date = opts.date || dateKey();
  const loaded = await loadDay(ctx, date, opts.personaId);
  if (!loaded.plan || !loaded.day) return { ok: false, reason: '这天还没有日程，先排日程再换装。' };
  const { plan, day, catalog, config, state, audience } = loaded;

  let block = opts.blockId ? blockById(plan, opts.blockId) : null;
  if (!block) {
    const hit = blockAt(plan);
    block = hit?.block ?? null;
  }
  if (!block) return { ok: false, reason: '这个时间没有对应的日程段。' };

  const scene = opts.scene || sceneForBlock(block);
  const previous = day.overrides[block.id] || day.blocks[block.id] || '';
  let chosen: Outfit | null = null;
  if (opts.id) {
    chosen = catalog.byId.get(opts.id) ?? null;
    if (!chosen) return { ok: false, reason: `服装库里没有 ${opts.id}。` };
    if (!itemAllowed(chosen, scene, audience.adult)) {
      return { ok: false, reason: `这套是 ${chosen.tier} 分级，当前人格${audience.age !== null ? ` ${audience.age} 岁` : ''}或这个场景不能穿。` };
    }
  } else {
    const recent = recentIds(state, config.avoidDays, date, audience.id);
    const used = new Set<string>([previous, ...Object.values(day.blocks)]);
    chosen = pickOutfit(catalog.items, {
      plan,
      seasons: seasonBand(plan.weather),
      scene,
      adult: audience.adult,
      recent,
      used,
    });
  }
  if (!chosen) return { ok: false, reason: '没挑到合适的，可能服装库还没导入。' };

  // 手动换主穿搭/某类特殊穿搭时，整组一起换，避免离开再回来又穿回旧那套。
  if (!opts.id) {
    if (isSpecialScene(scene)) {
      if (!day.specials) day.specials = {};
      day.specials[scene] = chosen.id;
      for (const item of plan.items ?? []) {
        if (sceneForBlock(item) !== scene) continue;
        day.blocks[item.id] = chosen.id;
        delete day.overrides[item.id];
      }
    } else {
      day.base = chosen.id;
      for (const item of plan.items ?? []) {
        if (isSpecialScene(sceneForBlock(item))) continue;
        day.blocks[item.id] = chosen.id;
        delete day.overrides[item.id];
      }
    }
  }

  day.overrides[block.id] = chosen.id;
  const bucket = personaState(state, audience.id);
  bucket.recent = bucket.recent.filter((entry) => !(entry.date === date && entry.id === previous));
  bucket.recent.push({ id: chosen.id, date });
  bucket.recent = bucket.recent.slice(-120);
  await saveState(ctx, state);

  return {
    ok: true,
    date,
    persona: { id: audience.id, name: audience.name, age: audience.age, adult: audience.adult },
    replaced: previous || null,
    block: { id: block.id, time: `${block.start}–${block.end}`, title: block.title },
    scene,
    outfit: outfitView(chosen),
    line: `换好了：${chosen.name}`,
  };
}

export async function reroll(ctx: any, body: { date?: string; blockId?: string; personaId?: string }, type = 'settings') {
  return wear(ctx, { date: body.date, blockId: body.blockId, reroll: true, personaId: body.personaId });
}

export async function saveConfig(ctx: any, patch: any) {
  const current = await readConfig(ctx);
  const next = normalizeConfig({ ...current, ...patch });
  const saved = await ctx.config.save('config.json', next);
  return saved ?? next;
}

export async function importLibrary(ctx: any, root?: string) {
  const config = await readConfig(ctx);
  const env = root ? { COSTUME_LIBRARY: root } : undefined;
  const { spawn } = await import('node:child_process');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const DIR = dirname(fileURLToPath(import.meta.url));
  const script = resolve(DIR, '..', 'scripts', 'import-costume.mjs');
  const target = root || config.libraryRoot || 'D:/ComfyUI/custom_nodes/comfyui-costume-gallery/library';

  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [script, target], { env: { ...process.env, ...(env ?? {}) } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => done({ code: code ?? 0, stdout, stderr }));
    child.on('error', (error) => done({ code: 1, stdout, stderr: String(error) }));
  });

  reloadCatalog();
  let parsed: any = null;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    parsed = null;
  }
  return { ok: result.code === 0, target, ...result, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
}

export async function stats(ctx: any) {
  const catalog = loadCatalog();
  const config = await readConfig(ctx);
  const scenes: Record<string, number> = {};
  const tiers: Record<string, number> = {};
  for (const item of catalog.items) {
    for (const scene of item.scenes) scenes[scene] = (scenes[scene] ?? 0) + 1;
    tiers[item.tier] = (tiers[item.tier] ?? 0) + 1;
  }
  return {
    outfits: catalog.items.length,
    scenes,
    tiers,
    report: catalog.report,
    config,
  };
}


