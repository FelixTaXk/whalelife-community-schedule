/*! 日程 · 天气子插件 · 页面与接口注册。 */

import type { Context, PluginHandler } from '../../../../../core/context.ts';
import type { WeatherCore } from './core.ts';
import { weatherSettingsPage, type WeatherPageData } from '../ui/settings.ts';

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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type WeatherWebOptions = { version: string };

export function registerWeb(ctx: Context, core: WeatherCore, options: WeatherWebOptions) {
  const base = '/plugins/schedule/weather/';

  const page = (render: () => Promise<string>): PluginHandler => {
    return async (_req: any, res: any) => {
      try {
        sendHtml(res, await render());
      } catch (error) {
        ctx.logger.warn('天气页面渲染失败', { error: errorText(error) });
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('天气页面加载失败，请稍后重试');
      }
    };
  };

  ctx.web.page(base + 'settings', page(async () => {
    const data: WeatherPageData = {
      config: core.config,
      snapshot: await core.refresh(),
      version: options.version,
    };
    return weatherSettingsPage(data);
  }), { title: '天气设置', settings: true });

  ctx.web.api(base + 'config', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      const action = String(body?.action ?? 'read');
      if (action === 'read') {
        sendJson(res, 200, { ok: true, config: core.config, snapshot: await core.refresh() });
        return;
      }
      if (action === 'geocode') {
        const city = String(body?.city ?? '').trim();
        if (!city) throw Error('先在城市一栏填名字');
        const result = await core.geocode(city);
        sendJson(res, 200, { ok: true, result });
        return;
      }
      if (action === 'save') {
        const raw = body?.config && typeof body.config === 'object' ? body.config : {};
        const config = await core.saveConfig(raw);
        sendJson(res, 200, { ok: true, config });
        return;
      }
      throw Error('操作无效');
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });

  ctx.web.api(base + 'data', async (req: any, res: any, { signal }: { signal: AbortSignal }) => {
    try {
      const body = await readJson(req, signal);
      const snapshot = await core.refresh(body?.force === true);
      sendJson(res, 200, { ok: true, snapshot });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: errorText(error) });
    }
  });
}
