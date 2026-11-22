/*! 日程 plugin · 重复规则与周复盘单元测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fixedWhenText,
  normalizeRepeat,
  occursOn,
  parseFixedWhen,
  parseRepeatText,
  repeatInput,
} from '../lib/recurrence.ts';
import { weeklyReview, weekStartOf } from '../lib/review.ts';
import { generatePlan } from '../lib/plan.ts';
import { normalizeConfig } from '../lib/types.ts';
import { PRESETS, presetIdOfRoutine } from '../lib/types.ts';
import { applyException, makeException } from '../lib/exceptions.ts';
import type { ExceptionDay } from '../lib/exceptions.ts';
import type { Plan, PlanItem } from '../lib/types.ts';

function item(overrides: Partial<PlanItem>): PlanItem {
  return { id: 'i1', start: '09:00', end: '10:00', title: '测试', kind: 'work', status: 'pending', ...overrides };
}

function plan(date: string, items: PlanItem[], extra: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    date,
    weekday: new Date(`${date}T00:00:00`).getDay() || 7,
    tone: '平稳',
    note: '',
    source: 'auto',
    routineHash: 'x',
    generatedAt: '2026-11-22T00:00:00.000Z',
    edited: false,
    items,
    sleepAt: '23:30',
    ...extra,
  };
}

test('模板识别：未改动的预设能自动选中，改动后显示自定义', () => {
  for (const preset of PRESETS) assert.equal(presetIdOfRoutine(normalizeConfig({ routine: preset.routine }).routine), preset.id);
  const custom = normalizeConfig({}).routine;
  custom.wake = '05:59';
  assert.equal(presetIdOfRoutine(custom), '');
});

test('重复规则：解析固定安排写法并统一输出', () => {
  const when = parseFixedWhen('双周 1,3,5 @2026-11-16 !2026-12-01');
  assert.deepEqual(when.days, [1, 3, 5]);
  assert.equal(when.repeat, 'biweekly@2026-11-16!2026-12-01');
  assert.equal(when.error, '');

  assert.equal(fixedWhenText([1, 3, 5], when.repeat), '双周 1,3,5 @2026-11-16 !2026-12-01');
  assert.equal(fixedWhenText([3], 'monthly:2'), '每月第2个 3');
  assert.equal(fixedWhenText([5], 'last'), '每月最后 5');

  const monthly = parseFixedWhen('每月第2个 3');
  assert.deepEqual(monthly.days, [3]);
  assert.equal(monthly.repeat, 'monthly:2');

  assert.match(parseFixedWhen('双周 1,3 @2026-02-30').error, /双周/);
  assert.match(parseRepeatText('每月第9个').error, /每月第1-5个/);
  assert.equal(normalizeRepeat('看不懂'), '');
  assert.equal(normalizeRepeat('隔周 @2026-11-16'), 'biweekly@2026-11-16');
  assert.equal(repeatInput('biweekly@2026-11-16!2026-12-01'), '双周 @2026-11-16 !2026-12-01');
});

test('重复规则：每周 / 双周 / 每月第 N 个 / 每月最后 / 例外日期', () => {
  // 2026-11-16 是基准周的周一。
  assert.equal(occursOn([1], 'biweekly@2026-11-16', '2026-11-16', 1), true);
  assert.equal(occursOn([1], 'biweekly@2026-11-16', '2026-11-23', 1), false);
  assert.equal(occursOn([1], 'biweekly@2026-11-16', '2026-11-30', 1), true);
  assert.equal(occursOn([1], 'biweekly@2026-11-16', '2026-11-09', 1), false, '基准周之前不命中');

  // 2026 年 11 月的第二个周三：11-11；最后一个周五：11-27。
  assert.equal(occursOn([3], 'monthly:2', '2026-11-11', 3), true);
  assert.equal(occursOn([3], 'monthly:2', '2026-11-04', 3), false);
  assert.equal(occursOn([5], 'last', '2026-11-27', 5), true);
  assert.equal(occursOn([5], 'last', '2026-11-20', 5), false);

  assert.equal(occursOn([1], 'weekly!2026-11-16', '2026-11-16', 1), false);
  assert.equal(occursOn([1], 'weekly!2026-11-16', '2026-11-23', 1), true);
  assert.equal(occursOn([1], '', '2026-11-16', 1), true);
  assert.equal(occursOn([1], '', '2026-11-17', 2), false);
});

test('重复规则：固定安排也按双周 / 每月规则生成', () => {
  const config = normalizeConfig({
    routine: {
      fixed: [
        { title: '双周例会', days: [1], start: '10:00', minutes: 60, place: '会议室', repeat: '双周@2026-11-16' },
        { title: '月末盘点', days: [5], start: '16:00', minutes: 60, repeat: 'last' },
      ],
    },
  });
  const first = generatePlan(config, '2026-11-16');
  assert.ok(first.items.some((item) => item.title === '双周例会'));
  const off = generatePlan(config, '2026-11-23');
  assert.ok(!off.items.some((item) => item.title === '双周例会'));
  const again = generatePlan(config, '2026-11-30');
  assert.ok(again.items.some((item) => item.title === '双周例会'));
  const lastFriday = generatePlan(config, '2026-11-27');
  assert.ok(lastFriday.items.some((item) => item.title === '月末盘点'), '11-27 是 11 月最后一个周五');
  const notLast = generatePlan(config, '2026-11-20');
  assert.ok(!notLast.items.some((item) => item.title === '月末盘点'));
});

test('异常日：生病全天停正事，休息半天只保留上午', () => {
  const base = normalizeConfig({
    routine: {
      work: { enabled: true, title: '上班', days: [1], start: '09:00', end: '18:00' },
      exercise: { enabled: true, days: [1], title: '健身', start: '20:00', minutes: 45 },
    },
  });
  const sick = makeException('2026-11-23', 'sick', '感冒');
  const sickPlan = generatePlan(applyException(base, sick), '2026-11-23', null, sick);
  assert.ok(!sickPlan.items.some((item) => item.kind === 'work'));
  assert.ok(!sickPlan.items.some((item) => item.kind === 'exercise'));
  assert.ok(sickPlan.items.some((item) => item.kind === 'meal'), '三餐要保留');
  assert.ok(sickPlan.items.some((item) => item.title === '休息'), '空档改成休息');

  const half = makeException('2026-11-23', 'half', '下午请假');
  const halfPlan = generatePlan(applyException(base, half), '2026-11-23', null, half);
  const work = halfPlan.items.filter((item) => item.kind === 'work');
  assert.ok(work.length > 0, '上午正事保留');
  assert.ok(work.every((item) => item.end <= '12:00'), '正事到中午结束');
  assert.ok(!halfPlan.items.some((item) => item.kind === 'exercise'));
  assert.ok(halfPlan.items.some((item) => item.kind === 'meal'));
});

test('周复盘：完成率、跳过项、睡眠、旅行运动与上周对比', () => {
  const itemsA = [
    item({ title: '上班', kind: 'work', start: '09:00', end: '18:00', status: 'done' }),
    item({ id: 'i2', title: '健身', kind: 'exercise', start: '20:00', end: '20:45', status: 'skipped' }),
    item({ id: 'i3', title: '睡觉', kind: 'sleep', start: '23:30', end: '24:00' }),
  ];
  const itemsB = [
    item({ title: '上班', kind: 'work', start: '09:00', end: '18:00', status: 'done' }),
    item({ id: 'i2', title: '健身', kind: 'exercise', start: '20:00', end: '20:45', status: 'pending' }),
  ];
  const exceptions: ExceptionDay[] = [{
    version: 1,
    date: '2026-11-18',
    kind: 'sick',
    note: '感冒',
    createdAt: '2026-11-18T00:00:00.000Z',
  }];
  const review = weeklyReview([
    plan('2026-11-16', itemsA, { sleepAt: '23:30', travel: { destination: '公园', dayIndex: 0, days: 1, source: 'pool' } }),
    plan('2026-11-17', itemsB, { sleepAt: '00:30（次日）' }),
    plan('2026-11-18', [item({ title: '休息', kind: 'rest', status: 'done' })], { sleepAt: '' }),
    plan('2026-11-09', [item({ title: '上班', kind: 'work', status: 'done' })]),
  ], exceptions, '2026-11-22');

  assert.equal(weekStartOf('2026-11-22'), '2026-11-16');
  assert.equal(review.current.total, 5);
  assert.equal(review.current.done, 3);
  assert.equal(review.current.skipped, 1);
  assert.equal(review.current.pending, 1);
  assert.equal(review.current.rate, 60, '3/5，睡觉不计入');
  assert.equal(review.current.handledRate, 75, '已完成 / 已处理');
  assert.deepEqual(review.current.skippedTop, [{ title: '健身', count: 1 }]);
  assert.equal(review.current.travelDays, 1);
  assert.equal(review.current.exerciseDone, 0);
  assert.equal(review.current.exercisePlanned, 2);
  assert.equal(review.current.exceptionDays, 1);
  assert.deepEqual(review.current.exceptions, [{ title: '生病', count: 1 }]);
  assert.equal(review.current.sleepAverage, '00:00');
  assert.equal(review.current.sleepLatest, '00:30');
  assert.equal(review.current.sleepEarliest, '23:30');
  assert.equal(review.current.rows.length, 7);
  assert.equal(review.previous.total, 1);
  assert.equal(review.rateDelta, -40);
  assert.equal(review.doneDelta, 2);
});
