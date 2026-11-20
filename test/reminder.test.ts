/*! 日程 plugin · 第二层主动提醒：时间窗口、安静时段、去重与渠道发送。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ReminderService, dueReminders, reminderText } from '../lib/reminder.ts';
import { defaultConfig, normalizeConfig, type Plan } from '../lib/types.ts';

function plan(): Plan {
  return {
    version: 1,
    date: '2026-11-21',
    weekday: 6,
    tone: '平稳',
    note: '',
    source: 'auto',
    routineHash: 'x',
    generatedAt: '2026-11-21T00:00:00.000Z',
    edited: false,
    items: [
      { id: 'wake', start: '07:00', end: '07:30', title: '起床 · 洗漱', kind: 'routine', status: 'pending' },
      { id: 'work', start: '09:00', end: '12:00', title: '上课', kind: 'work', place: '学校', status: 'pending' },
      { id: 'free', start: '14:00', end: '15:00', title: '看剧', kind: 'free', status: 'pending' },
      { id: 'lunch', start: '12:00', end: '12:40', title: '午饭', kind: 'meal', status: 'done' },
      { id: 'sleep', start: '23:30', end: '24:00', title: '睡前洗漱', kind: 'routine', status: 'pending' },
    ],
    sleepAt: '00:30（次日）',
  };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 10, 21, hour, minute);
}

test('提醒窗口：提前 10 分钟进入，迟到 5 分钟后不再补发', () => {
  const config = { ...defaultConfig().reminder, enabled: true, leadMinutes: 10 };
  assert.deepEqual(dueReminders(plan(), at(8, 49), config).map((x) => x.item.id), []);
  assert.deepEqual(dueReminders(plan(), at(8, 50), config).map((x) => x.item.id), ['work']);
  assert.deepEqual(dueReminders(plan(), at(9, 4), config).map((x) => x.item.id), ['work']);
  assert.deepEqual(dueReminders(plan(), at(9, 6), config).map((x) => x.item.id), []);
});

test('提醒窗口：自由空档和已完成的项目不提醒，起床最多提前 5 分钟', () => {
  const config = { ...defaultConfig().reminder, enabled: true, leadMinutes: 10 };
  assert.deepEqual(dueReminders(plan(), at(6, 55), config).map((x) => x.item.id), ['wake']);
  assert.deepEqual(dueReminders(plan(), at(6, 54), config).map((x) => x.item.id), []);
  assert.deepEqual(dueReminders(plan(), at(13, 50), config).map((x) => x.item.id), []);
  assert.deepEqual(dueReminders(plan(), at(11, 50), config).map((x) => x.item.id), []);
});

test('安静时段跨午夜，收到窗口内不重复', () => {
  const config = { ...defaultConfig().reminder, enabled: true, leadMinutes: 10, quietStart: '23:30', quietEnd: '06:30' };
  assert.deepEqual(dueReminders(plan(), at(23, 25), config).map((x) => x.item.id), ['sleep']);
  assert.deepEqual(dueReminders(plan(), at(23, 31), config).map((x) => x.item.id), []);
  assert.deepEqual(dueReminders(plan(), at(0, 20), config).map((x) => x.item.id), []);
});

test('模板文本包含时间、标题和地点', () => {
  const config = { ...defaultConfig().reminder, enabled: true, leadMinutes: 10 };
  const due = dueReminders(plan(), at(8, 50), config)[0];
  assert.match(reminderText(due), /还有 10 分钟/);
  assert.match(reminderText(due), /09:00–12:00 上课（学校）/);
});

test('服务：只发一次，失败重试一次，保存当天状态', async () => {
  const state = new Map<string, any>();
  const sent: any[] = [];
  const controller = new AbortController();
  const ctx: any = {
    signal: controller.signal,
    logger: { warn() {}, info() {}, error() {} },
    config: {
      read: async (file: string) => state.get(file) ?? null,
      save: async (file: string, value: any) => { state.set(file, value); },
    },
    sessions: {
      list: async () => [{ id: 's' }],
      current: async () => 's',
      enqueueTransient: async () => '哥哥，九点上课，该走了',
    },
    tools: {
      call: async (name: string, args: any) => {
        sent.push(args);
        return { ok: true, result: { status: 'sent', confirmed: true } };
      },
    },
  };
  const schedule: any = {
    config: normalizeConfig({ reminder: { enabled: true, channel: 'qq', account: '', peer: 'direct:20002', usePersona: false } }),
    read: async () => plan(),
  };
  const service = new ReminderService(ctx, schedule, () => at(8, 50));
  await service.tick();
  assert.equal(sent.length, 1);
  const saved = state.get('reminders/2026-11-21.json');
  assert.equal(saved.sent['2026-11-21:work'].status, 'sent');
  assert.equal(saved.count, 1);
  await service.tick();
  assert.equal(sent.length, 1, '同一项不重复发送');
  assert.equal(service.lastSentAt !== '', true);
});

test('服务：渠道失败后标记，窗口内只重试一次', async () => {
  const state = new Map<string, any>();
  let calls = 0;
  const ctx: any = {
    signal: new AbortController().signal,
    logger: { warn() {}, info() {}, error() {} },
    config: {
      read: async (file: string) => state.get(file) ?? null,
      save: async (file: string, value: any) => { state.set(file, value); },
    },
    sessions: { list: async () => [{ id: 's' }], current: async () => 's', enqueueTransient: async () => '' },
    tools: { call: async () => { calls += 1; throw Error('QQ 未在线'); } },
  };
  const schedule: any = {
    config: normalizeConfig({ reminder: { enabled: true, channel: 'qq', account: '', peer: 'direct:20002', usePersona: false } }),
    read: async () => plan(),
  };
  const service = new ReminderService(ctx, schedule, () => at(8, 50));
  await service.tick();
  assert.equal(calls, 1);
  await service.tick();
  assert.equal(calls, 2);
  await service.tick();
  assert.equal(calls, 2, '两次失败后不再重试');
});

