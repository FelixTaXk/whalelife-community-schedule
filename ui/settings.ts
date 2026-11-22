/*! 日程 plugin · 设置页。 */

import type { Config } from '../lib/types.ts';
import { PRESETS } from '../lib/types.ts';
import { repeatInput } from '../lib/recurrence.ts';
import { BASE_CSS, escapeHtml } from './theme.ts';

export type SettingsData = {
  config: Config;
  fixedText: string;
  hobbiesText: string;
  holidayText: string;
  holidayWorkdays: string;
  travelText: string;
  models: Array<{ id: string; name: string; callable: boolean }>;
  status: { lastError: string; lastTickAt: string; reminderLastError?: string; reminderLastSentAt?: string };
  weather: { available: boolean; summary: string };
  today: string;
  version: string;
};

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

function chips(name: string, selected: number[]): string {
  return WEEK.map((label, index) => {
    const value = index + 1;
    const checked = selected.includes(value) ? ' checked' : '';
    return `<label class="chip"><input type="checkbox" name="${name}" value="${value}"${checked}>周${label}</label>`;
  }).join('');
}

function options(models: SettingsData['models'], selected: string): string {
  const list = models.map((model) => `<option value="${escapeHtml(model.id)}"${model.id === selected ? ' selected' : ''}>${escapeHtml(model.name)}${model.callable ? '' : '（当前不可调用）'}</option>`);
  return `<option value=""${selected ? '' : ' selected'}>不选择（只用规则骨架）</option>${list.join('')}`;
}

export function settingsPage(data: SettingsData): string {
  const { config: cfg, fixedText, hobbiesText, holidayText, holidayWorkdays, travelText, models, status } = data;
  const presetOptions = PRESETS.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} · ${escapeHtml(preset.hint)}</option>`).join('');
  const aiHint = models.length
    ? '开启后会调用所选模型，把空档换成具体安排（每次约一次请求，45 秒超时；失败保留规则骨架）。'
    : '当前没有可用的对话模型：先在 WhaleLife 的「模型」页配好一个 OpenAI 兼容的对话模型，再回来选。';
  const tickLine = status.lastTickAt
    ? `上次自动检查：${escapeHtml(new Date(status.lastTickAt).toLocaleString('zh-CN'))}`
    : '还没跑过自动检查（启用后每分钟检查一次）。';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日程 · 设置</title><style>${BASE_CSS}</style></head><body><main>
<header>
  <div>
    <h1>日程</h1>
    <p class="sub">按作息自动排一天的安排 · v${escapeHtml(data.version)} · 今天 ${escapeHtml(data.today)}</p>
  </div>
  <div class="row" style="margin:0"><button type="button" id="regen">重排今天</button></div>
</header>

${status.lastError ? `<div class="alert bad"><b>上次生成出错</b><br>${escapeHtml(status.lastError)}</div>` : ''}

<section class="card">
  <h2>天气 <span class="pill ${data.weather.available ? 'good' : 'warn'}">${data.weather.available ? '子插件已连接' : '子插件未启用'}</span></h2>
  <p class="hint" style="white-space:pre-line;margin:0 0 10px">${escapeHtml(data.weather.summary)}</p>
  <p class="hint" style="margin:0 0 10px">生成日程时会参考当天天气：雨雪、雷暴、高温把运动和户外空档改成室内；周末天气好会留一段出门时间。预报类别变化会自动重排，手动改过的计划不动。</p>
  ${data.weather.available ? '<a href="/plugins/schedule/weather/settings" style="text-decoration:none"><button type="button">打开天气设置</button></a>' : ''}
</section>

<form id="form">
<section class="card">
  <h2>自动生成 <span class="pill ${cfg.enabled ? 'good' : ''}">${cfg.enabled ? '已开启' : '已关闭'}</span></h2>
  <div class="grid">
    <label class="check wide"><input type="checkbox" name="enabled"${cfg.enabled ? ' checked' : ''}> 启用自动生成（关掉后不再新建日程，已有计划仍可查看）</label>
    <label>每天生成时间<input type="time" name="generateAt" value="${escapeHtml(cfg.generateAt)}"></label>
    <label>预生成天数（含今天）<input type="number" name="daysAhead" min="1" max="7" value="${cfg.daysAhead}"></label>
    <label>历史保留天数<input type="number" name="keepDays" min="7" max="365" value="${cfg.keepDays}"></label>
  </div>
  <p class="hint">${tickLine} 过了生成时间会补上今天和后面几天；跨天打开软件会先补今天。</p>
</section>

<section class="card">
  <h2>作息</h2>
  <div class="row" style="margin:0 0 14px">
    <select id="preset" style="max-width:340px">${presetOptions}</select>
    <button type="button" id="applyPreset">套用模板</button>
    <span class="hint" style="margin:0">模板会覆盖下面所有作息字段，AI 与保留天数不变。</span>
  </div>
  <div class="grid3">
    <label>起床<input type="time" name="wake" value="${escapeHtml(cfg.routine.wake)}"></label>
    <label>睡觉<input type="time" name="sleep" value="${escapeHtml(cfg.routine.sleep)}"></label>
    <label>起床后洗漱（分钟）<input type="number" name="wakeMinutes" min="10" max="180" value="${cfg.routine.wakeMinutes}"></label>
    <label>早餐（分钟，0 = 不排）<input type="number" name="breakfastMinutes" min="0" max="120" value="${cfg.routine.breakfastMinutes}"></label>
    <label>单程通勤（分钟）<input type="number" name="commuteMinutes" min="0" max="180" value="${cfg.routine.commuteMinutes}"></label>
    <label>睡前洗漱（分钟）<input type="number" name="windDownMinutes" min="0" max="120" value="${cfg.routine.windDownMinutes}"></label>
  </div>
  <p class="hint">睡觉早于起床时间时按「次日」算，晚上会留出睡前洗漱，末尾显示睡觉时间。</p>
</section>

<section class="card">
  <h2>正事（上课 / 上班）</h2>
  <div class="grid">
    <label class="check wide"><input type="checkbox" name="workEnabled"${cfg.routine.work.enabled ? ' checked' : ''}> 这几天要上课 / 上班</label>
    <label>名称<input type="text" name="workTitle" maxlength="12" value="${escapeHtml(cfg.routine.work.title)}" placeholder="上课 / 上班"></label>
    <label>地点<input type="text" name="workPlace" maxlength="20" value="${escapeHtml(cfg.routine.work.place)}" placeholder="学校 / 公司"></label>
    <label>开始<input type="time" name="workStart" value="${escapeHtml(cfg.routine.work.start)}"></label>
    <label>结束<input type="time" name="workEnd" value="${escapeHtml(cfg.routine.work.end)}"></label>
    <div class="wide"><span class="muted">哪几天</span><div class="days" style="margin-top:6px">${chips('workDays', cfg.routine.work.days)}</div></div>
    <label class="wide">重复规则（可空，默认每周）<input type="text" name="workRepeat" maxlength="80" value="${escapeHtml(repeatInput(cfg.routine.work.repeat ?? ''))}" placeholder="双周 @2026-11-16 / 每月第2个 / 每月最后"></label>
  </div>
</section>

<section class="card">
  <h2>三餐与运动</h2>
  <div class="grid3">
    <label class="check"><input type="checkbox" name="lunchEnabled"${cfg.routine.lunch.enabled ? ' checked' : ''}> 排午饭</label>
    <label>午饭时间<input type="time" name="lunchStart" value="${escapeHtml(cfg.routine.lunch.start)}"></label>
    <label>午饭时长（分钟）<input type="number" name="lunchMinutes" min="10" max="240" value="${cfg.routine.lunch.minutes}"></label>
    <label class="check"><input type="checkbox" name="dinnerEnabled"${cfg.routine.dinner.enabled ? ' checked' : ''}> 排晚饭</label>
    <label>晚饭时间<input type="time" name="dinnerStart" value="${escapeHtml(cfg.routine.dinner.start)}"></label>
    <label>晚饭时长（分钟）<input type="number" name="dinnerMinutes" min="10" max="240" value="${cfg.routine.dinner.minutes}"></label>
    <label class="check"><input type="checkbox" name="exerciseEnabled"${cfg.routine.exercise.enabled ? ' checked' : ''}> 排运动</label>
    <label>运动名称<input type="text" name="exerciseTitle" maxlength="12" value="${escapeHtml(cfg.routine.exercise.title)}"></label>
    <label>运动时间<input type="time" name="exerciseStart" value="${escapeHtml(cfg.routine.exercise.start)}"></label>
    <label>运动时长（分钟）<input type="number" name="exerciseMinutes" min="10" max="180" value="${cfg.routine.exercise.minutes}"></label>
    <div class="wide"><span class="muted">哪几天运动</span><div class="days" style="margin-top:6px">${chips('exerciseDays', cfg.routine.exercise.days)}</div></div>
    <label class="wide">重复规则（可空，默认每周）<input type="text" name="exerciseRepeat" maxlength="80" value="${escapeHtml(repeatInput(cfg.routine.exercise.repeat ?? ''))}" placeholder="双周 @2026-11-16 / 每月第1个 / 每月最后"></label>
  </div>
</section>

<section class="card">
  <h2>固定安排 <span class="pill">可选</span></h2>
  <label>每行一条：标题 | 星期/重复规则 | 开始 | 分钟 | 地点
    <textarea name="fixedText" spellcheck="false" placeholder="买日用品 | 1,3,5 | 17:20 | 20 | 超市&#10;和朋友吃饭 | 6 | 15:00 | 90 | 餐厅&#10;值夜班 | 双周 5 @2026-11-16 | 21:00 | 120 | 公司">${escapeHtml(fixedText)}</textarea>
  </label>
  <p class="hint">星期写 1–7（周一 = 1），或 每天 / 工作日 / 周末。第二列还能加重复规则：<b>双周 1,3,5 @2026-11-16</b>（以该日期所在周为基准隔周）、<b>每月第2个 3</b>、<b>每月最后 5</b>；用 <b>!2026-12-01</b> 排除某天。固定安排优先级最高，会和正事、三餐自动让位。</p>
  <label>爱好池（空档从这里轮着挑，一行一个或用顿号分隔）
    <textarea name="hobbies" spellcheck="false">${escapeHtml(hobbiesText)}</textarea>
  </label>
</section>

<section class="card">
  <h2>节假日与假期 <span class="pill ${cfg.holiday.enabled ? 'good' : ''}">${cfg.holiday.enabled ? '已开启' : '已关闭'}</span></h2>
  <div class="grid">
    <label class="check wide"><input type="checkbox" name="holidayEnabled"${cfg.holiday.enabled ? ' checked' : ''}> 识别法定节假日，假期不排上课 / 上班</label>
    <label class="check wide"><input type="checkbox" name="holidayBuiltin"${cfg.holiday.builtin ? ' checked' : ''}> 使用内置中国 2026–2027 法定节假日和官方调休日（可选）</label>
    <label class="check wide"><input type="checkbox" name="holidayStudent"${cfg.holiday.student ? ' checked' : ''}> 学生模式：寒暑假、春秋假也跳过正事（只认下面 type 为寒暑假的条目）</label>
    <div class="wide"><span class="muted">哪几天算周末</span><div class="days" style="margin-top:6px">${chips('holidayWeekendDays', cfg.holiday.weekendDays ?? [6, 7])}</div></div>
  </div>
  <label>自定义假期（每行：名称 | 开始 | 结束 | 短假/长假/寒暑假）
    <textarea name="holidayText" spellcheck="false" placeholder="寒假 | 2027-01-25 | 2027-02-20 | 寒暑假&#10;春假 | 2027-04-01 | 2027-04-07 | 长假&#10;自定义短假 | 2027-06-01 | 2027-06-03 | 短假">${escapeHtml(holidayText)}</textarea>
  </label>
  <label>额外调休上班日（可空，每行一个 YYYY-MM-DD，或「日期 | 名称」）
    <textarea name="holidayWorkdays" spellcheck="false" placeholder="2027-02-14&#10;2027-10-09">${escapeHtml(holidayWorkdays)}</textarea>
  </label>
  <p class="hint">默认不套用任何国家的节假日表；中国用户可打开内置表，其他地区用自定义假期和额外调休日。普通周末默认不排正事，按上面的「周末」和作息里的星期决定；调休上班日强制按工作日。寒暑假 / 春秋假没有全国统一日期，需要按学校日历填；内置表只到 2027 年，之后用自定义假期补。</p>
</section>

<section class="card">
  <h2>旅行 <span class="pill ${cfg.travel.enabled ? 'warn' : ''}">${cfg.travel.enabled ? '已开启' : '默认关闭'}</span></h2>
  <div class="grid">
    <label class="check wide"><input type="checkbox" name="travelEnabled"${cfg.travel.enabled ? ' checked' : ''}> 在周末和假期自动安排旅行</label>
    <label class="check"><input type="checkbox" name="travelWeekend"${cfg.travel.weekend ? ' checked' : ''}> 周末短途</label>
    <label class="check"><input type="checkbox" name="travelShort"${cfg.travel.shortHoliday ? ' checked' : ''}> 3 天左右短假</label>
    <label class="check"><input type="checkbox" name="travelLong"${cfg.travel.longHoliday ? ' checked' : ''}> 长假期（3 天以上）远途</label>
    <label>周末频率（1 = 每周，2 = 隔周）<input type="number" name="travelEvery" min="1" max="4" value="${cfg.travel.weekendEvery}"></label>
    <label class="check wide"><input type="checkbox" name="travelAi"${cfg.travel.aiChoose ? ' checked' : ''}> 让 AI 从地点池里选目的地（失败自动按规则选）</label>
    <label>指定目的地（可空，优先于地点池和 AI）<input type="text" name="travelTarget" maxlength="24" value="${escapeHtml(cfg.travel.target)}" placeholder="例如：想去的地方"></label>
    <label>指定从<input type="date" name="travelTargetFrom" value="${escapeHtml(cfg.travel.targetFrom)}"></label>
    <label>指定到<input type="date" name="travelTargetTo" value="${escapeHtml(cfg.travel.targetTo)}"></label>
    <label class="wide">旅行偏好（可空）<textarea name="travelStyle" maxlength="300" placeholder="例如：喜欢自然风景和博物馆，少爬山；周末车程不超过 2 小时；长假可以坐高铁。">${escapeHtml(cfg.travel.style)}</textarea></label>
  </div>
  <label>地点池（每行：地点 | 近/远 | 最少天 | 最多天 | 指定日期段(可空) | 备注）
    <textarea name="travelText" spellcheck="false" placeholder="城市公园 | 近 | 1 | 1 | | 适合周末一日游&#10;附近城市 | 远 | 3 | 5 | 2027-10-01~2027-10-05 | 提前订票&#10;郊外古镇 | 近 | 1 | 2 | | 半天车程">${escapeHtml(travelText)}</textarea>
  </label>
  <p class="hint">「近」用于周末和 3 天左右短假，「远」用于长假期。指定日期段可以让某个地点只对某次假期生效；留空则由规则或 AI 选。旅行会占 08:30–20:30 的大块时间，三餐会把它切开，旅行日不再排运动。</p>
</section>

<section class="card">
  <h2>AI 润色 <span class="pill ${cfg.ai.enabled ? 'warn' : ''}">${cfg.ai.enabled ? '已开启' : '默认关闭'}</span></h2>
  <div class="grid">
    <label class="check wide"><input type="checkbox" name="aiEnabled" id="aiEnabled"${cfg.ai.enabled ? ' checked' : ''}> 用模型把空档换成更具体的安排</label>
    <label>模型<select name="aiModel" id="aiModel">${options(models, cfg.ai.model)}</select></label>
    <label>额外要求（可空）<textarea name="aiStyle" maxlength="300" placeholder="例如：晚上尽量别排新的事；周末留一点出门的时间。">${escapeHtml(cfg.ai.style)}</textarea></label>
  </div>
  <p class="hint">${aiHint}</p>
</section>

<section class="card">
  <h2>主动提醒 <span class="pill ${cfg.reminder.enabled ? 'warn' : ''}">${cfg.reminder.enabled ? '已开启' : '默认关闭'}</span></h2>
  <div class="grid">
    <label class="check wide"><input type="checkbox" name="reminderEnabled"${cfg.reminder.enabled ? ' checked' : ''}> 到关键节点主动发一条消息</label>
    <label>渠道 ID（目前只支持 qq）<input type="text" name="reminderChannel" maxlength="40" value="${escapeHtml(cfg.reminder.channel)}" placeholder="qq"></label>
    <label>账号（QQ 可空）<input type="text" name="reminderAccount" maxlength="40" value="${escapeHtml(cfg.reminder.account)}" placeholder="非 QQ 渠道才需要"></label>
    <label>联系人 peer<input type="text" name="reminderPeer" maxlength="80" value="${escapeHtml(cfg.reminder.peer)}" placeholder="direct:你的QQ号"></label>
    <label>提前分钟<input type="number" name="reminderLead" min="0" max="60" value="${cfg.reminder.leadMinutes}"></label>
    <label>每天最多<input type="number" name="reminderMax" min="1" max="20" value="${cfg.reminder.maxPerDay}"></label>
    <label>安静开始<input type="time" name="reminderQuietStart" value="${escapeHtml(cfg.reminder.quietStart)}"></label>
    <label>安静结束<input type="time" name="reminderQuietEnd" value="${escapeHtml(cfg.reminder.quietEnd)}"></label>
    <label>人格 ID（可空 = 宿主当前人格）<input type="text" name="reminderPersona" maxlength="40" value="${escapeHtml(cfg.reminder.persona)}" placeholder="留空即用当前人格"></label>
    <label class="check wide"><input type="checkbox" name="reminderUsePersona"${cfg.reminder.usePersona ? ' checked' : ''}> 用该人格的语气生成，不只是一句模板</label>
  </div>
  <p class="hint">只提醒起床、正事、通勤、三餐、运动、固定安排、旅行和睡觉；自由空档不提醒。QQ 私聊的 peer 一般写 <code>direct:对方QQ号</code>，账号可留空（用当前登录的 QQ）；目标没填全时不会发送。人格 ID 留空时使用宿主当前 Web 人格，填了就必须是已存在的人格。</p>
  ${status.reminderLastError ? `<div class="alert bad"><b>上次提醒失败</b><br>${escapeHtml(status.reminderLastError)}</div>` : ''}
  ${status.reminderLastSentAt ? `<p class="hint">上次主动提醒：${escapeHtml(new Date(status.reminderLastSentAt).toLocaleString('zh-CN'))}</p>` : ''}
  <div class="row" style="margin:10px 0 0"><button type="button" id="testReminder">发送测试提醒</button><span class="hint" style="margin:0">测试会立刻走一次当前渠道，不写日程提醒记录。</span></div>
</section>

<div class="row">
  <button class="primary" type="submit">保存设置</button>
  <span class="msg" id="msg" role="status"></span>
</div>
</form>
</main>
<script>
const API='/plugins/schedule/';
const msg=document.getElementById('msg');
const form=document.getElementById('form');
const today=${JSON.stringify(data.today)};
function setMsg(text,bad){msg.textContent=text;msg.style.color=bad?'var(--bad)':'var(--muted)';}
function val(name){const el=form.querySelector('[name="'+name+'"]');return el?el.value:''}
function num(name){const n=Number(val(name));return Number.isFinite(n)?n:0}
function checked(name){const el=form.querySelector('[name="'+name+'"]');return !!(el&&el.checked)}
function days(name){return [...form.querySelectorAll('[name="'+name+'"]:checked')].map(e=>Number(e.value))}
async function post(path,body){
  const res=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||('HTTP '+res.status));
  return data;
}
form.onsubmit=async(e)=>{
  e.preventDefault();
  const button=e.submitter;if(button)button.disabled=true;
  setMsg('正在保存…');
  try{
    const config={enabled:checked('enabled'),generateAt:val('generateAt'),daysAhead:num('daysAhead'),keepDays:num('keepDays'),
      ai:{enabled:checked('aiEnabled'),model:val('aiModel'),style:val('aiStyle')},
      reminder:{enabled:checked('reminderEnabled'),channel:val('reminderChannel'),account:val('reminderAccount'),peer:val('reminderPeer'),
        persona:val('reminderPersona'),
        leadMinutes:num('reminderLead'),maxPerDay:num('reminderMax'),quietStart:val('reminderQuietStart'),quietEnd:val('reminderQuietEnd'),
        usePersona:checked('reminderUsePersona')},
      holiday:{enabled:checked('holidayEnabled'),builtin:checked('holidayBuiltin'),student:checked('holidayStudent'),weekendDays:days('holidayWeekendDays')},
      travel:{enabled:checked('travelEnabled'),weekend:checked('travelWeekend'),shortHoliday:checked('travelShort'),longHoliday:checked('travelLong'),
        weekendEvery:num('travelEvery'),aiChoose:checked('travelAi'),target:val('travelTarget'),targetFrom:val('travelTargetFrom'),targetTo:val('travelTargetTo'),
        style:val('travelStyle')},
      routine:{wake:val('wake'),sleep:val('sleep'),wakeMinutes:num('wakeMinutes'),breakfastMinutes:num('breakfastMinutes'),
        commuteMinutes:num('commuteMinutes'),windDownMinutes:num('windDownMinutes'),
        work:{enabled:checked('workEnabled'),title:val('workTitle'),days:days('workDays'),start:val('workStart'),end:val('workEnd'),place:val('workPlace'),repeat:val('workRepeat')},
        lunch:{enabled:checked('lunchEnabled'),start:val('lunchStart'),minutes:num('lunchMinutes')},
        dinner:{enabled:checked('dinnerEnabled'),start:val('dinnerStart'),minutes:num('dinnerMinutes')},
        exercise:{enabled:checked('exerciseEnabled'),title:val('exerciseTitle'),days:days('exerciseDays'),start:val('exerciseStart'),minutes:num('exerciseMinutes'),repeat:val('exerciseRepeat')},
      }};
    const r=await post('config',{action:'save',config,fixedText:val('fixedText'),hobbiesText:val('hobbies'),holidayText:val('holidayText'),holidayWorkdays:val('holidayWorkdays'),travelText:val('travelText')});
    setMsg(r.warnings&&r.warnings.length?'已保存，有提醒：'+r.warnings.join('；'):'已保存。今天和后面的计划会按新作息补排。');
  }catch(error){setMsg('没保存：'+error.message,true)}
  finally{if(button)button.disabled=false}
};
const aiEnabled=document.getElementById('aiEnabled'),aiModel=document.getElementById('aiModel');
function syncAi(){aiModel.disabled=!aiEnabled.checked}
aiEnabled.onchange=syncAi;syncAi();
document.getElementById('applyPreset').onclick=async()=>{
  const preset=document.getElementById('preset').value;
  if(!confirm('套用模板会覆盖当前作息字段（起床、正事、三餐、运动、爱好、固定安排）。继续？'))return;
  setMsg('正在套用…');
  try{await post('config',{action:'preset',preset});location.reload()}
  catch(error){setMsg('没套用成：'+error.message,true)}
};
document.getElementById('regen').onclick=async()=>{
  if(!confirm('按当前作息重排今天？手动改过的地方会被覆盖。'))return;
  setMsg('正在重排…');
  try{const r=await post('generate',{date:today,force:true});setMsg('今天已重排：'+r.plan.items.length+' 项。')}
  catch(error){setMsg('重排失败：'+error.message,true)}
};
document.getElementById('testReminder').onclick=async()=>{
  setMsg('正在发送测试提醒…');
  try{const r=await post('reminder/test',{channel:val('reminderChannel'),account:val('reminderAccount'),peer:val('reminderPeer')});
    setMsg(r.ok?'测试提醒已发出（'+r.status+'）。':'发送状态：'+r.status, !r.ok)}
  catch(error){setMsg('没发出去：'+error.message,true)}
};
</script></body></html>`;
}
