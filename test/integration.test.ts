/*! 日程 plugin · 在临时宿主里真加载一遍：页面、接口、持久化、停用与 AI 润色。 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { boot } from '../../../core/index.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'whale-schedule-'));
  await mkdir(join(root, 'config'), { recursive: true });
  await mkdir(join(root, 'plugins'), { recursive: true });
  await cp(resolve('plugins/schedule'), join(root, 'plugins/schedule'), { recursive: true });
  await mkdir(join(root, 'plugins/schedule/sub/weather/data'), { recursive: true });
  await mkdir(join(root, 'plugins/schedule/data'), { recursive: true });
  await writeFile(join(root, 'plugins/schedule/data/config.json'), JSON.stringify({
    enabled: true,
    generateAt: '00:00',
    daysAhead: 5,
    keepDays: 60,
    routine: { work: { days: [1, 2, 3, 4, 5, 6, 7] } },
  }));
  await writeFile(join(root, 'plugins/schedule/sub/weather/data/config.json'), JSON.stringify({
    city: '示例城',
    latitude: 30,
    longitude: 120,
    refreshMinutes: 30,
    forecastDays: 7,
    timeoutSeconds: 2,
    apiBase: 'http://127.0.0.1:9',
    geocodingBase: 'http://127.0.0.1:9',
  }));
  await writeFile(join(root, 'config/config.json'), JSON.stringify({
    log: { level: 'error' },
    web: { port: 0 },
    providers: [{ id: 'test', name: 'Test', base_url: 'https://unused.example/v1', api_key: 'synthetic-secret' }],
    models: [{ id: 'chat', name: '测试模型', provider: 'test', model: 'test', type: 'chat', enabled: true, context_window: 200000 }],
    model_bindings: { chat: 'chat' },
    personas: { main: { name: '测试人格', file: 'main.md', model: 'chat', permission: 'full' } },
    channels: { web: { persona: 'main', permission: 'full' } },
    memory: { root: 'memory' },
  }));
  const app = await boot(root);
  const requests: any[] = [];
  app.llm.chat = async (input: any) => {
    requests.push(input);
    return { text: '{"tone":"轻快","note":"留一点空","fills":[]}', toolCalls: [], usage: { prompt_tokens: 20, completion_tokens: 4 } };
  };
  t.after(async () => {
    await app.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${app.web.server.address().port}`;
  const login = await fetch(url + '/api/login', { method: 'POST', body: '{}' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (path: string, body?: any) => fetch(url + path, {
    method: body ? 'POST' : 'GET',
    headers: { Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { root, app, url, request, requests };
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

test('插件加载：页面入口、自动补生成、编辑落盘、停用与重载', async (t) => {
  const { root, app, request } = await fixture(t);
  assert.equal(app.runtime.records.get('schedule')?.status, 'active');

  const status = await (await request('/api/status')).json();
  const pages = status.pluginPages.filter((entry: any) => entry.owner === 'schedule');
  assert.deepEqual(pages.map((entry: any) => [entry.path, entry.settings, entry.navigation]), [
    ['/plugins/schedule/settings', true, false],
    ['/plugins/schedule/calendar', false, true],
  ]);

  const settings = await request('/plugins/schedule/settings');
  assert.equal(settings.status, 200);
  const settingsHtml = await settings.text();
  assert.match(settingsHtml, /v0\.6\.0/, '设置页版本号应从 plugin.yaml 读取');
  assert.match(settingsHtml, /日程/);
  assert.match(settingsHtml, /主动提醒/);
  assert.match(settingsHtml, /reminderEnabled/);
  assert.match(settingsHtml, /节假日与假期/);
  assert.match(settingsHtml, /旅行/);
  assert.match(settingsHtml, /发送测试提醒/);

  const reminderConfig = await (await request('/plugins/schedule/config', {
    action: 'save',
    config: { enabled: true, reminder: { enabled: true, channel: 'qq', account: '10001', peer: 'direct:20002', leadMinutes: 8, maxPerDay: 4 } },
  })).json();
  assert.equal(reminderConfig.config.reminder.enabled, true);
  assert.equal(reminderConfig.config.reminder.account, '10001');
  assert.equal(reminderConfig.config.reminder.leadMinutes, 8);

  const calendarConfig = await (await request('/plugins/schedule/config', {
    action: 'save',
    config: {
      enabled: true,
      holiday: { enabled: true, builtin: true, student: true },
      travel: { enabled: false, weekend: true, shortHoliday: true, longHoliday: true, weekendEvery: 1, aiChoose: false },
    },
    holidayText: '寒假 | 2027-01-25 | 2027-02-20 | 寒暑假',
    holidayWorkdays: '2027-02-14',
    travelText: '示例目的地 | 远 | 3 | 5 | 2027-10-01~2027-10-05 | 测试',
  })).json();
  assert.equal(calendarConfig.config.holiday.student, true);
  assert.equal(calendarConfig.config.holiday.periods[0].kind, 'student');
  assert.deepEqual(calendarConfig.config.holiday.workdays, ['2027-02-14']);
  assert.equal(calendarConfig.config.travel.spots[0].name, '示例目的地');
  assert.equal(calendarConfig.config.travel.spots[0].from, '2027-10-01');

  const calendar = await request('/plugins/schedule/calendar');
  assert.equal(calendar.status, 200);
  assert.match(await calendar.text(), /重排这天/);

  const date = todayKey();
  const generated = await (await request('/plugins/schedule/generate', { date })).json();
  assert.equal(generated.ok, true);
  assert.ok(generated.plan.items.length > 5);
  assert.equal(generated.plan.items[generated.plan.items.length - 1].end, '24:00');

  const first = generated.plan.items[0];
  const done = await (await request('/plugins/schedule/item', { date, action: 'status', id: first.id, status: 'done' })).json();
  assert.equal(done.ok, true);
  assert.equal(done.plan.items[0].status, 'done');
  assert.equal(done.plan.edited, true);
  const saved = JSON.parse(await readFile(join(root, 'plugins/schedule/data/days', `${date}.json`), 'utf8'));
  assert.equal(saved.items[0].status, 'done');

  const toolNames = app.tools.list().map((tool: any) => tool.function.name).filter((name: string) => name.startsWith('schedule_'));
  assert.deepEqual(toolNames.sort(), ['schedule_edit', 'schedule_exception', 'schedule_generate', 'schedule_now', 'schedule_range', 'schedule_today']);
  const todayText = String((await app.tools.call('schedule_today', {}, { permission: 'full' })).result);
  assert.match(todayText, /起床/);
  const nowText = String((await app.tools.call('schedule_now', {}, { permission: 'full' })).result);
  assert.match(nowText, /现在 \d{2}:\d{2}/);
  const editText = String((await app.tools.call('schedule_edit', { action: 'status', id: 'i1', status: 'done' }, { permission: 'full' })).result);
  assert.match(editText, /已保存|没改成/);

  const data = await (await request('/plugins/schedule/data', { from: date, days: 3 })).json();
  assert.equal(data.ok, true);
  assert.equal(data.plans[0].plan.items[0].status, 'done');
  assert.equal(data.config.enabled, true);

  // 关掉自动生成后，不再补新的一天，但已有计划仍能读。
  const off = await (await request('/plugins/schedule/config', { action: 'save', config: { enabled: false } })).json();
  assert.equal(off.ok, true);
  assert.equal(off.config.enabled, false);
  const offlineText = String((await app.tools.call('schedule_today', {}, { permission: 'full' })).result);
  assert.match(offlineText, /起床|上班|上课/, '关掉自动生成后，已有计划仍能读');

  await app.runtime.action('schedule', 'stop');
  assert.equal((await request('/plugins/schedule/settings')).status, 404);
  const afterRestart = await app.runtime.action('schedule', 'start');
  assert.equal(afterRestart.status, 'active');
  const reloaded = await (await request('/plugins/schedule/data', { from: date, days: 1 })).json();
  assert.equal(reloaded.plans[0].plan.items[0].status, 'done', '重载后读到同一份计划');
  assert.equal(reloaded.config.enabled, false, '设置保留');
});

test('第一层：每轮注入当前与下一项', async (t) => {
  const { app, request } = await fixture(t);
  const date = todayKey();
  const generated = await (await request('/plugins/schedule/generate', { date, force: true })).json();
  assert.equal(generated.ok, true);

  const ambient = await app.context.render({ sessionId: 'synthetic', personaId: 'main', personaName: '测试人格', channel: 'web' });
  assert.match(ambient, /今天的日程/);
  assert.match(ambient, /正在：|现在没有正在进行的安排/);
  assert.match(ambient, /下一项：/);
  assert.match(ambient, /不用再调 schedule_now/);

  const other = await app.context.render({ sessionId: 'synthetic', personaId: 'other', personaName: '别人', channel: 'web' });
  assert.match(other, /今天的日程/, '其他人格也能读到同一份日程');

  const calls: any[] = [];
  app.llm.chat = async (input: any) => {
    calls.push(input);
    return { text: '嗯', toolCalls: [], usage: { prompt_tokens: 10, completion_tokens: 1 } };
  };
  const sessionId = await app.sessions.create('上下文测试');
  await app.sessions.chat(sessionId, '现在在干嘛', () => {}, undefined, 'main');
  const systemText = calls[0].messages.filter((message: any) => message.role === 'system').map((message: any) => message.content).join('\n');
  assert.match(systemText, /今天的日程/);
  assert.match(systemText, /正在：|现在没有正在进行的安排/);
});

test('主动提醒：设置页可保存目标，测试接口真的走 QQ 发送工具', async (t) => {
  const { app, request } = await fixture(t);
  const sent: any[] = [];
  app.tools.register({
    name: 'qq_send_message',
    description: '合成 QQ 发送',
    danger: 'full',
    schema: { type: 'object', properties: {
      userId: { type: 'string' }, messageId: { type: 'string' }, text: { type: 'string' },
    }, required: ['userId', 'messageId', 'text'], additionalProperties: false },
    run: async (args: any, session: any) => {
      sent.push({ args, session });
      return { status: 'sent', confirmed: true };
    },
  });
  await app.sessions.create('主动提醒测试');

  const saved = await (await request('/plugins/schedule/config', {
    action: 'save',
    config: { enabled: true, reminder: { enabled: true, channel: 'qq', account: 'bot', peer: 'direct:20002', leadMinutes: 6, maxPerDay: 3 } },
  })).json();
  assert.equal(saved.config.reminder.enabled, true);
  assert.equal(saved.config.reminder.leadMinutes, 6);

  const tested = await (await request('/plugins/schedule/reminder/test', {
    channel: 'qq', account: 'bot', peer: 'direct:20002', text: '测试主动提醒',
  })).json();
  assert.equal(tested.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args.userId, '20002');
  assert.equal(sent[0].args.text, '测试主动提醒');
  assert.equal(sent[0].args.messageId.startsWith('schedule-reminder-test:'), true);
});

test('异常日：一键覆盖当天且可撤销，周复盘能读到', async (t) => {
  const { app, request } = await fixture(t);
  const date = '2026-11-23'; // 周一
  const normal = await (await request('/plugins/schedule/generate', { date, force: true })).json();
  assert.ok(normal.plan.items.some((item: any) => item.kind === 'work'), '正常工作日应有正事');
  assert.ok(normal.plan.items.some((item: any) => item.kind === 'exercise'));

  const sick = await (await request('/plugins/schedule/exception', { date, action: 'set', kind: 'sick', note: '感冒了' })).json();
  assert.equal(sick.ok, true);
  assert.equal(sick.exception.kind, 'sick');
  assert.equal(sick.plan.exception.kind, 'sick');
  assert.equal(sick.plan.exception.note, '感冒了');
  assert.ok(!sick.plan.items.some((item: any) => item.kind === 'work'), '病假不排正事');
  assert.ok(!sick.plan.items.some((item: any) => item.kind === 'exercise'), '病假不排运动');
  assert.ok(!sick.plan.travel, '病假不排旅行');

  const data = await (await request('/plugins/schedule/data', { from: date, days: 1 })).json();
  assert.equal(data.exceptions.length, 1);
  assert.equal(data.exceptions[0].kind, 'sick');

  const review = await (await request('/plugins/schedule/review', { date })).json();
  assert.equal(review.ok, true);
  assert.equal(review.current.exceptionDays, 1);
  assert.deepEqual(review.current.exceptions, [{ title: '生病', count: 1 }]);

  const calendar = await (await request('/plugins/schedule/calendar')).text();
  assert.match(calendar, /异常日模式/);
  assert.match(calendar, /周复盘/);
  assert.match(calendar, /最常跳过/);

  const cleared = await (await request('/plugins/schedule/exception', { date, action: 'clear' })).json();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.plan.exception, undefined);
  assert.ok(cleared.plan.items.some((item: any) => item.kind === 'work'), '撤销后恢复正事');
});

test('重复规则：每月第 N 个周几只在该周生成，设置页可编辑', async (t) => {
  const { request } = await fixture(t);
  const saved = await (await request('/plugins/schedule/config', {
    action: 'save',
    config: {
      enabled: true,
      routine: {
        work: { enabled: true, title: '上班', days: [1], start: '09:00', end: '18:00', place: '公司', repeat: '每月第1个' },
      },
    },
  })).json();
  assert.equal(saved.config.routine.work.repeat, 'monthly:1');

  const settings = await (await request('/plugins/schedule/settings')).text();
  assert.match(settings, /name="workRepeat"/);
  assert.match(settings, /每月第1个/);

  const first = await (await request('/plugins/schedule/generate', { date: '2026-12-07', force: true })).json();
  assert.ok(first.plan.items.some((item: any) => item.kind === 'work'), '12-07 是 12 月第一个周一');
  const second = await (await request('/plugins/schedule/generate', { date: '2026-12-14', force: true })).json();
  assert.ok(!second.plan.items.some((item: any) => item.kind === 'work'), '12-14 不是第一个周一');
});

test('AI 润色：开启后用模型填空档，失败保留骨架', async (t) => {
  const { app, request, requests } = await fixture(t);
  const date = todayKey();
  const base = await (await request('/plugins/schedule/generate', { date, force: true })).json();
  assert.equal(base.plan.source, 'auto');

  const gaps = base.plan.items
    .filter((item: any) => item.auto && item.kind !== 'sleep')
    .map((item: any) => `${item.start}-${item.end}`);
  assert.ok(gaps.length > 0);

  const ai = await (await request('/plugins/schedule/config', {
    action: 'save',
    config: { enabled: true, ai: { enabled: true, model: 'chat', style: '' } },
  })).json();
  assert.equal(ai.config.ai.enabled, true);

  app.llm.chat = async (input: any) => {
    requests.push(input);
    const user = String(input.messages.find((message: any) => message.role === 'user')?.content ?? '');
    const gapText = user.split('可填的空档：')[1] ?? '';
    const match = /(\d{2}:\d{2})-(\d{2}:\d{2})/.exec(gapText);
    assert.ok(match, '提示里应带上空档');
    const startMinute = Number(match![1].slice(0, 2)) * 60 + Number(match![1].slice(3));
    const endMinute = startMinute + 60;
    const end = `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`;
    return {
      text: JSON.stringify({
        tone: '安静',
        note: '留一点空',
        fills: [{ start: match![1], end, title: '看两集剧', kind: 'free', note: '躺着' }],
      }),
      toolCalls: [],
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    };
  };

  const polished = await (await request('/plugins/schedule/generate', { date, force: true })).json();
  assert.equal(polished.plan.source, 'ai', String(polished.plan.aiError));
  assert.ok(polished.plan.items.some((item: any) => item.title === '看两集剧'));
  assert.equal(polished.plan.tone, '安静');
  assert.ok(requests.length >= 1);

  app.llm.chat = async () => { throw Error('模拟供应商失败'); };
  const fallback = await (await request('/plugins/schedule/generate', { date, force: true })).json();
  assert.equal(fallback.ok, true);
  assert.equal(fallback.plan.source, 'auto');
  assert.match(String(fallback.plan.aiError), /模拟供应商失败/);
});
