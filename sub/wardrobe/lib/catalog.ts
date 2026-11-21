/*! 服装库读取与缩略图路径。 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = resolve(DIR, '..', 'data', 'catalog.json');

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
    file = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'));
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
  const raw = String(config?.libraryRoot ?? '').trim();
  return resolve(raw || 'D:/ComfyUI/custom_nodes/comfyui-costume-gallery/library');
}

export function imagePath(root: string, item: Outfit, size: 'thumb' | 'preview'): string | null {
  const rel = size === 'preview' ? item.preview : item.thumb;
  if (!rel) return null;
  const full = resolve(root, rel);
  if (!full.startsWith(root)) return null;
  return existsSync(full) ? full : null;
}

export function thumbUrl(id: string, size: 'thumb' | 'preview' = 'thumb') {
  return `/plugins/schedule/wardrobe/thumb?id=${encodeURIComponent(id)}&size=${size}`;
}
