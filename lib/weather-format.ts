/*! 日程 · 天气文字格式（工具、页面、日程摘要共用）。 */

import type { WeatherDay, WeatherNow, WeatherSnapshot } from './weather-types.ts';
import { dateLabel, parseDateKey, weekdayLabel } from './time.ts';

export function updateLabel(snapshot: WeatherSnapshot): string {
  if (!snapshot.updatedAt) return '还没更新';
  const at = new Date(snapshot.updatedAt);
  if (Number.isNaN(at.getTime())) return '还没更新';
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} 更新`;
}

export function nowLine(now: WeatherNow): string {
  return `现在 ${now.temperature}℃，${now.text}，体感 ${now.apparent}℃，湿度 ${now.humidity}%，风 ${now.wind} km/h`;
}

function dayBody(day: WeatherDay): string {
  return `${day.text}，${day.min}–${day.max}℃`
    + `，降水 ${day.precipitationProbability}%${day.tip ? `，${day.tip}` : ''}`;
}

export function dayLine(day: WeatherDay): string {
  return `${dateLabel(day.date)} ${weekdayLabel(isoWeekday(day.date))}：${dayBody(day)}`;
}

function isoWeekday(date: string): number {
  const value = parseDateKey(date).getDay();
  return value === 0 ? 7 : value;
}

export function headline(snapshot: WeatherSnapshot, date?: string): string {
  if (snapshot.error && !snapshot.days.length && !snapshot.now) return `天气暂时取不到（${snapshot.error}）`;
  const day = snapshot.days.find((entry) => entry.date === date);
  const parts = [snapshot.place || '本地'];
  if (day) {
    parts.push(`${day.text} ${day.min}–${day.max}℃`);
    if (day.precipitationProbability > 0) parts.push(`降水 ${day.precipitationProbability}%`);
    if (day.tip) parts.push(day.tip);
  } else if (snapshot.now) {
    parts.push(`现在 ${snapshot.now.temperature}℃ ${snapshot.now.text}`);
  }
  return parts.join(' · ');
}

export function summaryText(snapshot: WeatherSnapshot, date?: string): string {
  const lines = [`${snapshot.place || '本地'} · ${updateLabel(snapshot)}`];
  if (snapshot.now) lines.push(nowLine(snapshot.now));
  if (date) {
    const day = snapshot.days.find((entry) => entry.date === date);
    if (day) lines.push(dayLine(day));
  } else {
    const today = snapshot.days[0];
    if (today) lines.push(`今天：${dayBody(today)}`);
  }
  if (snapshot.error) lines.push(`（天气可能不是最新的：${snapshot.error}）`);
  if (lines.length === 1) lines.push('还没有取到天气数据。');
  return lines.join('\n');
}

export function forecastText(snapshot: WeatherSnapshot, days: number): string {
  const limit = Math.min(snapshot.days.length, Math.max(1, days));
  if (!snapshot.days.length) return `天气暂时取不到${snapshot.error ? `：${snapshot.error}` : ''}`;
  const lines = [`${snapshot.place || '本地'} · ${updateLabel(snapshot)}`];
  for (const day of snapshot.days.slice(0, limit)) lines.push(dayLine(day));
  if (snapshot.error) lines.push(`（天气可能不是最新的：${snapshot.error}）`);
  return lines.join('\n');
}

export function shortDay(snapshot: WeatherSnapshot, date: string): WeatherDay | null {
  return snapshot.days.find((entry) => entry.date === date) ?? null;
}
