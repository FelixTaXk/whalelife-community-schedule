/*! 日程 · 天气子插件 · 设置与预览页。 */

import type { WeatherConfig } from '../lib/config.ts';
import type { WeatherSnapshot } from '../../../lib/weather-types.ts';
import { updateLabel } from '../../../lib/weather-format.ts';
import { dateLabel, weekdayLabel, parseDateKey } from '../../../lib/time.ts';
import { BASE_CSS, escapeHtml } from '../../../ui/theme.ts';

export type WeatherPageData = {
  config: WeatherConfig;
  snapshot: WeatherSnapshot;
  version: string;
};

const EXTRA_CSS = `
.weather-now{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap;background:var(--accent-soft);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.temp{font-size:40px;line-height:1.1;font-weight:650;letter-spacing:-1px}
.temp small{font-size:20px;font-weight:500}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.chips span{font-size:12px;color:var(--muted);border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:2px 9px}
.forecast{display:grid;grid-template-columns:110px 1fr auto auto;gap:8px 12px;align-items:center}
.forecast .day{font-weight:600;font-size:13px}
.forecast .desc{color:var(--muted);font-size:13px}
.forecast .range{font-variant-numeric:tabular-nums;font-size:13px}
.forecast .prob{font-size:12px;color:var(--muted);text-align:right;min-width:56px}
.forecast .tip{grid-column:2/-1;font-size:12px;color:var(--warn);margin-top:-4px}
.forecast hr{grid-column:1/-1;border:0;border-top:1px solid var(--line);margin:2px 0}
@media(max-width:700px){.forecast{grid-template-columns:86px 1fr auto}.forecast .prob{display:none}}
`;

function weekday(date: string): string {
  const value = parseDateKey(date).getDay();
  return weekdayLabel(value === 0 ? 7 : value);
}

function dayLabel(date: string, first: string): string {
  return date === first ? '今天' : `${dateLabel(date)} ${weekday(date)}`;
}

function nowBlock(snapshot: WeatherSnapshot): string {
  if (!snapshot.now) {
    return '<div class="weather-now"><div><div class="temp">—</div><div class="muted">还没有实时天气</div></div></div>';
  }
  const now = snapshot.now;
  return `<div class="weather-now">
  <div>
    <div class="temp">${escapeHtml(now.icon)} ${escapeHtml(now.temperature)}<small>℃</small></div>
    <div class="muted">${escapeHtml(now.text)} · 体感 ${escapeHtml(now.apparent)}℃ · ${now.isDay ? '白天' : '夜间'}</div>
  </div>
  <div style="text-align:right">
    <div class="muted">${escapeHtml(snapshot.place)} · ${escapeHtml(updateLabel(snapshot))}</div>
    <div class="chips">
      <span>湿度 ${escapeHtml(now.humidity)}%</span>
      <span>风 ${escapeHtml(now.wind)} km/h</span>
      <span>降水 ${escapeHtml(now.precipitation)} mm</span>
    </div>
  </div>
</div>`;
}

function forecastBlock(snapshot: WeatherSnapshot): string {
  if (!snapshot.days.length) return '<p class="muted">接口还没有返回每日预报。</p>';
  const first = snapshot.days[0].date;
  const rows = snapshot.days.map((day, index) => {
    const separator = index === snapshot.days.length - 1 ? '' : '<hr>';
    return `<div class="day">${escapeHtml(dayLabel(day.date, first))}</div>
<div class="desc">${escapeHtml(day.icon)} ${escapeHtml(day.text)}</div>
<div class="range">${escapeHtml(day.min)}° / ${escapeHtml(day.max)}°</div>
<div class="prob">${day.precipitationProbability}%</div>
${day.tip ? `<div class="tip">${escapeHtml(day.tip)}</div>` : ''}${separator}`;
  }).join('');
  return `<div class="forecast">${rows}</div>`;
}

function numberValue(value: number | null): string {
  return value === null ? '' : String(value);
}

export function weatherSettingsPage(data: WeatherPageData): string {
  const { config, snapshot } = data;
  const stale = snapshot.error ? `<div class="alert bad"><b>这次没取到最新天气</b><br>${escapeHtml(snapshot.error)}${snapshot.days.length ? '<br>下面显示的是上一次拿到的数据。' : ''}</div>` : '';
  const today = snapshot.days[0];
  const todayLine = today
    ? `<p class="hint" style="margin-top:12px">今天 ${escapeHtml(today.text)}，${escapeHtml(today.min)}–${escapeHtml(today.max)}℃，降水概率 ${today.precipitationProbability}%${today.tip ? `，${escapeHtml(today.tip)}` : ''}。日出 ${escapeHtml(today.sunrise.slice(11, 16) || '—')}，日落 ${escapeHtml(today.sunset.slice(11, 16) || '—')}。</p>`
    : '';

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日程 · 天气</title><style>${BASE_CSS}${EXTRA_CSS}</style></head><body><main>
<header>
  <div>
    <h1>天气</h1>
    <p class="sub">日程的子插件 · 数据来自 Open-Meteo · v${escapeHtml(data.version)}</p>
  </div>
  <div class="row" style="margin:0"><a href="/plugins/schedule/settings" style="text-decoration:none"><button type="button">返回日程设置</button></a></div>
</header>

${stale}

<section class="card">
  <h2>现在 <span class="pill ${snapshot.error ? 'warn' : 'good'}">${snapshot.error ? '数据可能过期' : '已更新'}</span></h2>
  ${nowBlock(snapshot)}
  ${todayLine}
</section>

<section class="card">
  <h2>未来 ${snapshot.days.length || config.forecastDays} 天</h2>
  ${forecastBlock(snapshot)}
</section>

<section class="card">
  <h2>天气设置</h2>
  <form id="form">
    <div class="grid3">
      <label>城市<input type="text" name="city" maxlength="30" value="${escapeHtml(config.city)}" placeholder="常州"></label>
      <label>纬度<input type="number" step="0.00001" name="latitude" value="${numberValue(config.latitude)}" placeholder="31.77359"></label>
      <label>经度<input type="number" step="0.00001" name="longitude" value="${numberValue(config.longitude)}" placeholder="119.95401"></label>
      <label>刷新间隔（分钟）<input type="number" name="refreshMinutes" min="5" max="180" value="${config.refreshMinutes}"></label>
      <label>预报天数<input type="number" name="forecastDays" min="1" max="7" value="${config.forecastDays}"></label>
      <label>请求超时（秒）<input type="number" name="timeoutSeconds" min="2" max="30" value="${config.timeoutSeconds}"></label>
    </div>
    <details style="margin-top:14px">
      <summary class="muted">高级：接口地址（一般不用改）</summary>
      <div class="grid" style="margin-top:10px">
        <label>预报接口<input type="text" name="apiBase" value="${escapeHtml(config.apiBase)}"></label>
        <label>地名接口<input type="text" name="geocodingBase" value="${escapeHtml(config.geocodingBase)}"></label>
      </div>
    </details>
    <p class="hint">城市名只用于显示和定位；真正取数用下面的经纬度。内置了约 50 个常用城市，中文名可直接定位；查不到时会去 Open-Meteo 地名库（可试英文或拼音）。</p>
    <div class="row">
      <button class="primary" type="submit">保存并刷新</button>
      <button type="button" id="locate">按城市名定位</button>
      <button type="button" id="refresh">立即刷新</button>
      <span class="msg" id="msg" role="status"></span>
    </div>
  </form>
</section>

<section class="card">
  <h2>说明</h2>
  <p class="hint" style="margin:0">这个子插件由「日程」父插件承载（<code>schedule/weather</code>），对外提供 <code>schedule_weather</code> 服务，日程页和 <code>schedule_today</code> / <code>schedule_now</code> 会读取它。天气取不到时日程照常使用，不会因此失败。接口不需要 API key；失败后约 60 秒内不重复请求，并尽量保留上一次的数据。</p>
</section>
</main>
<script>
const API='/plugins/schedule/weather/';
const msg=document.getElementById('msg');
const form=document.getElementById('form');
function setMsg(text,bad){msg.textContent=text;msg.style.color=bad?'var(--bad)':'var(--muted)';}
function val(name){const el=form.querySelector('[name="'+name+'"]');return el?el.value.trim():''}
function num(name){const n=Number(val(name));return Number.isFinite(n)?n:0}
async function post(path,body){
  const res=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!data.ok)throw new Error(data.error||('HTTP '+res.status));
  return data;
}
form.onsubmit=async(e)=>{
  e.preventDefault();
  const button=e.submitter;if(button)button.disabled=true;
  setMsg('正在保存…');
  try{
    await post('config',{action:'save',config:{city:val('city'),latitude:val('latitude'),longitude:val('longitude'),
      refreshMinutes:num('refreshMinutes'),forecastDays:num('forecastDays'),timeoutSeconds:num('timeoutSeconds'),
      apiBase:val('apiBase'),geocodingBase:val('geocodingBase')}});
    location.reload();
  }catch(error){setMsg('没保存：'+error.message,true);if(button)button.disabled=false}
};
document.getElementById('locate').onclick=async()=>{
  setMsg('正在定位…');
  try{
    const r=await post('config',{action:'geocode',city:val('city')});
    form.querySelector('[name="latitude"]').value=r.result.latitude;
    form.querySelector('[name="longitude"]').value=r.result.longitude;
    setMsg('找到 '+r.result.name+(r.result.province?'（'+r.result.province+'）':'')+'，坐标已填好，记得保存。');
  }catch(error){setMsg('没定位到：'+error.message,true)}
};
document.getElementById('refresh').onclick=async()=>{
  setMsg('正在刷新…');
  try{await post('data',{force:true});location.reload()}
  catch(error){setMsg('刷新失败：'+error.message,true)}
};
</script></body></html>`;
}
