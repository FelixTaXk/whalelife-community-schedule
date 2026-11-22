/*! 日程 plugin · 人格日记纯函数测试。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJournalPrompt, derivedJournalMinute, journalMinute, parseJournalReply, personaDir, styleOf } from '../lib/journal.ts';
import { defaultConfig, normalizeConfig, type JournalConfig } from '../lib/types.ts';

function journalConfig(overrides: Partial<JournalConfig> = {}): JournalConfig {
  return { ...defaultConfig().journal, ...overrides };
}

test('日记时间：留空按睡前洗漱推算，自定义时间优先', () => {
  assert.equal(derivedJournalMinute({ sleep: '23:30', windDownMinutes: 30 }), 22 * 60 + 55);
  assert.equal(derivedJournalMinute({ sleep: '00:30', windDownMinutes: 30 }), 23 * 60 + 55, '跨午夜也落在当天睡前');
  assert.equal(journalMinute(journalConfig({ at: '21:15' }), { sleep: '23:30', windDownMinutes: 30 }), 21 * 60 + 15);
  assert.equal(journalMinute(journalConfig({ at: '' }), { sleep: '08:00', windDownMinutes: 20 }), 7 * 60 + 35);
});

test('配置：日记默认关闭、不预设任何人格或模型，文风可自定义', () => {
  const config = defaultConfig();
  assert.equal(config.journal.enabled, false);
  assert.equal(config.journal.persona, '');
  assert.equal(config.journal.model, '');
  assert.equal(config.journal.at, '');
  assert.equal(config.journal.style, 'natural');

  const normalized = normalizeConfig({ journal: { enabled: true, persona: 'p1', style: 'custom', customStyle: '短句', useWeather: false } });
  assert.equal(normalized.journal.enabled, true);
  assert.equal(normalized.journal.persona, 'p1');
  assert.equal(normalized.journal.style, 'custom');
  assert.equal(normalized.journal.customStyle, '短句');
  assert.equal(normalized.journal.useWeather, false);
  assert.equal(normalized.journal.model, '', '没有预设模型');
});

test('人格目录：不同人格不会写到同一个目录', () => {
  assert.notEqual(personaDir('main'), personaDir('other'));
  assert.equal(personaDir('main'), personaDir('main'));
  assert.match(personaDir('main'), /^[a-f0-9]{16}$/);
});

test('文风：预设文风有独立提示，自定义文风原样进入提示', () => {
  assert.match(styleOf(journalConfig({ style: 'warm' })).prompt, /温柔/);
  const custom = styleOf(journalConfig({ style: 'custom', customStyle: '像深夜和自己说话，句子短一点。' }));
  assert.equal(custom.id, 'custom');
  assert.match(custom.prompt, /深夜/);
});

test('日记提示：只带当天事实、天气、穿搭和文风，不带聊天原文', () => {
  const prompt = buildJournalPrompt({
    date: '2026-11-22',
    language: 'zh-CN',
    personaName: '小满',
    style: { name: '自然记录', prompt: '具体、平静。' },
    customSample: '',
    facts: { items: 3, done: 1, skipped: 1, weather: '晴，12–20°C，降水 10%', wardrobe: '米白针织和长裙' },
    plan: {
      date: '2026-11-22', tone: '安静', note: '', source: 'auto', edited: false, weatherAdjusted: [], items: [
        { id: 'i1', start: '09:00', end: '10:00', title: '整理房间', kind: 'chore', status: 'done' },
      ],
    } as any,
  });
  assert.match(prompt.system, /小满/);
  assert.match(prompt.system, /具体、平静/);
  assert.doesNotMatch(prompt.user, /聊天|对话|消息记录/);
  assert.match(prompt.user, /天气：晴/);
  assert.match(prompt.user, /穿搭：米白针织/);
  assert.match(prompt.user, /整理房间（完成）/);
});

test('解析模型返回：JSON、围栏、纯文本和失败都能处理', () => {
  const json = parseJournalReply('```json\n{"title":"今天","body":"今天把房间收拾干净了，窗台也擦了一遍。","mood":"平静","tags":["家务"]}\n```', '2026-11-22', '2026-11-22 日记');
  assert.equal(json?.title, '今天');
  assert.equal(json?.mood, '平静');
  assert.deepEqual(json?.tags, ['家务']);

  const plain = parseJournalReply('今天只是坐着看了一会儿窗外，什么都没做，也没有勉强自己。', '2026-11-22', '2026-11-22 日记');
  assert.equal(plain?.body, '今天只是坐着看了一会儿窗外，什么都没做，也没有勉强自己。');
  assert.equal(plain?.title, '2026-11-22 日记');

  assert.equal(parseJournalReply('{"body":"太短"}', '2026-11-22', '日记'), null);
  assert.equal(parseJournalReply('', '2026-11-22', '日记'), null);
});
