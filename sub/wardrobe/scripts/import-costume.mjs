// 从 ComfyUI 服装库全量导入，按分类打 tier，供不同人格按年龄/场景取用。
// 用法：node scripts/import-costume.mjs [libraryRoot]
// 只读服装库，不改原图；生成 data/catalog.json + data/import-report.json。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(DIR, '..');
const ROOT = resolve(
  process.argv[2] || process.env.COSTUME_LIBRARY || 'D:/ComfyUI/custom_nodes/comfyui-costume-gallery/library',
);

// 服装库只有分类，没有逐套 level/rating。这里把分类翻译成 tier：
// general 日常四季，private 私密居家，swim 泳装，party 派对/晚宴礼服。
const CATEGORY_META = {
  春装: { season: 'spring', tier: 'general' },
  夏装: { season: 'summer', tier: 'general' },
  秋装: { season: 'autumn', tier: 'general' },
  冬装: { season: 'winter', tier: 'general' },
  内衣: { season: 'all', tier: 'private', scenes: ['home'] },
  性感: { season: 'all', tier: 'private', scenes: ['home'] },
  泳装: { season: 'summer', tier: 'swim', scenes: ['swim'] },
  派对: { season: 'all', tier: 'party', scenes: ['party', 'dress'] },
};

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

const sourceFile = join(ROOT, 'data', 'costume-zh.json');
if (!existsSync(sourceFile)) {
  console.error('找不到服装库数据：' + sourceFile);
  process.exit(1);
}
const raw = JSON.parse(readFileSync(sourceFile, 'utf8'));
const items = [];
const dropped = { category: {} };

for (const row of raw) {
  const category = String(row['分类'] || '');
  const meta = CATEGORY_META[category];
  if (!meta) {
    dropped.category[category] = (dropped.category[category] || 0) + 1;
    continue;
  }
  const kw = Array.isArray(row['关键词']) ? row['关键词'].map(String) : [];
  const en = String(row['英文关键词'] || '').trim();
  items.push({
    id: String(row.id || ''),
    category,
    season: meta.season,
    tier: meta.tier,
    name: displayName(kw, category),
    zh: kw,
    en,
    scenes: meta.scenes ?? tagScenes(kw),
    rating: meta.tier === 'general' ? 'general' : 'adult',
    thumb: String(row['缩略图'] || ''),
    preview: String(row['预览图'] || ''),
    source: 'comfyui-costume-gallery',
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

const report = {
  generatedAt: new Date().toISOString(),
  library: ROOT,
  source: sourceFile,
  sourceTotal: raw.length,
  kept: items.length,
  dropped,
  gradingNote: 'library has category-level grouping only; tier is derived from category, not per-item rating',
  tiers: tierCounts,
  categories: categoryCounts,
  scenes: sceneCounts,
  seasons: seasonCounts,
};
mkdirSync(join(PLUGIN, 'data'), { recursive: true });
writeFileSync(join(PLUGIN, 'data', 'catalog.json'), JSON.stringify({ version: 2, items, report }), 'utf8');
writeFileSync(join(PLUGIN, 'data', 'import-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ kept: items.length, tiers: tierCounts, categories: categoryCounts }));
