/*! 日程 plugin · 节假日、学生假期、周末短途与长假旅行。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig, parseHolidayText, parseTravelText } from '../lib/types.ts';
import { resolveDayInfo } from '../lib/holidays.ts';
import { generatePlan } from '../lib/plan.ts';
import { resolveTravel } from '../lib/travel.ts';
import { parseTravelChoice } from '../lib/travel-ai.ts';
import { ScheduleService } from '../lib/service.ts';

function configWithTravel() {
  const config = defaultConfig();
  config.travel = {
    ...config.travel,
    enabled: true,
    weekend: true,
    shortHoliday: true,
    longHoliday: true,
    spots: [
      { name: '常州恐龙园', distance: 'near', minDays: 1, maxDays: 1, from: '', to: '', note: '周六一日游' },
      { name: '杭州', distance: 'far', minDays: 3, maxDays: 5, from: '', to: '', note: '西湖' },
    ],
  };
  return config;
}

test('内置法定节假日：春节长假、国庆长假和调休上班日', () => {
  const config = defaultConfig();
  const spring = resolveDayInfo(config.holiday, '2026-02-16', 1);
  assert.equal(spring.holiday?.name, '春节');
  assert.equal(spring.holiday?.scale, 'long');
  assert.equal(spring.holiday?.days, 9);
  assert.equal(spring.holiday?.dayIndex, 1);
  assert.equal(spring.rest, true);

  const makeup = resolveDayInfo(config.holiday, '2026-02-14', 6);
  assert.equal(makeup.holiday, null);
  assert.equal(makeup.workday, '调休上班');
  assert.equal(makeup.rest, false);

  const national = resolveDayInfo(config.holiday, '2027-10-02', 6);
  assert.equal(national.holiday?.name, '国庆节');
  assert.equal(national.holiday?.days, 7);
  assert.equal(national.rest, true);

  const normal = resolveDayInfo(config.holiday, '2027-06-08', 2);
  assert.equal(normal.holiday, null);
  assert.equal(normal.rest, false);

  const weekend = resolveDayInfo(config.holiday, '2027-06-05', 6);
  assert.equal(weekend.weekend, true);
  assert.equal(weekend.rest, false, '普通周末不强制停工，仍由作息里的星期决定');
});

test('学生模式：寒暑假和春秋假只有打开后才生效', () => {
  const config = defaultConfig();
  config.holiday.builtin = false;
  config.holiday.periods = [
    { name: '寒假', start: '2027-01-25', end: '2027-02-20', kind: 'student', scale: 'long' },
    { name: '春假', start: '2027-04-01', end: '2027-04-07', kind: 'custom', scale: 'long' },
  ];
  assert.equal(resolveDayInfo(config.holiday, '2027-01-26', 2).holiday, null, '学生模式关闭时不认寒暑假');
  config.holiday.student = true;
  const winter = resolveDayInfo(config.holiday, '2027-01-26', 2);
  assert.equal(winter.holiday?.name, '寒假');
  assert.equal(winter.studentVacation, true);
  const spring = resolveDayInfo(config.holiday, '2027-04-02', 5);
  assert.equal(spring.holiday?.name, '春假');
  assert.equal(spring.studentVacation, false, '普通春秋假不算学生假期标记，但同样跳过正事');
});

test('假期不排正事，调休上班日强制排正事', () => {
  const config = defaultConfig();
  config.holiday.builtin = true;
  config.routine.work.enabled = true;
  config.routine.work.days = [1, 2, 3, 4, 5, 6, 7];
  const holiday = generatePlan(config, '2027-10-02');
  assert.equal(holiday.items.some((item) => item.kind === 'work' || item.kind === 'study'), false);
  assert.equal(holiday.holiday?.name, '国庆节');

  const makeup = generatePlan(config, '2026-02-14');
  assert.equal(makeup.items.some((item) => item.kind === 'work' || item.kind === 'study'), true, '调休周六仍要上班');
  assert.equal(makeup.workday, '调休上班');
});

test('旅行：周末选近处、国庆选远途、指定目的地优先、调休日不排旅行', () => {
  const config = configWithTravel();
  const weekend = resolveDayInfo(config.holiday, '2027-06-05', 6);
  const short = resolveTravel(config.travel, weekend, '2027-06-05');
  assert.equal(short?.destination, '常州恐龙园');
  assert.equal(short?.days, 1);
  assert.equal(short?.dayIndex, 0);
  assert.equal(short?.start, '09:00');
  assert.equal(short?.end, '17:00');

  const national = resolveDayInfo(config.holiday, '2027-10-02', 6);
  const long = resolveTravel(config.travel, national, '2027-10-02');
  assert.equal(long?.destination, '杭州');
  assert.ok((long?.days ?? 0) >= 3);
  assert.equal(long?.startDate, '2027-10-02');

  config.travel.target = '北京';
  config.travel.targetFrom = '2027-10-01';
  config.travel.targetTo = '2027-10-07';
  const target = resolveTravel(config.travel, national, '2027-10-02');
  assert.equal(target?.destination, '北京');
  assert.equal(target?.source, 'user');
  assert.equal(target?.days, 7, '指定目的地按日期段占满国庆');

  const makeup = resolveDayInfo(config.holiday, '2026-02-14', 6);
  assert.equal(resolveTravel(config.travel, makeup, '2026-02-14'), null, '调休上班日不排旅行');
});

test('周末也要上班时，正事优先于旅行；假期不上班时保留旅行', () => {
  const config = configWithTravel();
  config.routine.work.enabled = true;
  config.routine.work.days = [6];
  const workSaturday = generatePlan(config, '2027-06-05');
  assert.equal(workSaturday.travel, undefined, '周六上班会把一日游完全挤掉');

  config.holiday.builtin = true;
  const holiday = generatePlan(config, '2027-10-02');
  assert.equal(holiday.items.some((item) => item.kind === 'work' || item.kind === 'study'), false);
  assert.equal(holiday.travel?.destination, '杭州');
  assert.ok(holiday.items.some((item) => item.kind === 'travel'));
});

test('旅行候选按可用天数过滤：一日游不会选三天目的地，排不下就跳过', () => {
  const config = configWithTravel();
  config.travel.spots = [
    { name: '需连续三天', distance: 'near', minDays: 3, maxDays: 4, from: '', to: '', note: '至少三天' },
  ];
  const saturday = resolveDayInfo(config.holiday, '2026-11-28', 6);
  assert.equal(resolveTravel(config.travel, saturday, '2026-11-28'), null, '一日游不选最少三天的地点');
  assert.equal(resolveTravel(config.travel, saturday, '2026-11-28', { destination: '需连续三天', days: 1 }), null,
    '缓存或手工指定的地点也要重新校验天数');

  const plan = generatePlan(config, '2026-11-28');
  assert.equal(plan.travel, undefined);
  assert.equal(plan.items.some((item) => item.kind === 'travel'), false);

  config.travel.spots.push(
    { name: '常州恐龙园', distance: 'near', minDays: 1, maxDays: 1, from: '', to: '', note: '周六一日游' },
  );
  assert.equal(resolveTravel(config.travel, saturday, '2026-11-28')?.destination, '常州恐龙园');
});

test('旅行日跳过常规运动，普通非旅行日保留运动', () => {
  const config = configWithTravel();
  config.routine.exercise = { enabled: true, title: '散步', days: [4, 6, 7], start: '19:30', minutes: 40 };
  config.routine.hobbies = ['看剧'];

  const weekend = generatePlan(config, '2026-11-28');
  assert.ok(weekend.items.some((item) => item.kind === 'travel'));
  assert.equal(weekend.items.some((item) => item.kind === 'exercise'), false, '周末旅行日不排常规运动');

  const shortLastDay = generatePlan(config, '2026-04-05');
  assert.ok(shortLastDay.items.some((item) => item.kind === 'travel'), '清明短假最后一天仍有旅行');
  assert.equal(shortLastDay.items.some((item) => item.kind === 'exercise'), false, '短假旅行日不排常规运动');

  config.travel.spots = [
    { name: '杭州', distance: 'far', minDays: 3, maxDays: 6, from: '', to: '', note: '西湖' },
  ];
  const longLastDay = generatePlan(config, '2027-10-07');
  assert.ok(longLastDay.items.some((item) => item.kind === 'travel'), '国庆最后一天仍有旅行');
  assert.equal(longLastDay.items.some((item) => item.kind === 'exercise'), false, '长假旅行日不排常规运动');

  config.travel.enabled = false;
  const ordinary = generatePlan(config, '2026-11-28');
  assert.equal(ordinary.travel, undefined);
  assert.ok(ordinary.items.some((item) => item.kind === 'exercise' && item.start === '19:30'),
    '非旅行日仍保留散步');
});

test('AI 旅行选择：只接受地点池里的地点和天数范围内', () => {
  const spots = [
    { name: '杭州', distance: 'far' as const, minDays: 3, maxDays: 5, from: '', to: '', note: '西湖' },
    { name: '苏州', distance: 'near' as const, minDays: 1, maxDays: 1, from: '', to: '', note: '园林' },
  ];
  assert.deepEqual(parseTravelChoice('{"spot":"杭州","days":4,"reason":"西湖"}', spots), {
    spot: '杭州', days: 4, reason: '西湖',
  });
  assert.equal(parseTravelChoice('{"spot":"北京","days":3}', spots), null, '候选外的地点会被拒绝');
  assert.equal(parseTravelChoice('{"spot":"杭州","days":8}', spots)?.days, 5, '天数夹到地点上限');
});

test('服务：AI 选目的地后缓存，假期多天只选一次', async () => {
  const files = new Map<string, unknown>([
    ['config.json', {
      enabled: true,
      ai: { enabled: false, model: 'chat' },
      holiday: { enabled: true, builtin: true },
      travel: {
        enabled: true, weekend: true, shortHoliday: true, longHoliday: true, weekendEvery: 1, aiChoose: true,
        spots: [
          { name: '杭州', distance: 'far', minDays: 3, maxDays: 5, from: '', to: '', note: '西湖' },
          { name: '成都', distance: 'far', minDays: 4, maxDays: 5, from: '', to: '', note: '火锅' },
        ],
      },
    }],
  ]);
  let calls = 0;
  const ctx = {
    config: {
      read: async (file = 'config.json') => files.get(file) ?? {},
      save: async (file: string, value: unknown) => { files.set(file, value); },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {}, log() {} },
    emit() {},
    signal: new AbortController().signal,
    models: { list: () => [{ id: 'chat', callable: true, name: '测试模型' }] },
    llm: {
      chat: async () => {
        calls += 1;
        return { text: '{"spot":"杭州","days":4,"reason":"西湖"}', toolCalls: [], usage: {} };
      },
    },
  } as any;
  const service = await ScheduleService.create(ctx);
  const first = await service.ensure('2027-10-02');
  assert.equal(first.travel?.destination, '杭州');
  assert.equal(first.travel?.days, 4);
  assert.equal(calls, 1);
  const second = await service.ensure('2027-10-03');
  assert.equal(second.travel?.destination, '杭州');
  assert.equal(calls, 1, '同一假期第二天复用缓存，不再调模型');
});

test('假期/地点文本可保存和回读', () => {
  const holiday = parseHolidayText('寒假 | 2027-01-25 | 2027-02-20 | 寒暑假\n春假 | 2027-04-01 | 2027-04-07 | 长假');
  assert.equal(holiday.periods[0].kind, 'student');
  assert.equal(holiday.periods[0].scale, 'long');
  assert.equal(holiday.periods[1].scale, 'long');

  const travel = parseTravelText('常州恐龙园 | 近 | 1 | 1 | | 周六一日游\n杭州 | 远 | 3 | 5 | 2027-10-01~2027-10-05 | 西湖');
  assert.equal(travel.spots.length, 2);
  assert.equal(travel.spots[0].distance, 'near');
  assert.equal(travel.spots[1].from, '2027-10-01');
  assert.equal(travel.spots[1].to, '2027-10-05');
});
