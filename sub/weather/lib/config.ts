/*! 日程 · 天气子插件 · 配置。 */

export type WeatherConfig = {
  version: 1;
  city: string;
  latitude: number | null;
  longitude: number | null;
  refreshMinutes: number;
  forecastDays: number;
  timeoutSeconds: number;
  apiBase: string;
  geocodingBase: string;
};

export const DEFAULT_API = 'https://api.open-meteo.com';
export const DEFAULT_GEOCODING = 'https://geocoding-api.open-meteo.com';

export function defaultConfig(): WeatherConfig {
  return {
    version: 1,
    city: '',
    latitude: null,
    longitude: null,
    refreshMinutes: 30,
    forecastDays: 7,
    timeoutSeconds: 8,
    apiBase: DEFAULT_API,
    geocodingBase: DEFAULT_GEOCODING,
  };
}

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function coordinate(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Math.round(number * 100000) / 100000;
}

export function normalizeBaseUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(trimmed)) return fallback;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return fallback;
  }
}

export function normalizeConfig(value: unknown, base: WeatherConfig = defaultConfig()): WeatherConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    version: 1,
    city: text(raw.city, base.city, 30),
    latitude: raw.latitude === undefined ? base.latitude : coordinate(raw.latitude, -90, 90),
    longitude: raw.longitude === undefined ? base.longitude : coordinate(raw.longitude, -180, 180),
    refreshMinutes: integer(raw.refreshMinutes, base.refreshMinutes, 5, 180),
    forecastDays: integer(raw.forecastDays, base.forecastDays, 1, 7),
    timeoutSeconds: integer(raw.timeoutSeconds, base.timeoutSeconds, 2, 30),
    apiBase: normalizeBaseUrl(raw.apiBase, base.apiBase),
    geocodingBase: normalizeBaseUrl(raw.geocodingBase, base.geocodingBase),
  };
}
