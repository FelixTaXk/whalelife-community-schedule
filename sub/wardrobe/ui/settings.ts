/*! 衣柜 · 设置页。 */

import { BASE_CSS, escapeHtml as esc } from '../../../ui/theme.ts';

export type WardrobePersona = {
  id: string;
  name: string;
  age: number | null;
  adult: boolean;
  threshold: number;
  source: string;
};

export type WardrobePageData = {
  version: string;
  today: any;
  config: { inject: boolean; avoidDays: number; libraryRoot: string; adultThreshold: number; unknownPersona: string; personaPolicy: Record<string, string> };
  stats: { outfits: number; scenes: Record<string, number>; tiers: Record<string, number>; report: any };
  personas: WardrobePersona[];
};

const EXTRA_CSS = `
.hero{display:flex;gap:20px;align-items:stretch;flex-wrap:wrap}
.hero .shot{width:200px;min-height:240px;border-radius:14px;overflow:hidden;background:var(--accent-soft);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex:none}
.hero .shot img{width:100%;height:100%;object-fit:cover;display:block}
.hero .meta{flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px;justify-content:center}
.hero .when{font-size:13px;color:var(--muted)}
.hero .what{font-size:22px;font-weight:650;line-height:1.3}
.hero .tags{display:flex;gap:6px;flex-wrap:wrap}
.timeline{display:flex;flex-direction:column;gap:10px}
.slot{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--paper)}
.slot.now{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.slot .pic{width:56px;height:72px;border-radius:8px;overflow:hidden;background:var(--accent-soft);flex:none}
.slot .pic img{width:100%;height:100%;object-fit:cover;display:block}
.slot .info{flex:1;min-width:0}
.slot .t{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.slot .n{font-weight:600;font-size:14px;margin:1px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slot .s{font-size:12px;color:var(--muted)}
.slot button{padding:5px 10px;font-size:12px;flex:none}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
@media(max-width:640px){.hero .shot{width:100%;min-height:200px;max-height:260px}}
`;

function slot(row: any): string {
  const outfit = row.outfit;
  const pic = outfit ? `<img src="${esc(outfit.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="slot${row.isNow ? ' now' : ''}">
  <div class="pic">${pic}</div>
  <div class="info">
    <div class="t">${esc(row.time)}${row.isNow ? ' · 现在' : ''}</div>
    <div class="n">${esc(row.title)}${row.place ? ` <span class="muted">@${esc(row.place)}</span>` : ''}</div>
    <div class="s"><span class="pill">${esc(row.scene)}</span>${outfit?.tier ? ` <span class="pill">${esc(outfit.tier)}</span>` : ''} ${esc(outfit?.name ?? '还没配')}${outfit ? ` · <span class="mono">${esc(outfit.id)}</span>` : ''}</div>
  </div>
  <button type="button" data-reroll="${esc(row.id)}">换一套</button>
</div>`;
}

export function wardrobeSettingsPage(data: WardrobePageData): string {
  const { today, config, stats, personas } = data;
  const now = today?.now;
  const me = today?.persona;
  const personaRows = (personas ?? []).map((p) => {
    const policy = config.personaPolicy?.[p.id] ?? 'auto';
    const age = p.age === null ? '年龄未标注' : `${p.age} 岁`;
    const state = p.adult ? '成年 · 可解锁私密/泳装/派对' : '未成年 · 只用日常款';
    return `<label>${esc(p.name)}（${esc(p.id)}）
      <span class="hint" style="display:block">${esc(age)} · ${esc(state)}</span>
      <select name="policy_${esc(p.id)}">
        <option value="auto"${policy === 'auto' ? ' selected' : ''}>按年龄自动</option>
        <option value="minor"${policy === 'minor' ? ' selected' : ''}>强制未成年</option>
        <option value="adult"${policy === 'adult' ? ' selected' : ''}>成年（年龄未满时不生效）</option>
      </select>
    </label>`;
  }).join('');
  const hero = now
    ? `<div class="hero">
  <div class="shot">${now.outfit ? `<img src="${esc(now.outfit.preview)}" alt="" onerror="this.remove()">` : ''}</div>
  <div class="meta">
    <div class="when">${esc(today.date)} · ${esc(now.time)} ${now.state === 'now' ? '正在' : '下一段'}</div>
    <div class="what">${esc(now.outfit?.name ?? '还没配')}</div>
    <div class="tags"><span class="pill">${esc(now.title)}</span><span class="pill">${esc(now.outfit?.season ?? '')}</span><span class="pill">${esc(now.outfit?.tier ?? '')}</span><span class="pill mono">${esc(now.outfit?.id ?? '')}</span></div>
    <div class="row" style="margin:6px 0 0"><button type="button" id="rerollNow">现在换一套</button><a href="/plugins/schedule/settings" style="text-decoration:none"><button type="button">日程设置</button></a></div>
  </div>
</div>`
    : `<p class="muted">今天还没有日程，先去日程里排一排，衣柜会自动配。</p>`;

  const weather = today?.weather
    ? `${esc(today.weather.text ?? '')} ${today.weather.min ?? '—'}–${today.weather.max ?? '—'}℃`
    : '天气还没进来';

  const list = today?.items?.length
    ? `<div class="timeline">${today.items.map(slot).join('')}</div>`
    : '<p class="muted">今天没有日程段。</p>';

  const sceneStats = Object.entries(stats.scenes).map(([key, value]) => `<span class="pill">${esc(key)} ${value}</span>`).join(' ');
  const tierStats = Object.entries(stats.tiers ?? {}).map(([key, value]) => `<span class="pill">${esc(key)} ${value}</span>`).join(' ');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>日程 · 衣柜</title><style>${BASE_CSS}${EXTRA_CSS}</style></head><body><main>
<header>
  <div>
    <h1>衣柜</h1>
    <p class="sub">日程的子插件 · 只用 ComfyUI 服装库 · v${esc(data.version)}</p>
  </div>
  <div class="row" style="margin:0"><span class="pill">${stats.outfits} 套入库</span><span class="pill">${esc(me?.name ?? '默认人格')} ${me?.adult ? '成年' : '未成年'}</span></div>
</header>

<div id="msg"></div>

<section class="card">
  <h2>现在穿 <span class="pill">${esc(weather)}</span></h2>
  ${hero}
</section>

<section class="card">
  <h2>今天的安排</h2>
  ${list}
</section>

<section class="card">
  <h2>设置</h2>
  <form id="form">
    <div class="grid3">
      <label>每轮告诉当前人格今天穿什么
        <select name="inject"><option value="1"${config.inject ? ' selected' : ''}>开</option><option value="0"${config.inject ? '' : ' selected'}>关</option></select>
      </label>
      <label>最近几天不重复<input type="number" name="avoidDays" min="1" max="10" value="${config.avoidDays}"></label>
      <label>服装库根目录<input type="text" name="libraryRoot" value="${esc(config.libraryRoot)}" placeholder="D:/ComfyUI/custom_nodes/comfyui-costume-gallery/library"></label>
    </div>
    <div class="grid3" style="margin-top:10px">
      <label>成年年龄线<input type="number" name="adultThreshold" min="18" max="30" value="${config.adultThreshold}"></label>
      <label>人格设定读不到年龄时
        <select name="unknownPersona">
          <option value="minor"${config.unknownPersona !== 'adult' ? ' selected' : ''}>按未成年（推荐）</option>
          <option value="adult"${config.unknownPersona === 'adult' ? ' selected' : ''}>按成年</option>
        </select>
      </label>
    </div>
    <p class="hint">人格分级：读到年龄且满 ${config.adultThreshold} 岁才解锁私密/泳装/派对；读到未满 ${config.adultThreshold} 岁时，手动改成“成年”也不会生效。</p>
    ${personaRows ? `<div class="grid3" style="margin-top:10px">${personaRows}</div>` : ''}
    <p class="hint">ComfyUI 服装库 1407 套全量入库：日常四季 966、私密居家 339、泳装 54、派对礼服 48。普通日程段共用一套主穿搭，只有回家/泳池/晚宴/运动才换。未成年人格只用日常款；成年人格在泳池/海边匹配泳装、晚宴派对匹配礼服、居家可匹配私密款。年龄从人格设定里读，读不到默认按未成年处理。</p>
    <div class="row">
      <button type="submit">保存设置</button>
      <button type="button" id="import">重新导入服装库</button>
    </div>
  </form>
  <details style="margin-top:14px">
    <summary class="muted">库统计</summary>
    <p class="hint">分级：${tierStats || '—'}</p>
    <p class="hint">场景：${sceneStats || '—'}</p>
    <p class="hint">导入时间：${esc(stats.report?.generatedAt ?? '—')}；来源 ${esc(stats.report?.library ?? '—')}</p>
  </details>
</section>

<script>
const $ = (s) => document.querySelector(s);
const msg = (html, bad) => { $('#msg').innerHTML = '<div class="alert ' + (bad ? 'bad' : '') + '">' + html + '</div>'; setTimeout(() => { $('#msg').innerHTML = ''; }, 4200); };
async function post(body) {
  const res = await fetch('/plugins/schedule/wardrobe/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
document.querySelectorAll('[data-reroll]').forEach((btn) => btn.addEventListener('click', async () => {
  btn.disabled = true;
  try {
    const r = await post({ action: 'reroll', date: ${JSON.stringify(today?.date ?? '')}, blockId: btn.dataset.reroll });
    if (!r.ok) throw new Error(r.error || '换装失败');
    msg('换好了：' + r.result.line);
    setTimeout(() => location.reload(), 700);
  } catch (e) { msg(String(e.message || e), true); btn.disabled = false; }
}));
$('#rerollNow')?.addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await post({ action: 'reroll', date: ${JSON.stringify(today?.date ?? '')} });
    if (!r.ok) throw new Error(r.error || '换装失败');
    msg(r.result.line);
    setTimeout(() => location.reload(), 700);
  } catch (err) { msg(String(err.message || err), true); e.target.disabled = false; }
});
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const personaPolicy = {};
  for (const [key, value] of f.entries()) {
    if (key.startsWith('policy_') && value !== 'auto') personaPolicy[key.slice(7)] = value;
  }
  try {
    const r = await post({ action: 'save', config: {
      inject: f.get('inject') === '1',
      avoidDays: Number(f.get('avoidDays')),
      libraryRoot: String(f.get('libraryRoot') || ''),
      adultThreshold: Number(f.get('adultThreshold')),
      unknownPersona: String(f.get('unknownPersona') || 'minor'),
      personaPolicy,
    } });
    if (!r.ok) throw new Error(r.error || '保存失败');
    msg('设置已保存');
  } catch (err) { msg(String(err.message || err), true); }
});
$('#import').addEventListener('click', async (e) => {
  e.target.disabled = true;
  msg('正在扫描服装库，可能要十几秒…');
  try {
    const r = await post({ action: 'import', root: $('#form').elements.libraryRoot.value });
    if (!r.ok) throw new Error((r.result && r.result.stderr) || r.error || '导入失败');
    msg('导入完成：' + JSON.stringify(r.result && r.result.kept ? { kept: r.result.kept } : r.result));
    setTimeout(() => location.reload(), 900);
  } catch (err) { msg(String(err.message || err), true); e.target.disabled = false; }
});
</script>
</main></body></html>`;
}
