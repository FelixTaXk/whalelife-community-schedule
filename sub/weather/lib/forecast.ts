/*! 日程 · 天气子插件 · Open-Meteo 请求地址与响应解析。 */

import type { WeatherConfig } from './config.ts';
import type { WeatherDay, WeatherNow, WeatherSnapshot } from '../../../lib/weather-types.ts';
import { codeInfo, dayTip, outdoorFriendly } from './wmo.ts';

export function forecastUrl(config: WeatherConfig, latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: String(config.forecastDays),
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `${config.apiBase}/v1/forecast?${params.toString()}`;
}

export function geocodeUrl(config: WeatherConfig, city: string): string {
  const params = new URLSearchParams({ name: city, count: '1', language: 'zh', format: 'json' });
  return `${config.geocodingBase}/v1/search?${params.toString()}`;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseForecast(
  raw: unknown,
  meta: { place: string; latitude: number; longitude: number },
): WeatherSnapshot {
  if (!raw || typeof raw !== 'object') throw Error('天气接口返回的不是对象');
  const source = raw as Record<string, any>;
  const daily = source.daily && typeof source.daily === 'object' ? source.daily : {};
  const times = array(daily.time).map(String);
  if (!times.length) throw Error('天气接口没有返回每日预报');

  const days: WeatherDay[] = times.map((date, index) => {
    const code = number(array(daily.weather_code)[index], -1);
    const info = codeInfo(code);
    const min = number(array(daily.temperature_2m_min)[index]);
    const max = number(array(daily.temperature_2m_max)[index]);
    const probability = number(array(daily.precipitation_probability_max)[index], 0);
    return {
      date,
      code,
      text: info.text,
      icon: info.icon,
      min,
      max,
      precipitation: number(array(daily.precipitation_sum)[index], 0),
      precipitationProbability: probability,
      windMax: number(array(daily.wind_speed_10m_max)[index], 0),
      sunrise: string(array(daily.sunrise)[index]),
      sunset: string(array(daily.sunset)[index]),
      tip: dayTip(code, probability, min, max),
      outdoor: outdoorFriendly(code, probability, max),
    };
  });

  let now: WeatherNow | null = null;
  if (source.current && typeof source.current === 'object') {
    const current = source.current as Record<string, unknown>;
    const temperature = Number(current.temperature_2m);
    if (Number.isFinite(temperature)) {
      const code = number(current.weather_code, -1);
      const info = codeInfo(code);
      now = {
        at: string(current.time),
        temperature: Math.round(temperature * 10) / 10,
        apparent: Math.round(number(current.apparent_temperature, temperature) * 10) / 10,
        humidity: number(current.relative_humidity_2m, 0),
        precipitation: number(current.precipitation, 0),
        wind: Math.round(number(current.wind_speed_10m, 0) * 10) / 10,
        code,
        text: info.text,
        icon: info.icon,
        isDay: Number(current.is_day) === 1,
      };
    }
  }

  return {
    version: 1,
    place: meta.place,
    latitude: meta.latitude,
    longitude: meta.longitude,
    timezone: string(source.timezone),
    updatedAt: new Date().toISOString(),
    now,
    days,
  };
}
