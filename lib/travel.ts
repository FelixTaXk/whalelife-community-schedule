/*! 日程 plugin · 周末短途与长假旅行安排（纯函数）。 */

import type { HolidayDay, DayInfo } from './holidays.ts';
import type { TravelConfig, TravelSource, TravelSpot } from './types.ts';
import { addDays, hashSeed, parseDateKey } from './time.ts';

export type TravelMode = 'weekend' | 'short' | 'long';

export type TravelChoice = {
  key: string;
  destination: string;
  days: number;
  source: TravelSource;
  reason: string;
};

export type TravelOverride = {
  destination: string;
  days?: number;
  source?: TravelSource;
  reason?: string;
};

export type TravelDecision = {
  key: string;
  destination: string;
  spotName: string;
  source: TravelSource;
  reason: string;
  startDate: string;
  endDate: string;
  dayIndex: number;
  days: number;
  start: string;
  end: string;
  title: string;
  place: string;
  note: string;
};

function dayDiff(from: string, to: string): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / 86_400_000);
}

function weekendStart(date: string, weekendDays: number[] = [6, 7]): string {
  const weekday = parseDateKey(date).getDay() || 7;
  const days = weekendDays.length ? weekendDays : [6, 7];
  if (!days.includes(weekday)) return date;
  let start = weekday;
  for (let i = 0; i < 6; i += 1) {
    const previous = ((start + 5) % 7) + 1;
    if (!days.includes(previous)) break;
    start = previous;
  }
  return addDays(date, -((weekday - start + 7) % 7));
}

function weekIndex(date: string): number {
  return Math.floor(parseDateKey(date).getTime() / 604_800_000);
}

function modeOf(info: DayInfo, config: TravelConfig): TravelMode | null {
  if (!config.enabled || info.workday) return null;
  if (info.holiday) {
    if (info.holiday.scale === 'long') return config.longHoliday ? 'long' : null;
    return config.shortHoliday ? 'short' : null;
  }
  if (!info.weekend || !config.weekend) return null;
  return weekIndex(info.date) % Math.max(1, config.weekendEvery) === 0 ? 'weekend' : null;
}

function inRange(date: string, from: string, to: string): boolean {
  return (!from || date >= from) && (!to || date <= to);
}

function targetSpot(config: TravelConfig, info: DayInfo, mode: TravelMode): TravelSpot | null {
  if (!config.target || !inRange(info.date, config.targetFrom, config.targetTo)) return null;
  return {
    name: config.target,
    distance: mode === 'long' ? 'far' : 'near',
    minDays: 1,
    maxDays: mode === 'weekend' ? 1 : mode === 'short' ? 2 : 6,
    from: config.targetFrom,
    to: config.targetTo,
    note: '指定目的地',
  };
}

/** 给 AI 的候选地点：长假优先远途，周末/短假优先近处；只保留按可用天数确实排得下的地点。 */
export function travelCandidates(config: TravelConfig, info: DayInfo, date = info.date): TravelSpot[] {
  if (!config.enabled || info.workday || !info.holiday && !info.weekend) return [];
  const mode = modeOf(info, config);
  if (!mode) return [];
  const target = targetSpot(config, info, mode);
  if (target) return [target];
  const wanted = mode === 'long' ? 'far' : 'near';
  const all = config.spots.filter((spot) => {
    if (spot.from && !inRange(date, spot.from, spot.to)) return false;
    const range = tripWindow(info, mode, spot, info.holiday);
    return !!range && dayDiff(range.start, range.end) + 1 >= spot.minDays;
  });
  const preferred = all.filter((spot) => spot.distance === wanted);
  return preferred.length ? preferred : all;
}

function pickSpot(candidates: TravelSpot[], key: string): TravelSpot | null {
  if (!candidates.length) return null;
  return candidates[hashSeed(key) % candidates.length];
}

function tripWindow(info: DayInfo, mode: TravelMode, spot: TravelSpot, holiday: HolidayDay | null): { start: string; end: string } | null {
  if (holiday) {
    if (spot.from && spot.to) {
      const from = spot.from < holiday.start ? holiday.start : spot.from;
      const to = spot.to > holiday.end ? holiday.end : spot.to;
      return from <= to && info.date >= from && info.date <= to ? { start: from, end: to } : null;
    }
    const total = holiday.days;
    const startOffset = mode === 'long' && total >= 7 ? 1 : 0;
    const span = mode === 'short'
      ? Math.min(total, spot.maxDays, 2)
      : Math.min(total - startOffset, spot.maxDays, 6);
    if (span < spot.minDays || span < 1) return null;
    const offset = mode === 'short' ? Math.max(0, Math.floor((total - span) / 2)) : startOffset;
    return { start: addDays(holiday.start, offset), end: addDays(holiday.start, offset + span - 1) };
  }
  if (mode !== 'weekend') return null;
  const saturday = weekendStart(info.date, info.weekendDays);
  if (spot.from && spot.to) {
    return saturday >= spot.from && saturday <= spot.to ? { start: saturday, end: saturday } : null;
  }
  return { start: saturday, end: saturday };
}

export function travelKey(info: DayInfo, date: string): string {
  return info.holiday ? `holiday:${info.holiday.key}` : `weekend:${weekendStart(date, info.weekendDays)}`;
}

export function resolveTravel(
  config: TravelConfig,
  info: DayInfo,
  date: string,
  override?: TravelOverride | null,
): TravelDecision | null {
  const mode = modeOf(info, config);
  if (!mode) return null;
  let candidates = travelCandidates(config, info, date);
  if (!candidates.length) return null;
  const target = targetSpot(config, info, mode);
  const key = travelKey(info, date);
  if (target) candidates = [target];
  let spot = target;
  if (override?.destination) {
    spot = candidates.find((entry) => entry.name === override.destination) ?? null;
    if (!spot) return null;
    candidates = [spot];
  }
  if (!spot) spot = pickSpot(candidates, key);
  if (!spot) return null;
  const range = tripWindow(info, mode, spot, info.holiday);
  if (!range) return null;
  const dayIndex = dayDiff(range.start, date);
  const days = dayDiff(range.start, range.end) + 1;
  const chosenDays = override?.days && override.days >= spot.minDays && override.days <= spot.maxDays
    ? Math.min(override.days, days)
    : days;
  if (dayIndex < 0 || dayIndex >= chosenDays) return null;

  const start = mode === 'weekend' ? '09:00' : dayIndex === 0 ? '08:30' : '09:00';
  const end = mode === 'weekend' ? '17:00' : dayIndex === chosenDays - 1 ? '18:30' : '20:30';
  const source: TravelSource = target ? 'user' : override?.source ?? 'pool';
  const reason = override?.reason || (target ? '指定目的地' : spot.note || (mode === 'long' ? '长假远途' : '周末短途'));
  const label = info.holiday ? `${info.holiday.name}第 ${dayIndex + 1}/${chosenDays} 天` : '周末短途';
  return {
    key,
    destination: spot.name,
    spotName: spot.name,
    source,
    reason,
    startDate: range.start,
    endDate: addDays(range.start, chosenDays - 1),
    dayIndex,
    days: chosenDays,
    start,
    end,
    title: `旅行 · ${spot.name}`,
    place: spot.name,
    note: `${label}${spot.note ? ` · ${spot.note}` : ''}`,
  };
}
