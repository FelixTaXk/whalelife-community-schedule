/*! 衣柜业务层：工具和页面共用。 */

import { loadCatalog, reloadCatalog, thumbUrl, imagePath, remoteAssetUrl, type Catalog, type Outfit } from './catalog.ts';
import { normalizeConfig, readConfig, type WardrobeConfig } from './config.ts';
import { audienceFor, type Audience } from './policy.ts';
import { effectiveScene, ensureDay, isSpecialScene, itemAllowed, pickMany, pickOutfit, scoreOutfit } from './picker.ts';
import { blockAt, blockById, blockLabel, dateKey, minuteOfDay, planSeasons, readPlan, sceneForBlock, weatherFlags, weatherSourceLabel, type Plan, type PlanItem } from './plan.ts';
import { displayPath, libraryReady, resolveLibraryRoot, resolveUserPath } from './paths.ts';
import { feedbackFor, personaState, readState, saveState, prune, recentIds, type DayState, type Feedback, type State } from './state.ts';
import { piecesOf, composePieces } from './pieces.ts';

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
  locked: boolean;
  feedback: Feedback;
};

export function outfitLine(outfit: Outfit | null): string {
  if (!outfit) return '还没配';
  return outfit.name;
}

export function outfitView(outfit: Outfit | null) {
  if (!outfit) return null;
  const pieces = piecesOf(outfit);
  return {
    id: outfit.id,
    name: outfit.name,
    season: outfit.season,
    tier: outfit.tier,
    scenes: outfit.scenes,
    thumb: thumbUrl(outfit.id, 'thumb'),
    preview: thumbUrl(outfit.id, 'preview'),
    keywords: outfit.zh,
    gender: outfit.gender ?? 'female',
    pieces: pieces.pieces,
    palette: pieces.palette,
  };
}

async function loadDay(ctx: any, date: string, personaId?: string) {
  const config = await readConfig(ctx);
  const audience = await audienceFor(ctx, personaId);
  const catalog = loadCatalog();
  const plan = readPlan(date);
  const state = await readState(ctx, audience.id);
  if (!plan) return { config, audience, catalog, plan: null, state, day: null };
  const feedback = feedbackFor(state, audience.id);
  const { day, changed } = ensureDay(plan, catalog.items, state, config.avoidDays, audience.id, audience.adult, feedback, audience.gender);
  if (changed) {
    prune(state, audience.id);
    await saveState(ctx, state);
  }
  return { config, audience, catalog, plan, state, day };
}

function outfitForDisplay(byId: Map<string, Outfit>, id: string, scene: string, adult: boolean, feedback?: Feedback): Outfit | null {
  const item = id ? byId.get(id) : null;
  if (!item) return null;
  if (feedback?.never.includes(item.id)) return null;
  return itemAllowed(item, scene, adult) ? item : null;
}

export async function snapshot(ctx: any, date = dateKey(), minutes = minuteOfDay(), personaId?: string): Promise<Snapshot> {
  const loaded = await loadDay(ctx, date, personaId);
  const { config, audience, catalog, plan, state, day } = loaded;
  const feedback = feedbackFor(state, audience.id);
  const base: Snapshot = { date, plan, state, day, block: null, moment: 'idle', outfit: null, next: null, config, catalog, audience, locked: Boolean(day?.locked), feedback };
  if (!plan || !day) return base;

  const hit = blockAt(plan, minutes);
  if (hit) {
    const id = day.overrides[hit.block.id] || day.blocks[hit.block.id] || '';
    const scene = sceneForBlock(hit.block, minutes);
    base.block = hit.block;
    base.moment = hit.state;
    base.outfit = outfitForDisplay(catalog.byId, id, scene, audience.adult, feedback)
      ?? pickOutfit(catalog.items, {
        plan,
        seasons: planSeasons(plan),
        scene,
        adult: audience.adult,
        gender: audience.gender,
        recent: recentIds(state, config.avoidDays, date, audience.id),
        feedback,
      });
  }

  const items = plan.items ?? [];
  const nextBlock = hit ? items.find((item) => item.start > hit.block.start) : items.find((item) => Number(item.start.slice(0, 2)) * 60 >= minutes);
  if (nextBlock) {
    const id = day.overrides[nextBlock.id] || day.blocks[nextBlock.id] || '';
    base.next = { block: nextBlock, outfit: outfitForDisplay(catalog.byId, id, sceneForBlock(nextBlock), audience.adult, feedback) };
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
    gender: snap.audience.gender,
  };
  if (!snap.plan || !snap.day) {
    return { date, missing: true, weather: null, weatherSource: 'month', weatherSourceLabel: '按月份', items: [] as any[], note: '这天还没有日程，先在日程里排一排。', persona: audience, locked: false };
  }
  const blocks = [...snap.plan.items].sort((a, b) => a.start.localeCompare(b.start)).map((block) => {
    const id = snap.day!.overrides[block.id] || snap.day!.blocks[block.id] || '';
    const scene = sceneForBlock(block);
    const outfit = outfitForDisplay(snap.catalog.byId, id, scene, snap.audience.adult, snap.feedback);
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
    weatherSource: snap.plan.weatherSource ?? 'month',
    weatherSourceLabel: weatherSourceLabel(snap.plan.weatherSource),
    weatherStaleHours: snap.plan.weatherStaleHours ?? null,
    tone: snap.plan.tone ?? '',
    note: snap.plan.note ?? '',
    persona: audience,
    locked: Boolean(snap.day.locked),
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
  const feedback = feedbackFor(state, audience.id);
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
  const outfit = outfitForDisplay(catalog.byId, id, scene, audience.adult, feedback)
    ?? pickOutfit(catalog.items, {
      plan,
      seasons: planSeasons(plan),
      scene,
      adult: audience.adult,
      gender: audience.gender,
      recent: recentIds(state, config.avoidDays, date, audience.id),
      feedback,
    });
  return {
    date,
    found: true,
    persona: { id: audience.id, name: audience.name, age: audience.age, adult: audience.adult, gender: audience.gender },
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
  const seasons = opts.season ? [opts.season] : planSeasons(plan);
  const requested = opts.scene || 'daily';
  const scene = effectiveScene(requested, audience.adult);
  const count = Math.min(12, Math.max(1, Number(opts.count) || 5));
  const state = await readState(ctx, audience.id);
  const feedback = feedbackFor(state, audience.id);
  const recent = recentIds(state, config.avoidDays, date, audience.id);
  const items = catalog.items;
  const available = items.filter((item) => itemAllowed(item, requested, audience.adult)).length;
  const picked = pickMany(items, { plan, seasons, scene: requested, adult: audience.adult, gender: audience.gender, keyword: opts.keyword, recent, feedback }, count);
  const note = !audience.adult && requested !== scene
    ? `当前人格${audience.age !== null ? ` ${audience.age} 岁` : ''}未满 ${audience.threshold} 岁，${requested} 场景不匹配成人分类，已按 ${scene} 挑日常款。`
    : audience.gender === 'male' && !items.some((item) => item.gender === 'male' || item.gender === 'unisex')
      ? '当前服装库没有男装/中性款，已回落到现有库；男性人格请导入男装库或关闭穿搭注入。'
      : '';
  return {
    date,
    scene,
    requestedScene: requested,
    seasons,
    keyword: opts.keyword ?? '',
    weather: plan?.weather ?? null,
    weatherSource: plan?.weatherSource ?? 'month',
    weatherSourceLabel: weatherSourceLabel(plan?.weatherSource),
    persona: { id: audience.id, name: audience.name, age: audience.age, adult: audience.adult, gender: audience.gender },
    count: picked.length,
    library: items.length,
    available,
    note,
    items: picked.map((item) => ({
      ...outfitView(item),
      score: Math.round(scoreOutfit(item, { plan, seasons, scene: requested, adult: audience.adult, gender: audience.gender, keyword: opts.keyword, recent, feedback })),
    })),
  };
}

export async function wear(ctx: any, opts: { date?: string; blockId?: string; id?: string; reroll?: boolean; scene?: string; personaId?: string }) {
  const date = opts.date || dateKey();
  const loaded = await loadDay(ctx, date, opts.personaId);
  if (!loaded.plan || !loaded.day) return { ok: false, reason: '这天还没有日程，先排日程再换装。' };
  const { plan, day, catalog, config, state, audience } = loaded;
  const feedback = feedbackFor(state, audience.id);

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
    if (feedback.never.includes(chosen.id)) return { ok: false, reason: '这套已被当前人格标记为不再出现。' };
    if (chosen.gender && chosen.gender !== 'unisex' && audience.gender && chosen.gender !== audience.gender) {
      return { ok: false, reason: '这套的性别分类和当前人格不一致。' };
    }
  } else {
    const recent = recentIds(state, config.avoidDays, date, audience.id);
    const used = new Set<string>([previous, ...Object.values(day.blocks)]);
    chosen = pickOutfit(catalog.items, {
      plan,
      seasons: planSeasons(plan),
      scene,
      adult: audience.adult,
      gender: audience.gender,
      recent,
      used,
      feedback,
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
    persona: { id: audience.id, name: audience.name, age: audience.age, adult: audience.adult, gender: audience.gender },
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

/** 给某一段生成 3–5 套备选，带分数和一句理由，方便用户自己拍板。 */
export async function alternatives(ctx: any, opts: { date?: string; blockId?: string; count?: number; personaId?: string }) {
  const date = opts.date || dateKey();
  const loaded = await loadDay(ctx, date, opts.personaId);
  if (!loaded.plan || !loaded.day) return { date, found: false, reason: '这天还没有日程。', items: [] as any[] };
  const { plan, day, catalog, config, state, audience } = loaded;
  const feedback = feedbackFor(state, audience.id);
  const block = opts.blockId ? blockById(plan, opts.blockId) : (blockAt(plan)?.block ?? null);
  if (!block) return { date, found: false, reason: '这个时间没有对应的日程段。', items: [] as any[] };
  const scene = sceneForBlock(block);
  const current = day.overrides[block.id] || day.blocks[block.id] || '';
  const count = Math.min(8, Math.max(1, Number(opts.count) || 3));
  const seasons = planSeasons(plan);
  const recent = recentIds(state, config.avoidDays, date, audience.id);
  const picked = pickMany(catalog.items, { plan, seasons, scene, adult: audience.adult, gender: audience.gender, recent, feedback }, count + 3)
    .filter((item) => item.id !== current)
    .slice(0, count);
  return {
    date,
    found: true,
    block: { id: block.id, time: `${block.start}–${block.end}`, title: block.title, place: block.place ?? '' },
    scene,
    current: current ? outfitView(catalog.byId.get(current) ?? null) : null,
    items: picked.map((item) => ({
      ...outfitView(item),
      score: Math.round(scoreOutfit(item, { plan, seasons, scene, adult: audience.adult, gender: audience.gender, recent, feedback })),
      reason: [
        item.season === 'all' ? '四季可用' : seasons.includes(item.season) ? '当季' : '换季备用',
        item.scenes.includes(effectiveScene(scene, audience.adult)) ? '场景匹配' : '场景备选',
        weatherFlags(plan.weather).rainy && item.scenes.includes('outer') ? '雨天有外套' : '',
      ].filter(Boolean).join(' · '),
    })),
  };
}

/** 锁定/解锁某天：锁定后日程和天气变化不自动改衣，手动换装仍然有效。 */
export async function setLocked(ctx: any, opts: { date?: string; locked?: boolean; personaId?: string }) {
  const date = opts.date || dateKey();
  const loaded = await loadDay(ctx, date, opts.personaId);
  if (!loaded.plan || !loaded.day) return { ok: false, reason: '这天还没有日程，先排日程再锁定。' };
  loaded.day.locked = Boolean(opts.locked);
  await saveState(ctx, loaded.state);
  return { ok: true, date, locked: loaded.day.locked, persona: { id: loaded.audience.id, name: loaded.audience.name } };
}

/** 喜欢/不喜欢/不再出现；只影响当前人格的打分，不写进服装库。 */
export async function setFeedback(ctx: any, opts: { id?: string; action?: string; date?: string; personaId?: string }) {
  const id = String(opts.id ?? '').trim();
  if (!id) return { ok: false, reason: '缺少服装 id。' };
  const loaded = await loadDay(ctx, opts.date || dateKey(), opts.personaId);
  if (!loadCatalog().byId.has(id)) return { ok: false, reason: `服装库里没有 ${id}。` };
  const bucket = personaState(loaded.state, loaded.audience.id);
  const action = String(opts.action ?? '');
  const feedback = bucket.feedback;
  for (const key of ['likes', 'dislikes', 'never'] as const) {
    feedback[key] = feedback[key].filter((item) => item !== id);
  }
  if (action === 'like') feedback.likes.push(id);
  else if (action === 'dislike') feedback.dislikes.push(id);
  else if (action === 'never') feedback.never.push(id);
  else if (action !== 'reset') return { ok: false, reason: '反馈动作只支持 like / dislike / never / reset。' };
  await saveState(ctx, loaded.state);
  return { ok: true, id, action, feedback: { likes: feedback.likes.length, dislikes: feedback.dislikes.length, never: feedback.never.length } };
}

function shiftDay(date: string, offset: number): string {
  const base = new Date(`${date}T00:00:00`);
  if (Number.isNaN(base.getTime())) return date;
  base.setDate(base.getDate() + offset);
  return dateKey(base);
}

/** 多日打包：按天收集主穿搭和特殊场景，统计可复用的套数。 */
export async function pack(ctx: any, opts: { start?: string; end?: string; personaId?: string }) {
  const start = opts.start || dateKey();
  const end = opts.end || start;
  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < 31; i += 1) {
    dates.push(cursor);
    if (cursor >= end) break;
    cursor = shiftDay(cursor, 1);
  }
  if (dates[dates.length - 1] !== end) return { ok: false, reason: '打包最多支持 31 天。' };
  const days: any[] = [];
  const unique = new Map<string, any>();
  for (const date of dates) {
    const loaded = await loadDay(ctx, date, opts.personaId);
    if (!loaded.plan || !loaded.day) continue;
    const base = loaded.day.base ? loaded.catalog.byId.get(loaded.day.base) ?? null : null;
    const specials = Object.fromEntries(Object.entries(loaded.day.specials ?? {}).map(([scene, id]) => [scene, outfitView(loaded.catalog.byId.get(id) ?? null)]));
    for (const outfit of [base, ...Object.values(loaded.day.specials ?? {}).map((id) => loaded.catalog.byId.get(id) ?? null)]) {
      if (outfit && !unique.has(outfit.id)) unique.set(outfit.id, outfitView(outfit));
    }
    days.push({
      date,
      weather: loaded.plan.weather ?? null,
      weatherSource: loaded.plan.weatherSource ?? 'month',
      base: outfitView(base),
      specials,
      locked: Boolean(loaded.day.locked),
    });
  }
  return {
    ok: true,
    start,
    end,
    days,
    outfits: [...unique.values()],
    uniqueOutfits: unique.size,
    note: '服装库是整套图；打包按整套复用统计，不拆分上下装。',
  };
}

/** 给画室出图用的参考图和提示词；图片地址走宿主插件路由或用户配置的 CDN。 */
export async function outfitReference(ctx: any, opts: { date?: string; blockId?: string; personaId?: string }) {
  const result = await wardrobeFor(ctx, opts);
  if (!result.found || !result.outfit) return { ok: false, reason: result.reason ?? '没找到这套衣服。' };
  const catalog = loadCatalog();
  const outfit = catalog.byId.get(result.outfit.id) ?? null;
  if (!outfit) return { ok: false, reason: '服装索引里没有这套。' };
  const config = await readConfig(ctx);
  const remote = remoteAssetUrl(config, outfit, 'preview');
  const localPath = remote ? '' : imagePath(resolveLibraryRoot(config), outfit, 'preview') ?? '';
  const imageUrl = remote || thumbUrl(outfit.id, 'preview');
  const keywords = outfit.en || outfit.zh.join(' ');
  return {
    ok: true,
    date: result.date,
    block: result.block,
    scene: result.scene,
    outfit: outfitView(outfit),
    imageUrl,
    referencePath: localPath,
    prompt: `wearing ${keywords}. ${result.line}`,
    keywords,
    note: localPath ? '本地参考图可直接交给画室；远程图源用 imageUrl。' : '远程图源用 imageUrl 交给画室。',
  };
}

/** 两套以上的关键词混搭：只生成提示词和参考图列表，不合成新图片。 */
export async function combine(ctx: any, opts: { ids?: string[]; personaId?: string }) {
  const ids = [...new Set((opts.ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))].slice(0, 4);
  if (ids.length < 2) return { ok: false, reason: '至少给两套服装 id。' };
  const catalog = loadCatalog();
  const items = ids.map((id) => catalog.byId.get(id)).filter((item): item is Outfit => Boolean(item));
  if (items.length !== ids.length) return { ok: false, reason: '有服装 id 不在当前服装索引里。' };
  const config = await readConfig(ctx);
  const merged = composePieces(items);
  const references = items.map((item) => {
    const remote = remoteAssetUrl(config, item, 'preview');
    const localPath = remote ? '' : imagePath(resolveLibraryRoot(config), item, 'preview') ?? '';
    return {
      id: item.id,
      name: item.name,
      imageUrl: remote || thumbUrl(item.id, 'preview'),
      referencePath: localPath,
      keywords: item.en || item.zh.join(' '),
    };
  });
  const detail = [
    merged.pieces.outer.length ? `outerwear ${merged.pieces.outer[0]}` : '',
    merged.pieces.top.length ? `top ${merged.pieces.top[0]}` : '',
    merged.pieces.bottom.length ? `bottom ${merged.pieces.bottom[0]}` : '',
    merged.pieces.shoes.length ? `shoes ${merged.pieces.shoes[0]}` : '',
    merged.pieces.accessory.length ? `accessory ${merged.pieces.accessory[0]}` : '',
  ].filter(Boolean).join('; ');
  const prompt = detail
    ? `wearing one outfit: ${detail}${merged.palette.length ? `; palette ${merged.palette.join(', ')}` : ''}.`
    : `wearing ${items.map((item) => item.en || item.zh.join(' ')).join(' + ')}.`;
  return {
    ok: true,
    ids,
    pieces: merged.pieces,
    palette: merged.palette,
    prompt,
    references,
    note: '服装库是整套图，混搭这里只给关键词和参考图，不合成新图；要出图请把 prompt 和 references 一起交给画室。',
  };
}

export async function saveConfig(ctx: any, patch: any) {
  const current = await readConfig(ctx);
  const next = normalizeConfig({ ...current, ...patch });
  const saved = await ctx.config.save('config.json', next);
  return saved ?? next;
}

export async function importLibrary(ctx: any, root?: string) {
  const config = await readConfig(ctx);
  const { spawn } = await import('node:child_process');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const DIR = dirname(fileURLToPath(import.meta.url));
  const script = resolve(DIR, '..', 'scripts', 'import-costume.mjs');
  const target = resolveUserPath(root) || resolveUserPath(config.importRoot) || resolveLibraryRoot(config);
  const categoryMap = JSON.stringify(config.categoryMap ?? {});
  // 导入器只吃文件，不直接读插件配置：分类映射和源目录都通过环境变量传进去。
  const env = { COSTUME_LIBRARY: target, COSTUME_CATEGORY_MAP: categoryMap };

  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, [script, target], { env: { ...process.env, ...env } });
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
  // 从外部库导入时，索引里的缩略图只存在于那个库，libraryRoot 跟着切过去，否则图全 404。
  let configSaved: WardrobeConfig | null = null;
  if (result.code === 0 && target !== resolveLibraryRoot(config)) {
    configSaved = await saveConfig(ctx, { libraryRoot: target });
  }
  return {
    ok: result.code === 0,
    target,
    targetLabel: displayPath(target),
    bundled: target === resolveLibraryRoot({ libraryRoot: '' }),
    configSaved,
    ...result,
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
  };
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
  const root = resolveLibraryRoot(config);
  return {
    outfits: catalog.items.length,
    scenes,
    tiers,
    report: catalog.report,
    config,
    libraryPath: displayPath(root),
    libraryBundled: root === resolveLibraryRoot({ libraryRoot: '' }),
    libraryReady: libraryReady(config),
    assetBaseUrl: config.assetBaseUrl,
    assetMode: (config.assetBaseUrl ? 'remote' : 'local') as 'remote' | 'local',
  };
}


