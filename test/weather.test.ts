/*! 日程 · 天气子插件：纯函数 + 临时宿主集成（本地假接口，不依赖外网）。 */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { boot } from '../../../core/index.ts';
import { codeInfo, dayTip, isWet, outdoorFriendly } from '../sub/weather/lib/wmo.ts';
import { forecastUrl, parseForecast } from '../sub/weather/lib/forecast.ts';
import { defaultConfig, normalizeConfig } from '../sub/weather/lib/config.ts';
import { defaultConfig as scheduleConfig } from '../lib/types.ts';
import { findCity } from '../sub/weather/lib/cities.ts';
import { applyWeatherRules, isHotDay, isWetDay, weatherKey } from '../lib/weather-rules.ts';

function localDate(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sampleForecast() {
  const dates = Array.from({ length: 7 }, (_, index) => localDate(index));
  return {
    latitude: 31.77359,
    longitude: 119.95401,
    timezone: 'Asia/Shanghai',
    current: {
      time: `${dates[0]}T10:15`,
      temperature_2m: 12.8,
      relative_humidity_2m: 40,
      apparent_temperature: 9.1,
      is_day: 1,
      precipitation: 0,
      weather_code: 0,
      wind_speed_10m: 11.2,
    },
    daily: {
      time: dates,
      weather_code: [0, 3, 61, 95, 71, 2, 1],
      temperature_2m_max: [16, 15, 13, 12, 4, 14, 17],
      temperature_2m_min: [7, 6, 8, 5, -2, 3, 8],
      precipitation_probability_max: [10, 20, 80, 90, 60, 5, 0],
      precipitation_sum: [0, 0, 5.2, 8, 3, 0, 0],
      wind_speed_10m_max: [12, 18, 20, 30, 22, 10, 9],
      sunrise: dates.map((date) => `${date}T06:30`),
      sunset: dates.map((date) => `${date}T17:05`),
    },
  };
}

test('天气纯函数：代码映射、建议、解析、城市表、配置校验', () => {
  assert.deepEqual(codeInfo(0), { text: '晴', icon: '☀️' });
  assert.equal(codeInfo(999).text, '未知天气');
  assert.equal(isWet(61), true);
  assert.equal(isWet(45), false);
  assert.equal(dayTip(95, 0, 10, 20), '有雷雨，别在户外久留');
  assert.equal(dayTip(61, 0, 10, 20), '记得带伞');
  assert.equal(dayTip(0, 10, 12, 35), '晒，注意防晒');
  assert.equal(outdoorFriendly(0, 10, 18), true);
  assert.equal(outdoorFriendly(61, 80, 18), false);

  const config = { ...defaultConfig(), apiBase: 'http://example.test', forecastDays: 5 };
  const url = new URL(forecastUrl(config, 31.77359, 119.95401));
  assert.equal(url.pathname, '/v1/forecast');
  assert.equal(url.searchParams.get('forecast_days'), '5');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.match(url.searchParams.get('current') ?? '', /temperature_2m/);

  const snapshot = parseForecast(sampleForecast(), { place: '常州', latitude: 31.7, longitude: 119.9 });
  assert.equal(snapshot.days.length, 7);
  assert.equal(snapshot.now?.temperature, 12.8);
  assert.equal(snapshot.now?.text, '晴');
  assert.equal(snapshot.days[2].text, '小雨');
  assert.equal(snapshot.days[2].precipitationProbability, 80);
  assert.equal(snapshot.days[3].tip, '有雷雨，别在户外久留');
  assert.equal(snapshot.timezone, 'Asia/Shanghai');

  assert.equal(findCity('常州')?.latitude, 31.77359);
  assert.equal(findCity('常州市')?.name, '常州');
  assert.equal(findCity('不存在的城市'), null);

  const normalized = normalizeConfig({ latitude: '200', longitude: 'abc', refreshMinutes: 1, forecastDays: 99, timeoutSeconds: 99 });
  assert.equal(normalized.latitude, null);
  assert.equal(normalized.longitude, null);
  assert.equal(normalized.refreshMinutes, 5);
  assert.equal(normalized.forecastDays, 7);
  assert.equal(normalized.timeoutSeconds, 30);
});

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'whale-weather-'));
  await mkdir(join(root, 'config'), { recursive: true });
  await mkdir(join(root, 'plugins'), { recursive: true });
  await cp(resolve('plugins/schedule'), join(root, 'plugins/schedule'), { recursive: true });
  await writeFile(join(root, 'config/config.json'), JSON.stringify({
    log: { level: 'error' },
    web: { port: 0 },
    providers: [],
    models: [],
    memory: { root: 'memory' },
  }));

  let forecastCalls = 0;
  let geocodeCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (url.pathname === '/v1/forecast') {
      forecastCalls += 1;
      res.end(JSON.stringify(sampleForecast()));
      return;
    }
    if (url.pathname === '/v1/search') {
      geocodeCalls += 1;
      res.end(JSON.stringify({ results: [{ name: 'Testville', admin1: 'Test', latitude: 1.23456, longitude: 7.89012 }] }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as any).port;

  await mkdir(join(root, 'plugins/schedule/sub/weather/data'), { recursive: true });
  await writeFile(join(root, 'plugins/schedule/sub/weather/data/config.json'), JSON.stringify({
    city: '常州',
    latitude: 31.77359,
    longitude: 119.95401,
    refreshMinutes: 30,
    forecastDays: 7,
    timeoutSeconds: 4,
    apiBase: `http://127.0.0.1:${port}`,
    geocodingBase: `http://127.0.0.1:${port}`,
  }));

  const app = await boot(root);
  t.after(async () => {
    await app.close();
    server.close();
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
  return { root, app, request, calls: () => ({ forecastCalls, geocodeCalls }) };
}

test('天气规则：雨雪改室内、周末好天气留出门、预报类别变化可识别', () => {
  const base = scheduleConfig();
  const routine = { ...base.routine, exercise: { ...base.routine.exercise, enabled: true, title: '散步', days: [6], start: '19:00', minutes: 40 } };
  const rainy = {
    date: '2026-11-21',
    code: 61,
    text: '小雨',
    icon: '🌦️',
    min: 8,
    max: 14,
    precipitation: 5,
    precipitationProbability: 80,
    windMax: 18,
    sunrise: '2026-11-21T06:30',
    sunset: '2026-11-21T17:05',
    tip: '记得带伞',
    outdoor: false,
  };
  const nice = {
    ...rainy,
    code: 0,
    text: '晴',
    icon: '☀️',
    min: 12,
    max: 21,
    precipitation: 0,
    precipitationProbability: 10,
    windMax: 10,
    tip: '适合出门走走',
    outdoor: true,
  };
  const plan = {
    version: 1 as const,
    date: '2026-11-21',
    weekday: 6,
    tone: '安静',
    note: '',
    source: 'auto' as const,
    routineHash: 'test',
    generatedAt: new Date().toISOString(),
    edited: false,
    items: [
      { id: 'i1', start: '10:00', end: '11:00', title: '自由 · 出去走走', kind: 'free' as const, status: 'pending' as const, auto: true },
      { id: 'i2', start: '14:00', end: '15:00', title: '自由 · 看剧', kind: 'free' as const, status: 'pending' as const, auto: true },
      { id: 'i3', start: '19:00', end: '19:40', title: '散步', kind: 'exercise' as const, status: 'pending' as const },
    ],
  };

  assert.equal(isWetDay(rainy), true);
  assert.equal(isHotDay(rainy), false);
  assert.notEqual(weatherKey(rainy), weatherKey(nice));

  const wetPlan = applyWeatherRules(plan, rainy, routine);
  assert.equal(wetPlan.weather?.text, '小雨');
  assert.equal(wetPlan.items[0].title.includes('出去走走'), false, '雨天户外空档应换掉');
  assert.match(wetPlan.items[0].note ?? '', /小雨|室内/);
  assert.equal(wetPlan.items[2].title, '室内 · 散步');
  assert.match(wetPlan.items[2].note ?? '', /小雨/);
  assert.ok(wetPlan.weatherAdjusted?.some((text) => text.includes('运动改室内')));

  const nicePlan = applyWeatherRules(plan, nice, routine);
  assert.ok(nicePlan.items.some((item) => item.title.includes('出去走走')), '周末好天气应留出门时间');
  assert.ok(nicePlan.items.some((item) => (item.note ?? '').includes('天气好')), '出门安排应带上天气说明');
  assert.ok(nicePlan.weatherAdjusted?.includes('天气好，留了出门时间'));
});

test('天气子插件：独立页面、缓存、地理编码、父插件天气条与工具', async (t) => {
  const { app, request, calls } = await fixture(t);
  assert.equal(app.runtime.records.get('schedule/weather')?.status, 'active');
  assert.equal(app.runtime.records.get('schedule')?.status, 'active');

  const page = await request('/plugins/schedule/weather/settings');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /未来 7 天/);
  assert.match(html, /12\.8/);
  assert.match(html, /常州/);

  const data = await (await request('/plugins/schedule/weather/data', { force: false })).json();
  assert.equal(data.ok, true);
  assert.equal(data.snapshot.days.length, 7);
  assert.equal(data.snapshot.now.temperature, 12.8);

  const cached = await (await request('/plugins/schedule/weather/data', { force: false })).json();
  assert.equal(cached.ok, true);
  assert.equal(calls().forecastCalls, 1, '刷新间隔内复用缓存');

  const forced = await (await request('/plugins/schedule/weather/data', { force: true })).json();
  assert.equal(calls().forecastCalls, 2, 'force 会重新请求');

  const local = await (await request('/plugins/schedule/weather/config', { action: 'geocode', city: '常州' })).json();
  assert.equal(local.ok, true);
  assert.equal(local.result.latitude, 31.77359);
  assert.equal(local.result.source, '常用城市表');

  const remote = await (await request('/plugins/schedule/weather/config', { action: 'geocode', city: 'Testville' })).json();
  assert.equal(remote.ok, true);
  assert.equal(remote.result.name, 'Testville');
  assert.equal(calls().geocodeCalls, 1);

  const parentData = await (await request('/plugins/schedule/data', { from: localDate(), days: 3 })).json();
  assert.equal(parentData.ok, true);
  assert.equal(parentData.weather.days.length, 7);
  assert.ok(parentData.weather.updatedAt);

  const generated = await (await request('/plugins/schedule/generate', { date: localDate(), force: true })).json();
  assert.equal(generated.ok, true);
  assert.equal(generated.plan.weather?.text, '晴');
  assert.equal(generated.plan.weatherKey, '0001');
  const todayText = String((await app.tools.call('schedule_today', {}, { permission: 'full' })).result);
  assert.match(todayText, /天气：常州 · 晴/);
  const nowText = String((await app.tools.call('schedule_now', {}, { permission: 'full' })).result);
  assert.match(nowText, /天气：/);

  const now = String((await app.tools.call('weather_now', {}, { permission: 'full' })).result);
  assert.match(now, /常州/);
  assert.match(now, /12\.8℃/);
  const forecast = String((await app.tools.call('weather_forecast', { days: 3 }, { permission: 'full' })).result);
  assert.match(forecast, /未来|今天|明天|周/);
});

test('天气子插件停用：父插件不受影响，恢复后重新接上', async (t) => {
  const { app, request } = await fixture(t);
  const before = await request('/plugins/schedule/settings');
  assert.equal(before.status, 200);

  await app.runtime.action('schedule/weather', 'stop');
  assert.equal(app.runtime.records.get('schedule/weather')?.status, 'stopped');
  assert.equal(app.runtime.records.get('schedule')?.status, 'active');
  // 等可选服务回调撤销。
  await new Promise((resolve) => setTimeout(resolve, 300));
  const after = await (await request('/plugins/schedule/settings')).text();
  assert.match(after, /子插件未启用/);

  const plan = await (await request('/plugins/schedule/generate', { date: localDate(), force: true })).json();
  assert.equal(plan.ok, true);
  const text = String((await app.tools.call('schedule_today', {}, { permission: 'full' })).result);
  assert.match(text, /起床/);

  const restart = await app.runtime.action('schedule/weather', 'start');
  assert.equal(restart.status, 'active');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const weatherPage = await request('/plugins/schedule/weather/settings');
  assert.equal(weatherPage.status, 200);
  const back = await (await request('/plugins/schedule/settings')).text();
  assert.match(back, /子插件已连接|还没有取到天气|常州/);
});
