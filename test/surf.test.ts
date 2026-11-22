/*! 日程 plugin · 网上冲浪排期的纯函数测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePlan } from '../lib/plan.ts';
import { makeException } from '../lib/exceptions.ts';
import { chooseSurfTargets, detectSurfTargets } from '../lib/surf.ts';
import { defaultConfig, normalizeConfig } from '../lib/types.ts';

test('只识别已注册的 B 站 / 抖音工具', () => {
  const none = detectSurfTargets([]);
  assert.equal(none.length, 0);

  const bilibiliOnly = detectSurfTargets([
    { name: 'bilibili_browse' },
    { name: 'bilibili_watch' },
    { name: 'surf_search' },
  ]);
  assert.deepEqual(bilibiliOnly.map((target) => target.id), ['bilibili']);
  assert.deepEqual(bilibiliOnly[0].tools, ['bilibili_browse', 'bilibili_watch']);

  const both = detectSurfTargets([
    { name: 'douyin_feed' },
    { name: 'douyin_view' },
    { name: 'bilibili_browse' },
  ]);
  assert.deepEqual(both.map((target) => target.id), ['bilibili', 'douyin']);
  assert.match(both[1].hint, /douyin_feed/);
});

test('平台选择：空列表 = 全部，填了只留选中项', () => {
  const targets = detectSurfTargets([{ name: 'bilibili_browse' }, { name: 'douyin_feed' }]);
  assert.deepEqual(chooseSurfTargets({ platforms: [] }, targets).map((target) => target.id), ['bilibili', 'douyin']);
  assert.deepEqual(chooseSurfTargets({ platforms: ['douyin'] }, targets).map((target) => target.id), ['douyin']);
});

test('冲浪配置默认关闭，规范化范围', () => {
  const config = defaultConfig();
  assert.equal(config.surf.enabled, false);
  assert.deepEqual(config.surf.platforms, []);
  assert.equal(normalizeConfig({}).surf.enabled, false);
  const normalized = normalizeConfig({
    surf: { enabled: true, platforms: ['bilibili', 'bilibili', 'douyin'], minutes: 999, perDay: 9 },
  });
  assert.deepEqual(normalized.surf.platforms, ['bilibili', 'douyin']);
  assert.equal(normalized.surf.minutes, 180);
  assert.equal(normalized.surf.perDay, 3);
});

test('开启且检测到平台时，把冲浪排进最晚空档', () => {
  const config = defaultConfig();
  config.surf = { enabled: true, platforms: ['bilibili'], minutes: 30, perDay: 1 };
  const targets = detectSurfTargets([{ name: 'bilibili_browse' }, { name: 'bilibili_watch' }]);
  const plan = generatePlan(config, '2026-11-23', null, null, [], targets);
  const surf = plan.items.find((item) => item.kind === 'surf');
  assert.ok(surf);
  assert.equal(surf.title, '刷 B 站');
  assert.equal(surf.end, '23:00');
  assert.equal(surf.start, '22:30');
  assert.match(surf.note ?? '', /bilibili_browse/);
  assert.equal(surf.auto, undefined, '冲浪项不应被模型当作普通空档替换');
});

test('未开启、未检测到平台或异常日休息时不排冲浪', () => {
  const base = defaultConfig();
  const targets = detectSurfTargets([{ name: 'douyin_feed' }]);
  assert.equal(generatePlan(base, '2026-11-23', null, null, [], targets).items.some((item) => item.kind === 'surf'), false);

  const enabled = defaultConfig();
  enabled.surf = { enabled: true, platforms: [], minutes: 30, perDay: 1 };
  assert.equal(generatePlan(enabled, '2026-11-23', null, null, [], []).items.some((item) => item.kind === 'surf'), false);

  const exception = makeException('2026-11-23', 'sick');
  assert.equal(generatePlan(enabled, '2026-11-23', null, exception, [], targets).items.some((item) => item.kind === 'surf'), false);
});
