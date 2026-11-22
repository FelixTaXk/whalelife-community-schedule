/*! 衣柜 · 页面与接口注册。 */

import { readFileSync } from 'node:fs';
import type { Context, PluginHandler } from '../../../../../core/context.ts';
import { loadCatalog, imagePath, libraryRoot, remoteAssetUrl, type Catalog } from './catalog.ts';
import { readConfig } from './config.ts';
import { listAudiences } from './policy.ts';
import { importLibrary, saveConfig, snapshot, stats, todayView, wardrobePick, wear, alternatives, setLocked, setFeedback, pack } from './service.ts';
import { wardrobeSettingsPage } from '../ui/settings.ts';

function sendJson(res: any, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendHtml(res: any, html: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

async function readJson(req: any, signal: AbortSignal): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw Error('请求体过大');
    chunks.push(buffer);
  }
  signal.throwIfAborted();
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type WardrobeWebOptions = { version: string };

export function registerWeb(ctx: Context, _catalog: Catalog, options: WardrobeWebOptions) {
  const base = '/plugins/schedule/wardrobe/';

  ctx.web.page(base + 'settings', async (req: any, res: any) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const personaId = url.searchParams.get('persona') ?? undefined;
      const [today, library, personas] = await Promise.all([
        todayView(ctx, undefined, personaId),
        stats(ctx),
        listAudiences(ctx),
      ]);
      sendHtml(res, wardrobeSettingsPage({ version: options.version, today, config: library.config, stats: library, personas }));
    } catch (error) {
      ctx.logger.warn('衣柜页面渲染失败', { error: errorText(error) });
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('衣柜页面加载失败，请稍后重试');
    }
  }, { title: '衣柜', settings: true });

  // 缩略图只从服装库根目录里读，不允许穿出去。
  // 页面里是 <img src> 的 GET 请求，必须用 page 注册 GET（不传 entry，不进侧栏）。
  ctx.web.page(base + 'thumb', async (req: any, res: any) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const id = url.searchParams.get('id') ?? '';
      const size = url.searchParams.get('size') === 'preview' ? 'preview' : 'thumb';
      const item = loadCatalog().byId.get(id);
      if (!item) {
        res.statusCode = 404;
        res.end('no such outfit');
        return;
      }
      const config = await readConfig(ctx);
      const remote = remoteAssetUrl(config, item, size);
      if (remote) {
        res.statusCode = 302;
        res.setHeader('Location', remote);
        res.setHeader('Cache-Control', 'public, max-age=600');
        res.end();
        return;
      }
      const file = imagePath(libraryRoot(config), item, size);
      if (!file) {
        res.statusCode = 404;
        res.end('image missing');
        return;
      }
      const body = readFileSync(file);
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(body);
    } catch (error) {
      res.statusCode = 500;
      res.end(errorText(error));
    }
  });

  ctx.web.api(base + 'data', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      const action = String(body?.action ?? 'read');

      if (action === 'read') {
        const personaId = typeof body?.personaId === 'string' ? body.personaId : undefined;
        const [today, library, snap, personas] = await Promise.all([
          todayView(ctx, body?.date, personaId),
          stats(ctx),
          snapshot(ctx, body?.date, undefined, personaId),
          listAudiences(ctx),
        ]);
        sendJson(res, 200, { ok: true, today, config: library.config, stats: library, personas, now: snap.outfit ? { id: snap.outfit.id, name: snap.outfit.name } : null });
        return;
      }

      if (action === 'save') {
        const raw = body?.config && typeof body.config === 'object' ? body.config : {};
        const assetBase = String(raw.assetBaseUrl ?? '').trim();
        if (assetBase && !/^https?:\/\//i.test(assetBase)) throw Error('图片 CDN 前缀必须是 http(s) 地址');
        let categoryMap: any;
        if (typeof raw.categoryMap === 'string' && raw.categoryMap.trim()) {
          try {
            categoryMap = JSON.parse(raw.categoryMap);
          } catch {
            throw Error('分类映射不是合法 JSON');
          }
        } else if (raw.categoryMap && typeof raw.categoryMap === 'object') {
          categoryMap = raw.categoryMap;
        }
        const config = await saveConfig(ctx, {
          ...(Object.prototype.hasOwnProperty.call(raw, 'inject') ? { inject: raw.inject === true } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'avoidDays') ? { avoidDays: Number(raw.avoidDays) } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'libraryRoot') ? { libraryRoot: String(raw.libraryRoot ?? '') } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'assetBaseUrl') ? { assetBaseUrl: String(raw.assetBaseUrl ?? '') } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'importRoot') ? { importRoot: String(raw.importRoot ?? '') } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'adultThreshold') ? { adultThreshold: Number(raw.adultThreshold) } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'unknownPersona') ? { unknownPersona: raw.unknownPersona === 'adult' ? 'adult' : 'minor' } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'personaPolicy') && raw.personaPolicy && typeof raw.personaPolicy === 'object' ? { personaPolicy: raw.personaPolicy } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'personaAge') && raw.personaAge && typeof raw.personaAge === 'object' ? { personaAge: raw.personaAge } : {}),
          ...(Object.prototype.hasOwnProperty.call(raw, 'personaGender') && raw.personaGender && typeof raw.personaGender === 'object' ? { personaGender: raw.personaGender } : {}),
          ...(categoryMap ? { categoryMap } : {}),
        });
        sendJson(res, 200, { ok: true, config, stats: await stats(ctx) });
        return;
      }

      if (action === 'reroll' || action === 'wear') {
        const result = await wear(ctx, {
          date: body?.date,
          blockId: body?.blockId,
          id: body?.id,
          scene: body?.scene,
          personaId: typeof body?.personaId === 'string' ? body.personaId : undefined,
        });
        sendJson(res, result.ok ? 200 : 400, { ok: result.ok, result, error: result.ok ? '' : result.reason });
        return;
      }

      if (action === 'alternatives') {
        const result = await alternatives(ctx, {
          date: body?.date,
          blockId: body?.blockId,
          count: body?.count,
          personaId: typeof body?.personaId === 'string' ? body.personaId : undefined,
        });
        sendJson(res, 200, { ok: true, result });
        return;
      }

      if (action === 'lock') {
        const result = await setLocked(ctx, {
          date: body?.date,
          locked: body?.locked === true,
          personaId: typeof body?.personaId === 'string' ? body.personaId : undefined,
        });
        sendJson(res, result.ok ? 200 : 400, { ok: result.ok, result, error: result.ok ? '' : result.reason });
        return;
      }

      if (action === 'feedback') {
        const result = await setFeedback(ctx, {
          id: body?.id,
          action: body?.feedbackAction,
          date: body?.date,
          personaId: typeof body?.personaId === 'string' ? body.personaId : undefined,
        });
        sendJson(res, result.ok ? 200 : 400, { ok: result.ok, result, error: result.ok ? '' : result.reason });
        return;
      }

      if (action === 'pack') {
        const result = await pack(ctx, {
          start: body?.start,
          end: body?.end,
          personaId: typeof body?.personaId === 'string' ? body.personaId : undefined,
        });
        sendJson(res, result.ok ? 200 : 400, { ok: result.ok, result, error: result.ok ? '' : result.reason });
        return;
      }

      if (action === 'import') {
        const result = await importLibrary(ctx, body?.root);
        sendJson(res, 200, { ok: true, result, stats: await stats(ctx) });
        return;
      }

      if (action === 'pick') {
        const result = await wardrobePick(ctx, {
          scene: body?.scene,
          season: body?.season,
          keyword: body?.keyword,
          count: body?.count,
          personaId: typeof body?.personaId === 'string' ? body.personaId : undefined,
        });
        sendJson(res, 200, { ok: true, result });
        return;
      }

      throw Error('操作无效');
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });
}
