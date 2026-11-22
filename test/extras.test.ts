/*! 日程 plugin · ICS 导出、节假日导入与逐小时天气的纯函数测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIcs } from '../lib/ics.ts';
import { parseHolidayIcs } from '../lib/ics-holidays.ts';
import { applyHourlyRules } from '../lib/weather-rules.ts';
import { buildItinerary } from '../lib/travel.ts';
import { defaultConfig, type Plan } from '../lib/types.ts';
import type { WeatherHour } from '../lib/weather-types.ts';

function plan(): Plan {
  return {
    version: 1,
    date: '2026-11-23',
    weekday: 1,
    tone: '平稳',
    note: '',
    source: 'auto',
    routineHash: 'x',
    generatedAt: '2026-11-23T00:00:00.000Z',
    edited: false,
    items: [
      { id: 'i1', start: '09:00', end: '10:00', title: '上班, 处理; 邮件', kind: 'work', place: '办公室', status: 'pending' },
      { id: 'i2', start: '23:30', end: '24:00', title: '睡觉', kind: 'sleep', status: 'pending' },
    ],
  };
}

test('ICS 导出：事件、转义、折行，跳过睡觉', () => {
  const text = buildIcs([plan()], { leadMinutes: 10, name: '测试', language: 'en-US', timezone: 'Asia/Shanghai' });
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /X-WR-TIMEZONE:Asia\/Shanghai/);
  assert.match(text, /SUMMARY:上班\\, 处理\\; 邮件/);
  assert.match(text, /DTSTART:20261123T090000/);
  assert.match(text, /TRIGGER:-PT10M/);
  assert.equal(text.includes('睡觉'), false);
  assert.equal(text.endsWith('\r\n'), true);
});

test('节假日 ICS：全天与带时间事件都能导入，重复去重', () => {
  const sample = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261224',
    'DTEND;VALUE=DATE:20261226',
    'SUMMARY:圣诞假',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Asia/Shanghai:20270101T000000',
    'DURATION:P3D',
    'SUMMARY:新年',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261224',
    'DTEND;VALUE=DATE:20261226',
    'SUMMARY:圣诞假',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const parsed = parseHolidayIcs(sample);
  assert.equal(parsed.periods.length, 2);
  assert.deepEqual(parsed.periods[0], { name: '圣诞假', start: '2026-12-24', end: '2026-12-25', kind: 'custom', scale: 'short' });
  assert.equal(parsed.periods[1].end, '2027-01-03');
  assert.equal(parsed.errors.length, 0);
});

test('小时级天气：通勤降水标注、户外给出更低降水时段、旅行备选带时间窗', () => {
  const config = defaultConfig();
  const hours: WeatherHour[] = Array.from({ length: 18 }, (_, index) => ({
    time: `2026-11-23T${String(index + 6).padStart(2, '0')}:00`,
    date: '2026-11-23',
    hour: index + 6,
    temperature: 20,
    precipitation: 5,
    precipitationProbability: 80,
    code: 63,
    text: '中雨',
    icon: '🌧',
  }));
  hours[4] = { ...hours[4], precipitation: 0, precipitationProbability: 10 };
  const p = plan();
  p.items.push({ id: 'c1', start: '08:00', end: '08:30', title: '通勤 · 去公司', kind: 'commute', status: 'pending' });
  p.items.push({ id: 'e1', start: '18:00', end: '19:00', title: '跑步', kind: 'exercise', status: 'pending' });
  p.travel = { destination: '某地', dayIndex: 0, days: 2, source: 'pool' };
  p.travel.itinerary = buildItinerary(p.travel, config.travel, null);
  const day = { date: '2026-11-23', code: 63, text: '中雨', icon: '🌧', min: 18, max: 22, precipitation: 5, precipitationProbability: 80, windMax: 10, sunrise: '', sunset: '', tip: '', outdoor: false };
  const next = applyHourlyRules(p, hours, day);
  assert.ok(next.items.find((item) => item.id === 'c1')?.note?.includes('带伞'));
  assert.ok(next.items.find((item) => item.id === 'e1')?.note?.includes('10:00'));
  assert.ok(next.travel?.itinerary?.backup.includes('10:00'));
  assert.equal(next.hourly?.length, 18);
});
