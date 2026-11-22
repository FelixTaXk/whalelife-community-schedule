/*! 日程 plugin · 从通用 ICS 日历导入节假日（只读解析，不联网）。 */

import type { HolidayPeriod, HolidayScale } from './types.ts';
import { isValidDateKey, parseDateKey } from './time.ts';

type RawEvent = Record<string, string>;

function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function fieldValue(raw: string): { name: string; value: string } {
  const index = raw.indexOf(':');
  if (index < 0) return { name: '', value: '' };
  return { name: raw.slice(0, index).toUpperCase(), value: raw.slice(index + 1).trim() };
}

function dateOnly(value: string): string {
  const digits = value.replace(/[^0-9]/g, '').slice(0, 8);
  if (digits.length !== 8) return '';
  const key = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidDateKey(key) ? key : '';
}

function spanDays(start: string, end: string): number {
  return Math.max(1, Math.round((parseDateKey(end).getTime() - parseDateKey(start).getTime()) / 86_400_000) + 1);
}

/** 兼容 DTSTART;VALUE=DATE、带 TZID 的 DTSTART、DTEND/DURATION。 */
export function parseHolidayIcs(text: string): { periods: HolidayPeriod[]; errors: string[] } {
  if (typeof text !== 'string' || !text.includes('BEGIN:VEVENT')) {
    return { periods: [], errors: ['没有找到 VEVENT，请确认导出的是 iCalendar（.ics）文件'] };
  }
  const periods: HolidayPeriod[] = [];
  const errors: string[] = [];
  let event: RawEvent | null = null;
  for (const line of unfold(text)) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      event = {};
      continue;
    }
    if (upper === 'END:VEVENT') {
      if (event) {
        const start = dateOnly(event.DTSTART ?? '');
        if (!start) {
          if (event.SUMMARY) errors.push(`「${event.SUMMARY.slice(0, 20)}」没有可识别的 DTSTART`);
        } else {
          let end = dateOnly(event.DTEND ?? '');
          if (end && end > start) end = addDays(end, -1);
          if (!end) end = start;
          const duration = Number((event.DURATION ?? '').match(/P(\d+)D/i)?.[1] ?? 0);
          if (duration > 0) end = addDays(start, duration - 1);
          if (end < start) end = start;
          const days = spanDays(start, end);
          const name = (event.SUMMARY || '').trim().slice(0, 24) || '假期';
          const scale: HolidayScale = days >= 4 ? 'long' : 'short';
          periods.push({ name, start, end, kind: 'custom', scale });
        }
      }
      event = null;
      continue;
    }
    if (!event) continue;
    const { name, value } = fieldValue(line);
    if (!name || !value) continue;
    const key = name.split(';')[0];
    if (key === 'DTSTART' || key === 'DTEND' || key === 'DURATION' || key === 'SUMMARY') {
      event[key] = value;
    }
  }
  const unique: HolidayPeriod[] = [];
  const seen = new Set<string>();
  for (const period of periods) {
    const key = `${period.name}|${period.start}|${period.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(period);
  }
  if (!unique.length && !errors.length) errors.push('日历里没有全天事件可以导入');
  return { periods: unique.slice(0, 60), errors };
}

function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
