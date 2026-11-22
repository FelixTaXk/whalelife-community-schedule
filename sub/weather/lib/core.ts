/*! 日程 · 天气子插件 · 取数、缓存与降级。 */

import type { Context } from '../../../../../core/context.ts';
import type { WeatherSnapshot } from '../../../lib/weather-types.ts';
import { normalizeConfig, type WeatherConfig } from './config.ts';
import { findCity } from './cities.ts';
import { forecastUrl, geocodeUrl, parseForecast } from './forecast.ts';

export type GeocodeResult = { name: string; province: string; latitude: number; longitude: number; source: string };

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

export class WeatherCore {
  private static readonly CACHE_FILE = 'weather-cache.json';

  private ctx: Context;
  private configValue: WeatherConfig;
  private cache: WeatherSnapshot | null = null;
  private attemptAt = 0;
  private inflight: Promise<WeatherSnapshot> | null = null;

  constructor(ctx: Context, config: WeatherConfig) {
    this.ctx = ctx;
    this.configValue = config;
  }

  static async create(ctx: Context): Promise<WeatherCore> {
    const raw = await ctx.config.read<unknown>('config.json').catch(() => ({}));
    const core = new WeatherCore(ctx, normalizeConfig(raw ?? {}));
    await core.restore();
    return core;
  }

  /** 重启后先把上次的快照装回来：接口挂了，日程和衣柜也还有天气可用。 */
  private async restore(): Promise<void> {
    const raw = await this.ctx.config.read<unknown>(WeatherCore.CACHE_FILE).catch(() => null);
    const snapshot = (raw as any)?.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.days)) return;
    this.cache = snapshot as WeatherSnapshot;
    // 缓存只用来兜底；启动后第一次 refresh 仍然走网络，拿到更新的预报。
    this.attemptAt = 0;
  }

  private persist(snapshot: WeatherSnapshot | null): void {
    void this.ctx.config
      .save(WeatherCore.CACHE_FILE, { version: 1, savedAt: new Date().toISOString(), snapshot })
      .catch((error) => this.ctx.logger.warn('天气缓存写入失败', { error: errorText(error) }));
  }

  get config(): WeatherConfig {
    return this.configValue;
  }

  get place(): string {
    return this.configValue.city;
  }

  peek(): WeatherSnapshot | null {
    return this.cache;
  }

  async saveConfig(value: unknown): Promise<WeatherConfig> {
    const next = normalizeConfig(value, this.configValue);
    await this.ctx.config.save('config.json', next);
    const moved = next.city !== this.configValue.city
      || next.latitude !== this.configValue.latitude
      || next.longitude !== this.configValue.longitude;
    this.configValue = next;
    this.cache = null;
    this.attemptAt = 0;
    if (moved) this.persist(null);
    return next;
  }

  async refresh(force = false): Promise<WeatherSnapshot> {
    const now = Date.now();
    const ttl = (this.cache?.error ? 60 : this.configValue.refreshMinutes * 60) * 1000;
    if (!force && this.cache && this.attemptAt && now - this.attemptAt < ttl) return this.cache;
    if (this.inflight) return this.inflight;
    this.inflight = this.load().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async load(): Promise<WeatherSnapshot> {
    const config = this.configValue;
    const { latitude, longitude } = config;
    if (latitude === null || longitude === null) return this.fail('还没有坐标，请到「日程 · 天气」设置里按城市名定位');
    try {
      const raw = await this.fetchJson(forecastUrl(config, latitude, longitude));
      const snapshot = parseForecast(raw, { place: config.city, latitude, longitude });
      this.cache = snapshot;
      this.attemptAt = Date.now();
      this.persist(snapshot);
      return snapshot;
    } catch (error) {
      return this.fail(errorText(error));
    }
  }

  private fail(message: string): WeatherSnapshot {
    const config = this.configValue;
    const previous = this.cache;
    const snapshot: WeatherSnapshot = previous
      ? {
          ...previous,
          place: config.city,
          latitude: config.latitude ?? previous.latitude,
          longitude: config.longitude ?? previous.longitude,
          error: message,
        }
      : {
          version: 1,
          place: config.city,
          latitude: config.latitude ?? 0,
          longitude: config.longitude ?? 0,
          timezone: '',
          updatedAt: '',
          now: null,
          days: [],
          error: message,
        };
    this.cache = snapshot;
    this.attemptAt = Date.now();
    // 失败也落盘：保留上一次的预报，日程/衣柜不会因为一次超时断粮。
    if (snapshot.days.length || snapshot.now) this.persist(snapshot);
    this.ctx.logger.warn('天气取数失败', { place: config.city, error: message });
    return snapshot;
  }

  private async fetchJson(url: string): Promise<unknown> {
    let lastError: unknown = Error('天气接口没有响应');
    // 国内到 Open-Meteo 偶发首个请求超时，退避 300ms 再试一次。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const signal = AbortSignal.any([this.ctx.signal, AbortSignal.timeout(this.configValue.timeoutSeconds * 1000)]);
        const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
        if (!response.ok) throw Error(`天气接口 HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    throw lastError;
  }

  async geocode(city: string): Promise<GeocodeResult | null> {
    const name = city.trim().slice(0, 30);
    if (!name) throw Error('先填城市名');
    const local = findCity(name);
    if (local) {
      return {
        name: local.name,
        province: local.province,
        latitude: local.latitude,
        longitude: local.longitude,
        source: '常用城市表',
      };
    }
    const raw = await this.fetchJson(geocodeUrl(this.configValue, name)) as Record<string, unknown>;
    const results = Array.isArray(raw?.results) ? raw.results : [];
    if (!results.length) throw Error('没查到这座城市，试试英文或拼音（例如 Changzhou）');
    const first = results[0] as Record<string, unknown>;
    const latitude = Number(first.latitude);
    const longitude = Number(first.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw Error('定位结果没有有效坐标');
    const found = String(first.name ?? name);
    const admin = String(first.admin1 ?? '');
    return {
      name: found,
      province: admin,
      latitude: Math.round(latitude * 100000) / 100000,
      longitude: Math.round(longitude * 100000) / 100000,
      source: 'Open-Meteo 地名库',
    };
  }
}
