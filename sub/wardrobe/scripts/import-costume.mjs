// 从服装库全量导入，按分类打 tier，供不同人格按年龄/场景取用。
// 用法：node scripts/import-costume.mjs [libraryRoot]
// 源目录优先级：命令行 > COSTUME_LIBRARY > 插件内置 library/
// 分类映射：COSTUME_CATEGORY_MAP（JSON 字符串，来自插件配置）> 下面这份默认映射
// 只读服装库，不改原图；生成 data/catalog.json + data/import-report.json。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(DIR, '..');
const ROOT = resolve(process.argv[2] || process.env.COSTUME_LIBRARY || join(PLUGIN, 'library'));

// 服装库只有分类，没有逐套 level/rating。这里把分类翻译成 tier：
// general 日常四季，private 私密居家，swim 泳装，party 派对/晚宴礼服。
// 家居服四季是衣柜自己补的类目（HOM-*），只给 home/sleep 场景，不进日常。
const DEFAULT_CATEGORY_META = {
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

const SEASONS = ['spring', 'summer', 'autumn', 'winter', 'all'];
const TIERS = ['general', 'private', 'swim', 'party'];

function readCategoryMap() {
  const raw = String(process.env.COSTUME_CATEGORY_MAP ?? '').trim();
  if (!raw) return DEFAULT_CATEGORY_META;
  try {
    const parsed = JSON.parse(raw);
    const map = {};
    for (const [name, value] of Object.entries(parsed ?? {})) {
      if (!value || typeof value !== 'object') continue;
      if (!SEASONS.includes(value.season) || !TIERS.includes(value.tier)) continue;
      const scenes = Array.isArray(value.scenes) ? value.scenes.map(String).filter(Boolean) : undefined;
      const gender = ['female', 'male', 'unisex'].includes(value.gender) ? value.gender : undefined;
      map[String(name)] = {
        season: value.season,
        tier: value.tier,
        ...(scenes?.length ? { scenes } : {}),
        ...(gender ? { gender } : {}),
      };
    }
    return Object.keys(map).length ? map : DEFAULT_CATEGORY_META;
  } catch {
    console.error('COSTUME_CATEGORY_MAP 不是合法 JSON，改用默认映射');
    return DEFAULT_CATEGORY_META;
  }
}

const CATEGORY_META = readCategoryMap();

function tagScenes(kw) {
  const scenes = ['daily'];
  const has = (w) => kw.includes(w);
  if (has('百褶') || has('乐福鞋') || (has('衬衫') && has('半身裙'))) scenes.push('school');
  if (has('运动鞋') && (has('长裤') || has('牛仔裤')) && !has('连衣裙') && !has('半身裙')) scenes.push('active');
  if ((has('开衫') || has('针织') || has('毛绒')) && !has('大衣') && !has('夹克')) scenes.push('cozy');
  if (has('大衣') || has('夹克')) scenes.push('outer');
  if (has('连衣裙')) scenes.push('dress');
  if (has('半身裙')) scenes.push('skirt');
  if (has('长裤') || has('牛仔裤')) scenes.push('pants');
  return scenes;
}

function displayName(kw, category) {
  const keep = kw.filter((w) => !['包', '项链', '耳环', '手链', '戒指'].includes(w));
  return keep.slice(0, 6).join(' · ') || category;
}

/** 插件内的路径存相对形式，避免把本机盘符写进索引和页面。 */
function libraryLabel(root) {
  const rel = relative(PLUGIN, root).replaceAll('\\', '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : root;
}

const sourceFile = join(ROOT, 'data', 'costume-zh.json');
if (!existsSync(sourceFile)) {
  console.error('找不到服装库数据：' + sourceFile + '（先填服装库根目录，或把服装库放进插件的 library/）');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(sourceFile, 'utf8'));
const items = [];
const dropped = { category: {} };

for (const row of raw) {
  const category = String(row['分类'] || row.category || '');
  const meta = CATEGORY_META[category];
  if (!meta) {
    dropped.category[category] = (dropped.category[category] || 0) + 1;
    continue;
  }
  const kw = Array.isArray(row['关键词']) ? row['关键词'].map(String) : Array.isArray(row.keywords) ? row.keywords.map(String) : [];
  const en = String(row['英文关键词'] || row.en || '').trim();
  items.push({
    id: String(row.id || ''),
    category,
    season: meta.season,
    tier: meta.tier,
    ...(meta.gender ? { gender: meta.gender } : {}),
    name: displayName(kw, category),
    zh: kw,
    en,
    scenes: meta.scenes ?? tagScenes(kw),
    rating: meta.tier === 'general' ? 'general' : 'adult',
    thumb: String(row['缩略图'] || row.thumb || ''),
    preview: String(row['预览图'] || row.preview || ''),
    source: /^HOM-/.test(String(row.id || '')) ? 'local-homewear' : 'costume-library',
  });
}

const sceneCounts = {};
for (const it of items) for (const s of it.scenes) sceneCounts[s] = (sceneCounts[s] || 0) + 1;
const seasonCounts = {};
for (const it of items) seasonCounts[it.season] = (seasonCounts[it.season] || 0) + 1;
const tierCounts = {};
for (const it of items) tierCounts[it.tier] = (tierCounts[it.tier] || 0) + 1;
const categoryCounts = {};
for (const it of items) categoryCounts[it.category] = (categoryCounts[it.category] || 0) + 1;
const genderCounts = {};
for (const it of items) {
  const gender = it.gender || 'female';
  genderCounts[gender] = (genderCounts[gender] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  library: libraryLabel(ROOT),
  source: libraryLabel(sourceFile),
  sourceTotal: raw.length,
  kept: items.length,
  dropped,
  gradingNote: 'library has category-level grouping only; tier is derived from category, not per-item rating',
  tiers: tierCounts,
  categories: categoryCounts,
  scenes: sceneCounts,
  seasons: seasonCounts,
  genders: genderCounts,
};
mkdirSync(join(PLUGIN, 'data'), { recursive: true });
const catalogJson = JSON.stringify({ version: 2, items, report });
writeFileSync(join(PLUGIN, 'data', 'catalog.json'), catalogJson, 'utf8');
writeFileSync(join(PLUGIN, 'data', 'import-report.json'), JSON.stringify(report, null, 2), 'utf8');
// 商城包只保留 library/，根级 data/ 会被打包器排除；内置库导入时同时写一份 library/catalog.json 兜底。
if (resolve(ROOT) === resolve(join(PLUGIN, 'library'))) {
  mkdirSync(join(PLUGIN, 'library'), { recursive: true });
  writeFileSync(join(PLUGIN, 'library', 'catalog.json'), catalogJson, 'utf8');
}
console.log(JSON.stringify({ kept: items.length, tiers: tierCounts, categories: categoryCounts }));
