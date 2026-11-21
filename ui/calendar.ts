/*! 日程 plugin · 日程表页面（周切换、当日时间轴、完成/跳过/增删改）。 */

import { BASE_CSS, escapeHtml } from './theme.ts';

export type CalendarData = { today: string; version: string };

export function calendarPage(data: CalendarData): string {
  const initialWeek = mondayOf(data.today);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日程</title><style>${BASE_CSS}
.tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.tab{flex:1 0 88px;border:1px solid var(--line);border-radius:10px;background:var(--paper);padding:8px 6px;text-align:center;cursor:pointer;line-height:1.3}
.tab b{display:block;font-size:13px}
.tab span{font-size:11px;color:var(--muted)}
.tab.active{border-color:var(--accent);background:var(--accent-soft)}
.tab .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-top:2px;visibility:hidden}
.tab.has .dot{visibility:visible}
.tab.today b:after{content:' · 今天';font-size:10px;color:var(--accent)}
.timeline{list-style:none;margin:12px 0 0;padding:0}
.item{display:flex;gap:12px;padding:10px 6px;border-bottom:1px solid var(--line);align-items:flex-start}
.item:last-child{border-bottom:0}
.time{flex:0 0 84px;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;line-height:1.45}
.bar{flex:0 0 4px;align-self:stretch;border-radius:3px;min-height:34px}
.body{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.body b{font-size:15px;font-weight:600}
.body .meta{font-size:12px;color:var(--muted)}
.ops{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.item.current{background:var(--accent-soft);border-radius:8px}
.item.isdone b{color:var(--muted);text-decoration:line-through}
.item.isskipped b{color:var(--muted);text-decoration:line-through dotted}
.nowbar{font-size:13px;color:var(--accent);background:var(--accent-soft);border-radius:8px;padding:8px 12px;margin:12px 0 0}
.wxbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:10px 0 0}
.wxbar .wxicon{font-size:18px;line-height:1}
.wxbar b{font-weight:600}
.wxbar .tip{color:var(--warn);font-size:12px}
.wxnote{font-size:12px;color:var(--warn);background:rgba(162,106,31,.08);border-radius:8px;padding:6px 12px;margin:8px 0 0}
.tab .wx{display:block;font-size:13px;line-height:1.2;margin-top:2px}
.editor{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;width:100%}
.editor input{width:auto;flex:1 1 120px}
.adday{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px;padding-top:16px;border-top:1px dashed var(--line)}
.adday input{width:auto;flex:1 1 110px}
.empty{padding:26px 4px;color:var(--muted);font-size:14px}
</style></head><body><main>
<header>
  <div><h1>日程</h1><p class="sub" id="sub">v${escapeHtml(data.version)} · 按作息自动排</p></div>
  <div class="row" style="margin:0">
    <button type="button" id="prev">← 上一周</button>
    <button type="button" id="home">回到今天</button>
    <button type="button" id="next">下一周 →</button>
    <button type="button" class="primary" id="regen">重排这天</button>
  </div>
</header>
<div id="banner"></div>
<div class="tabs" id="tabs"></div>
<section class="card" id="day"></section>
</main>
<script>
var API='/plugins/schedule/';
var state={today:${JSON.stringify(data.today)},weekStart:${JSON.stringify(initialWeek)},selected:${JSON.stringify(data.today)},plans:{},editing:null,config:null,status:null,weather:null,busy:false};
var COLORS={routine:'#8fa5a3',meal:'#d78b4a',commute:'#5b8bb8',work:'#17906f',study:'#2f8f8f',exercise:'#c25b5b',free:'#7a6fbf',chore:'#9a7d55',rest:'#6f8f9a',social:'#b0709a',fixed:'#b39431',travel:'#c07a3e',sleep:'#3f4f55'};
var KIND={routine:'日常',meal:'用餐',commute:'路上',work:'正事',study:'学习',exercise:'运动',free:'自由',chore:'家务',rest:'休息',social:'社交',fixed:'固定',travel:'旅行',sleep:'睡觉'};
var WEEK=['一','二','三','四','五','六','日'];
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function pad(n){return String(n).padStart(2,'0')}
function addDays(key,n){var p=key.split('-').map(Number);var d=new Date(p[0],p[1]-1,p[2]+n);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function mondayOf(key){var p=key.split('-').map(Number);var d=new Date(p[0],p[1]-1,p[2]);var w=d.getDay()||7;return addDays(key,1-w)}
function toMin(v){var p=String(v).split(':');return Number(p[0])*60+Number(p[1])}
function weekdayOf(key){var p=key.split('-').map(Number);var d=new Date(p[0],p[1]-1,p[2]);return d.getDay()||7}
function dayTitle(key){var p=key.split('-').map(Number);return (p[1])+'月'+p[2]+'日 周'+WEEK[weekdayOf(key)-1]}
async function post(path,body){
  var res=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var data=await res.json().catch(function(){return {}});
  if(!res.ok)throw new Error(data.error||('HTTP '+res.status));
  return data;
}
async function load(){
  if(state.busy)return;state.busy=true;
  try{
    var r=await post('data',{from:state.weekStart,days:7});
    state.plans={};r.plans.forEach(function(entry){if(entry.plan)state.plans[entry.date]=entry.plan});
    state.config=r.config;state.status=r.status;state.today=r.today||state.today;state.weather=r.weather||null;
    render();
  }catch(e){document.getElementById('banner').innerHTML='<div class="alert bad">读取失败：'+esc(e.message)+'</div>'}
  finally{state.busy=false}
}
function render(){
  document.getElementById('sub').textContent='v'+${JSON.stringify(data.version)}+' · '+dayTitle(state.today)+' · 按作息自动排';
  renderBanner();renderTabs();renderDay();
}
function renderBanner(){
  var html='';
  if(state.config&&!state.config.enabled)html+='<div class="alert">自动生成已关闭：只能手动点「重排这天」或「生成这天」。</div>';
  if(state.config&&state.config.aiEnabled&&!state.config.aiModel)html+='<div class="alert">AI 润色开着但没选模型，目前只会用规则骨架。</div>';
  if(state.status&&state.status.lastError)html+='<div class="alert bad">上次生成出错：'+esc(state.status.lastError)+'</div>';
  document.getElementById('banner').innerHTML=html;
}
function wxDay(key){
  if(!state.weather||!state.weather.days)return null;
  for(var i=0;i<state.weather.days.length;i++)if(state.weather.days[i].date===key)return state.weather.days[i];
  return null;
}
function weatherBar(key,plan){
  var wd=wxDay(key)||(plan&&plan.weather&&plan.weather.date===key?plan.weather:null);if(!wd)return '';
  var html='<div class="wxbar"><span class="wxicon">'+esc(wd.icon)+'</span><b>'+esc(wd.text)+' '+wd.min+'° / '+wd.max+'°</b>';
  if(key===state.today&&state.weather&&state.weather.now)html+='<span class="muted">现在 '+state.weather.now.temperature+'°</span>';
  if(wd.precipitationProbability>0)html+='<span class="muted">降水 '+wd.precipitationProbability+'%</span>';
  if(wd.tip)html+='<span class="tip">'+esc(wd.tip)+'</span>';
  return html+'</div>';
}
function renderTabs(){
  var tabs=[],i,key;
  for(i=0;i<7;i++){
    key=addDays(state.weekStart,i);
    var has=state.plans[key]?' has':'';
    var active=key===state.selected?' active':'';
    var today=key===state.today?' today':'';
    var wd=wxDay(key);
    tabs.push('<div class="tab'+has+active+today+'" data-date="'+key+'"><b>周'+WEEK[i]+'</b><span>'+dayTitle(key).replace(' 周'+WEEK[i],'')+'</span>'+(wd?'<span class="wx">'+esc(wd.icon)+'</span>':'<span class="wx"> </span>')+'<span class="dot"></span></div>');
  }
  var el=document.getElementById('tabs');el.innerHTML=tabs.join('');
  [].forEach.call(el.querySelectorAll('.tab'),function(tab){tab.onclick=function(){state.selected=tab.getAttribute('data-date');state.editing=null;renderTabs();renderDay()}});
}
function nowLine(plan){
  if(!plan||plan.date!==state.today)return '';
  var d=new Date(),m=d.getHours()*60+d.getMinutes(),cur=null,next=null;
  plan.items.forEach(function(item){
    var s=toMin(item.start),e=toMin(item.end);
    if(s<=m&&m<e&&!cur)cur=item;
    if(s>m&&!next)next=item;
  });
  if(cur)return '现在 '+pad(d.getHours())+':'+pad(d.getMinutes())+' · 正在进行「'+cur.title+'」，还剩 '+(toMin(cur.end)-m)+' 分钟';
  if(next)return '现在 '+pad(d.getHours())+':'+pad(d.getMinutes())+' · 空着，下一项 '+next.start+'「'+next.title+'」';
  return '现在 '+pad(d.getHours())+':'+pad(d.getMinutes())+' · 今天的安排都结束了';
}
function renderDay(){
  var el=document.getElementById('day'),key=state.selected,plan=state.plans[key];
  if(!plan){
    el.innerHTML='<h2>'+esc(dayTitle(key))+'</h2>'+weatherBar(key)+'<div class="empty">这天还没有日程。</div><div class="row"><button type="button" data-act="generate">按作息生成这天</button></div>';
    bindDay();return;
  }
  var srcLabel=plan.source==='ai'?'模型润色':(plan.source==='manual'?'手动':'自动');
  var head='<h2>'+esc(dayTitle(key))+' <span class="pill">'+esc(plan.tone)+'</span><span class="pill">'+srcLabel+'</span>'+(plan.edited?'<span class="pill warn">改过</span>':'')+(plan.date===state.today?'<span class="pill good">今天</span>':'')+'</h2>';
  if(plan.holiday)head+='<div class="row" style="margin:-6px 0 0"><span class="pill good">'+esc(plan.holiday.name)+' · 第 '+(plan.holiday.dayIndex+1)+'/'+plan.holiday.days+' 天</span>'+(plan.travel?'<span class="pill">旅行 · '+esc(plan.travel.destination)+'</span>':'')+'</div>';
  else if(plan.workday)head+='<div class="row" style="margin:-6px 0 0"><span class="pill warn">'+esc(plan.workday)+'</span></div>';
  else if(plan.travel)head+='<div class="row" style="margin:-6px 0 0"><span class="pill">周末短途 · '+esc(plan.travel.destination)+'</span></div>';
  if(plan.note)head+='<p class="muted" style="margin:-6px 0 0">'+esc(plan.note)+'</p>';
  head+=weatherBar(key,plan);
  if(plan.weatherAdjusted&&plan.weatherAdjusted.length)head+='<div class="wxnote">按天气调整：'+esc(plan.weatherAdjusted.join('；'))+'</div>';
  var now=nowLine(plan);
  if(now)head+='<div class="nowbar">'+esc(now)+'</div>';
  if(plan.aiError)head+='<div class="alert">模型润色没成功，用的是自动骨架：'+esc(plan.aiError)+'</div>';
  var list=plan.items.map(function(item){
    var m=nowMin();
    var current=plan.date===state.today&&toMin(item.start)<=m&&m<toMin(item.end);
    var editing=state.editing===item.id;
    var meta=[item.start+'-'+item.end,KIND[item.kind]||item.kind,item.place||'',item.status==='done'?'已完成':(item.status==='skipped'?'跳过':'')].filter(Boolean).join(' · ');
    var ops='';
    if(!editing){
      if(item.status==='done')ops+='<button type="button" class="small" data-act="status" data-id="'+item.id+'" data-status="pending">撤销</button>';
      else if(item.status==='skipped')ops+='<button type="button" class="small" data-act="status" data-id="'+item.id+'" data-status="pending">恢复</button>';
      else ops+='<button type="button" class="small" data-act="status" data-id="'+item.id+'" data-status="done">完成</button><button type="button" class="small" data-act="status" data-id="'+item.id+'" data-status="skipped">跳过</button>';
      ops+='<button type="button" class="small" data-act="edit" data-id="'+item.id+'">改</button><button type="button" class="small" data-act="remove" data-id="'+item.id+'">删除</button>';
    }
    var editor='';
    if(editing){
      editor='<div class="editor"><input type="time" id="eStart" value="'+esc(item.start)+'"><input type="time" id="eEnd" value="'+esc(item.end)+'">'
        +'<input type="text" id="eTitle" maxlength="24" value="'+esc(item.title)+'"><input type="text" id="eNote" maxlength="60" placeholder="备注" value="'+esc(item.note||'')+'">'
        +'<button type="button" class="small primary" data-act="saveEdit" data-id="'+item.id+'">保存</button><button type="button" class="small" data-act="cancelEdit">取消</button></div>';
    }
    var cls='item'+(current?' current':'')+(item.status==='done'?' isdone':'')+(item.status==='skipped'?' isskipped':'');
    return '<li class="'+cls+'"><span class="time">'+item.start+'<br>'+item.end+'</span>'
      +'<span class="bar" style="background:'+(COLORS[item.kind]||'#8fa5a3')+'"></span>'
      +'<div class="body"><b>'+esc(item.title)+'</b><span class="meta">'+esc(meta)+'</span>'+(item.note?'<span class="meta">'+esc(item.note)+'</span>':'')
      +(ops?'<span class="ops">'+ops+'</span>':'')+editor+'</div></li>';
  }).join('');
  el.innerHTML=head+'<ul class="timeline">'+list+'</ul>'
    +'<div class="adday"><input type="time" id="fStart" value="09:00"><input type="time" id="fEnd" value="10:00">'
    +'<input type="text" id="fTitle" maxlength="24" placeholder="加一件事，例如 取快递">'
    +'<button type="button" class="primary" data-act="add">加上</button></div>';
  bindDay();
}
function nowMin(){var d=new Date();return d.getHours()*60+d.getMinutes()}
function bindDay(){
  var el=document.getElementById('day');
  [].forEach.call(el.querySelectorAll('[data-act]'),function(button){
    button.onclick=function(){act(button.getAttribute('data-act'),button.getAttribute('data-id'),button.getAttribute('data-status'))};
  });
}
async function act(name,id,status){
  var key=state.selected;
  try{
    if(name==='generate'){
      await post('generate',{date:key,force:false});
    }else if(name==='status'){
      await post('item',{date:key,action:'status',id:id,status:status});
    }else if(name==='edit'){
      state.editing=id;renderDay();return;
    }else if(name==='cancelEdit'){
      state.editing=null;renderDay();return;
    }else if(name==='saveEdit'){
      var start=document.getElementById('eStart').value,end=document.getElementById('eEnd').value;
      var title=document.getElementById('eTitle').value,note=document.getElementById('eNote').value;
      await post('item',{date:key,action:'update',id:id,start:start,end:end,title:title,note:note});
      state.editing=null;
    }else if(name==='remove'){
      if(!confirm('删掉这一项？'))return;
      await post('item',{date:key,action:'remove',id:id});
    }else if(name==='add'){
      var s=document.getElementById('fStart').value,e=document.getElementById('fEnd').value,t=document.getElementById('fTitle').value;
      if(!t.trim()){alert('先写一下要加什么');return}
      await post('item',{date:key,action:'add',start:s,end:e,title:t});
    }
    await load();
  }catch(error){alert(error.message)}
}
document.getElementById('prev').onclick=function(){state.weekStart=addDays(state.weekStart,-7);state.selected=addDays(state.selected,-7);state.editing=null;load()};
document.getElementById('next').onclick=function(){state.weekStart=addDays(state.weekStart,7);state.selected=addDays(state.selected,7);state.editing=null;load()};
document.getElementById('home').onclick=function(){state.weekStart=mondayOf(state.today);state.selected=state.today;state.editing=null;load()};
document.getElementById('regen').onclick=async function(){
  var plan=state.plans[state.selected];
  var warn=plan&&plan.edited?'这天有手动改过的地方，重排会覆盖。继续？':'按当前作息重排这天？';
  if(!confirm(warn))return;
  try{await post('generate',{date:state.selected,force:true});await load()}catch(error){alert(error.message)}
};
load();
</script></body></html>`;
}

function mondayOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() + 1 - weekday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
