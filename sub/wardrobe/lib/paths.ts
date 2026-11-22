/*! 路径解析：内置服装库优先，配置可覆盖；所有本地路径都从这里出。 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
/** lib -> wardrobe */
export const PLUGIN_ROOT = resolve(DIR, '..');
/** 插件自带的一份服装库快照，开箱即用。 */
export const BUNDLED_LIBRARY = join(PLUGIN_ROOT, 'library');
export const LIBRARY_ENV = 'COSTUME_LIBRARY';

function fromEnv(): string {
  const value = String(process.env[LIBRARY_ENV] ?? '').trim();
  if (!value) return '';
  return isAbsolute(value) ? resolve(value) : resolve(PLUGIN_ROOT, value);
}

/** 用户填的库路径：绝对路径直接用，相对路径按插件目录解析。 */
export function resolveUserPath(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  return isAbsolute(value) ? resolve(value) : resolve(PLUGIN_ROOT, value);
}

/** 配置里的 libraryRoot 支持绝对路径，也支持相对插件目录；留空 = 内置库。 */
export function resolveLibraryRoot(config: any): string {
  const raw = String(config?.libraryRoot ?? '').trim();
  const env = fromEnv();
  if (env) return env;
  if (!raw) return BUNDLED_LIBRARY;
  return resolveUserPath(raw);
}

/** 给页面/工具看的短路径：在插件内就显示相对路径，避免把本机盘符带到界面。 */
export function displayPath(target: string): string {
  const rel = relative(PLUGIN_ROOT, resolve(target)).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : resolve(target);
}

export function libraryReady(config: any): boolean {
  const root = resolveLibraryRoot(config);
  return existsSync(join(root, 'data', 'costume-zh.json'));
}
