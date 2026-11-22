/*! 服装库读取与缩略图路径。 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLibraryRoot } from './paths.ts';
import type { OutfitGender } from './config.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(DIR, '..');
const CATALOG_FILES = [
  join(PLUGIN_ROOT, 'data', 'catalog.json'),
  join(PLUGIN_ROOT, 'library', 'catalog.json'),
  join(PLUGIN_ROOT, 'library', 'data', 'catalog.json'),
];

export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'all';

export type OutfitTier = 'general' | 'private' | 'swim' | 'party';

export type Outfit = {
  id: string;
  category: string;
  season: Season;
  name: string;
  zh: string[];
  en: string;
  scenes: string[];
  tier: OutfitTier;
  /** 不填按女装处理；男装/中性库在导入时写入。 */
  gender?: OutfitGender;
  rating?: 'general' | 'adult';
  thumb: string;
  preview: string;
  source: string;
};

export type Catalog = {
  items: Outfit[];
  byId: Map<string, Outfit>;
  report: any;
  loadedAt: string;
};

let cache: Catalog | null = null;

export function loadCatalog(force = false): Catalog {
  if (cache && !force) return cache;
  let file: any = { items: [], report: {} };
  try {
    const source = CATALOG_FILES.find((candidate) => existsSync(candidate));
    if (!source) throw Error('catalog missing');
    file = JSON.parse(readFileSync(source, 'utf8'));
  } catch {
    file = { items: [], report: { error: '还没导入服装库，先跑 scripts/import-costume.mjs' } };
  }
  const items: Outfit[] = Array.isArray(file.items) ? file.items : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  cache = { items, byId, report: file.report ?? {}, loadedAt: new Date().toISOString() };
  return cache;
}

export function reloadCatalog(): Catalog {
  return loadCatalog(true);
}

export function libraryRoot(config: any): string {
  return resolveLibraryRoot(config);
}

export function imagePath(root: string, item: Outfit, size: 'thumb' | 'preview'): string | null {
  const rel = size === 'preview' ? item.preview : item.thumb;
  if (!rel) return null;
  const full = resolve(root, rel);
  if (!full.startsWith(root)) return null;
  return existsSync(full) ? full : null;
}

/**
 * 云端图源：配置了 assetBaseUrl 就把非本地条目拼成 CDN 地址。
 * HOM-* 是本插件自己补的家居服，上游没有，继续走本地 library/。
 */
export function remoteAssetUrl(config: any, item: Outfit, size: 'thumb' | 'preview'): string | null {
  const base = String(config?.assetBaseUrl ?? '').trim();
  if (!base || item.source === 'local-homewear' || item.id.startsWith('HOM-')) return null;
  const rel = size === 'preview' ? item.preview : item.thumb;
  if (!rel) return null;
  if (/^https?:\/\//i.test(rel)) return rel;
  try {
    const root = base.endsWith('/') ? base : base + '/';
    return new URL(rel.replace(/^\/+/, ''), root).toString();
  } catch {
    return null;
  }
}

export function thumbUrl(id: string, size: 'thumb' | 'preview' = 'thumb') {
  return `/plugins/schedule/wardrobe/thumb?id=${encodeURIComponent(id)}&size=${size}&v=2`;
}
