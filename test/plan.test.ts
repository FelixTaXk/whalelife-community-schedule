/*! 日程 plugin · 生成算法与配置校验的纯函数测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePlan, autoGaps, routineHash } from '../lib/plan.ts';
import { parseAiPayload } from '../lib/ai.ts';
import { defaultConfig, normalizeConfig, normalizeRoutine, parseFixedText, PRESETS } from '../lib/types.ts';
import { ScheduleService } from '../lib/service.ts';
import { parseHHMM, formatHHMM } from '../lib/time.ts';

function configFromPreset(index: number) {
  const config = defaultConfig();
  config.routine = PRESETS[index].routine;
  return config;
}

function assertNoOverlap(items: Array<{ start: string; end: string }>) {
  const sorted = [...items].sort((left, right) => (parseHHMM(left.start) as number) - (parseHHMM(right.start) as number));
  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok((parseHHMM(sorted[index - 1].end) as number) <= (parseHHMM(sorted[index].start) as number),
      `${sorted[index - 1].end} 与 ${sorted[index].start} 重叠`);
  }
}

test('上班模板：午饭切开正事，日程不重叠且铺满白天', () => {
  const config = configFromPreset(1);
  const plan = generatePlan(config, '2026-11-20');
  assert.ok(plan.items.length > 6);
  assertNoOverlap(plan.items);
  const work = plan.items.filter((item) => item.kind === 'work');
  assert.equal(work.length, 2, '上午和下午应各有一段正事');
  const lunch = plan.items.find((item) => item.title === '午饭');
  assert.ok(lunch);
  assert.ok(work.some((item) => parseHHMM(item.end) === parseHHMM(lunch.start)));
  // 从起床到睡觉之间，除非不足 30 分钟，否则留白都应被自由安排填上。
  for (let index = 1; index < plan.items.length; index += 1) {
    const gap = (parseHHMM(plan.items[index].start) as number) - (parseHHMM(plan.items[index - 1].end) as number);
    assert.ok(gap <= 30, `存在 ${gap} 分钟的留白`);
  }
});

test('上学模板：睡觉跨零点时给出次日时间，末尾到 24:00', () => {
  const config = configFromPreset(0);
  const plan = generatePlan(config, '2026-11-20');
  assert.match(plan.sleepAt ?? '', /（次日）/);
  assert.equal(plan.items[plan.items.length - 1].end, '24:00');
  assert.ok(plan.items.some((item) => item.title === '洗漱 · 准备睡'));
});

test('固定安排优先：会切开正事且不被压掉', () => {
  const config = configFromPreset(1);
  config.routine.fixed = [{ title: '例会', days: [1, 2, 3, 4, 5, 6, 7], start: '15:00', minutes: 60, place: '会议室' }];
  const plan = generatePlan(config, '2026-11-20');
  assertNoOverlap(plan.items);
  const meeting = plan.items.find((item) => item.title === '例会');
  assert.ok(meeting);
  assert.equal(meeting.start, '15:00');
  assert.equal(meeting.end, '16:00');
});

test('早于起床的固定安排只裁掉起床前的部分', () => {
  const config = configFromPreset(1);
  config.routine.fixed = [{ title: '早课', days: [1, 2, 3, 4, 5, 6, 7], start: '05:00', minutes: 240, place: '' }];
  const plan = generatePlan(config, '2026-11-21');
  const item = plan.items.find((entry) => entry.title === '早课');
  assert.ok(item);
  assert.equal(item.start, '07:10');
  assert.equal(item.end, '09:00');
});

test('同日同配置稳定，不同日期不同', () => {
  const config = configFromPreset(2);
  const first = JSON.stringify(generatePlan(config, '2026-11-21').items);
  const again = JSON.stringify(generatePlan(config, '2026-11-21').items);
  const other = JSON.stringify(generatePlan(config, '2026-11-22').items);
  assert.equal(first, again);
  assert.notEqual(first, other);
});

test('空档识别：自动自由段连续合并', () => {
  const config = configFromPreset(1);
  const plan = generatePlan(config, '2026-11-21');
  const gaps = autoGaps(plan);
  assert.ok(gaps.length >= 1);
  for (const gap of gaps) assert.ok(gap.end > gap.start);
  assert.ok(routineHash(config.routine).length === 12);
});

test('模型返回解析：只收空档内、不重叠的条目', () => {
  const gaps = [{ start: 8 * 60, end: 10 * 60 }];
  const good = '```json\n{"tone":"轻快","note":"留一点空","fills":[{"start":"08:30","end":"09:30","title":"画一张速写","kind":"free","note":"光很好"}]}\n```';
  const parsed = parseAiPayload(good, gaps);
  assert.ok(parsed);
  assert.equal(parsed?.fills.length, 1);
  assert.equal(parsed?.fills[0].title, '画一张速写');

  const outside = '{"fills":[{"start":"07:00","end":"08:00","title":"太早","kind":"free"}]}';
  assert.equal(parseAiPayload(outside, gaps), null);

  const overlap = '{"fills":[{"start":"08:00","end":"09:00","title":"一"},{"start":"08:30","end":"09:30","title":"二"}]}';
  assert.equal(parseAiPayload(overlap, gaps)?.fills.length, 1);

  assert.equal(parseAiPayload('抱歉，我排不了。', gaps), null);
});

test('配置校验：非法时间回落，天数被夹住，爱好去重', () => {
  const config = normalizeConfig({
    enabled: false,
    generateAt: '25:00',
    daysAhead: 99,
    keepDays: 1,
    routine: { wake: '06:05', sleep: '00:30', work: { days: [0, 1, 9, 1], title: '' }, hobbies: ['画画', '画画', '听歌'] },
  });
  assert.equal(config.enabled, false);
  assert.equal(config.generateAt, '07:00');
  assert.equal(config.daysAhead, 7);
  assert.equal(config.keepDays, 7);
  assert.equal(config.routine.wake, '06:05');
  assert.deepEqual(config.routine.work.days, [1]);
  assert.deepEqual(config.routine.hobbies, ['画画', '听歌']);
  assert.equal(normalizeRoutine(null).wake, '06:40');
});

test('固定安排文本解析与报错', () => {
  const parsed = parseFixedText([
    '买糖葫芦 | 1,3,5 | 17:20 | 20 | 校门口',
    '周末画画 | 周末 | 15:00 | 90',
    '坏行 | 星期八 | 09:00 | 60',
    '坏时间 | 每天 | 9点 | 60',
  ].join('\n'));
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[0].days, [1, 3, 5]);
  assert.deepEqual(parsed.items[1].days, [6, 7]);
  assert.equal(parsed.errors.length, 2);
});

test('服务：生成、补齐、编辑与防重叠', async () => {
  const files = new Map<string, unknown>();
  const ctx = {
    config: {
      read: async (file = 'config.json') => files.get(file) ?? {},
      save: async (file: string, value: unknown) => { files.set(file, value); },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {}, log() {} },
    emit() {},
    signal: new AbortController().signal,
    models: { list: () => [] },
    llm: { chat: async () => { throw new Error('不该调用模型'); } },
  } as any;
  const service = await ScheduleService.create(ctx);
  const first = await service.ensure('2026-11-20');
  assert.ok(first.items.length > 0);
  const again = await service.ensure('2026-11-20');
  assert.equal(again.generatedAt, first.generatedAt, '已有计划不应重复生成');

  const target = first.items.find((item) => item.auto && item.kind !== 'sleep' && (parseHHMM(item.start) as number) >= 19 * 60);
  assert.ok(target, '晚上应有一段自由安排');
  await service.edit('2026-11-20', { action: 'remove', id: target!.id });
  const start = formatHHMM(parseHHMM(target!.start) as number);
  const end = formatHHMM((parseHHMM(target!.start) as number) + 40);
  const plan = await service.edit('2026-11-20', { action: 'add', start, end, title: '加一节自习', kind: 'study' });
  assert.equal(plan.edited, true);
  assert.ok(plan.items.some((item) => item.title === '加一节自习'));

  await assert.rejects(() => service.edit('2026-11-20', { action: 'add', start: '08:30', end: '09:30', title: '撞车' }), /重叠/);
  const restored = await service.ensure('2026-11-20');
  assert.equal(restored.edited, true, '手动改过的计划不会被自动重排覆盖');
  const forced = await service.ensure('2026-11-20', { force: true });
  assert.equal(forced.edited, false, 'force 才覆盖');
});
