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
  await writeFile(join(root, 'plugins/schedule/sub/weather/data/config.json'), JSON.stringify({
    city: '常州',
    latitude: 31.77359,
    longitude: 119.95401,
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
    personas: { whale: { name: '周小迟', file: 'whale.md', model: 'chat', permission: 'full' } },
    channels: { web: { persona: 'whale', permission: 'full' } },
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
  assert.match(await settings.text(), /日程/);

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
  assert.deepEqual(toolNames.sort(), ['schedule_edit', 'schedule_generate', 'schedule_now', 'schedule_range', 'schedule_today']);
  const todayText = String((await app.tools.call('schedule_today', {}, { permission: 'full' })).result);
  assert.match(todayText, /起床/);
  assert.match(todayText, /上班|上课/);
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

  const ambient = await app.context.render({ sessionId: 'synthetic', personaId: 'whale', personaName: '周小迟', channel: 'web' });
  assert.match(ambient, /周小迟的今日日程/);
  assert.match(ambient, /正在：|现在没有正在进行的安排/);
  assert.match(ambient, /下一项：/);
  assert.match(ambient, /不用再调 schedule_now/);

  const other = await app.context.render({ sessionId: 'synthetic', personaId: 'other', personaName: '别人', channel: 'web' });
  assert.equal(other, '', '只给迟宝注入，不打扰其他人格');

  const calls: any[] = [];
  app.llm.chat = async (input: any) => {
    calls.push(input);
    return { text: '嗯', toolCalls: [], usage: { prompt_tokens: 10, completion_tokens: 1 } };
  };
  const sessionId = await app.sessions.create('上下文测试');
  await app.sessions.chat(sessionId, '现在在干嘛', () => {}, undefined, 'whale');
  const systemText = calls[0].messages.filter((message: any) => message.role === 'system').map((message: any) => message.content).join('\n');
  assert.match(systemText, /周小迟的今日日程/);
  assert.match(systemText, /正在：|现在没有正在进行的安排/);
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
    return {
      text: JSON.stringify({
        tone: '安静',
        note: '留一点空',
        fills: [{ start: match![1], end: match![2], title: '看两集剧', kind: 'free', note: '躺着' }],
      }),
      toolCalls: [],
      usage: { prompt_tokens: 30, completion_tokens: 10 },
    };
  };

  const polished = await (await request('/plugins/schedule/generate', { date, force: true })).json();
  assert.equal(polished.plan.source, 'ai');
  assert.ok(polished.plan.items.some((item: any) => item.title === '看两集剧'));
  assert.equal(polished.plan.tone, '安静');
  assert.equal(requests.length, 1);

  app.llm.chat = async () => { throw Error('模拟供应商失败'); };
  const fallback = await (await request('/plugins/schedule/generate', { date, force: true })).json();
  assert.equal(fallback.ok, true);
  assert.equal(fallback.plan.source, 'auto');
  assert.match(String(fallback.plan.aiError), /模拟供应商失败/);
});
