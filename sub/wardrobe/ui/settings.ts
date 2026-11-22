/*! 衣柜 · 设置页。 */

import { BASE_CSS, escapeHtml as esc } from '../../../ui/theme.ts';

export type WardrobePersona = {
  id: string;
  name: string;
  age: number | null;
  adult: boolean;
  threshold: number;
  source: string;
  gender: 'female' | 'male' | null;
  genderSource: 'config' | 'host' | 'none';
};

export type WardrobePageData = {
  version: string;
  today: any;
  config: { inject: boolean; avoidDays: number; libraryRoot: string; assetBaseUrl: string; importRoot: string; adultThreshold: number; personaAge: Record<string, number>; unknownPersona: string; personaPolicy: Record<string, string>; personaGender: Record<string, string>; categoryMap: Record<string, any> };
  stats: { outfits: number; scenes: Record<string, number>; tiers: Record<string, number>; report: any; libraryPath?: string; libraryBundled?: boolean; libraryReady?: boolean; assetBaseUrl?: string; assetMode?: 'local' | 'remote' };
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
.slotActions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:180px}
.altGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:10px}
.altCard{border:1px solid var(--line);border-radius:12px;padding:8px;background:var(--paper);cursor:pointer}
.altCard:hover{border-color:var(--accent)}
.altCard img{width:100%;height:150px;object-fit:cover;border-radius:8px;display:block}
.altCard .name{font-weight:600;font-size:13px;margin-top:6px}
.altCard .why{font-size:11px;color:var(--muted);margin-top:2px}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
@media(max-width:640px){.hero .shot{width:100%;min-height:200px;max-height:260px}}
`;

function slot(row: any): string {
  const outfit = row.outfit;
  const pic = outfit ? `<img src="${esc(outfit.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  const id = outfit ? ` data-id="${esc(outfit.id)}"` : '';
  const actions = outfit
    ? `<div class="slotActions">
        <button type="button" data-reroll="${esc(row.id)}">换一套</button>
        <button type="button" data-alt="${esc(row.id)}">备选</button>
        <button type="button" data-fav="${esc(row.id)}"${id}>喜欢</button>
        <button type="button" data-dislike="${esc(row.id)}"${id}>不喜欢</button>
        <button type="button" data-never="${esc(row.id)}"${id}>屏蔽</button>
      </div>`
    : '';
  return `<div class="slot${row.isNow ? ' now' : ''}">
  <div class="pic">${pic}</div>
  <div class="info">
    <div class="t">${esc(row.time)}${row.isNow ? ' · 现在' : ''}</div>
    <div class="n">${esc(row.title)}${row.place ? ` <span class="muted">@${esc(row.place)}</span>` : ''}</div>
    <div class="s"><span class="pill">${esc(row.scene)}</span>${outfit?.tier ? ` <span class="pill">${esc(outfit.tier)}</span>` : ''} ${esc(outfit?.name ?? '还没配')}${outfit ? ` · <span class="mono">${esc(outfit.id)}</span>` : ''}</div>
  </div>
  ${actions}
</div>`;
}

export function wardrobeSettingsPage(data: WardrobePageData): string {
  const { today, config, stats, personas } = data;
  const now = today?.now;
  const me = today?.persona;
  const malePersonas = (personas ?? []).filter((p) => p.gender === 'male');
  const genderNotice = me?.gender === 'male'
    ? `<div class="alert bad"><strong>当前人格「${esc(me.name)}」标为男性，但库里没有男装/中性款。</strong> 选衣会回落到现有女装库，进入生图会不匹配。建议先导入男装库，或在下面核对性别后关闭每轮穿搭注入。</div>`
    : malePersonas.length
      ? `<div class="alert bad"><strong>有 ${malePersonas.length} 个男性人格，当前库没有男装/中性款。</strong> 这些角色仍会按现有女装库选衣，进入生图会不匹配。请导入男装库，或在下面把性别核对后关闭穿搭注入。</div>`
      : `<div class="alert"><strong>当前服装库没有男装/中性款。</strong> 男性人格请先在“人格性别”里标为“男”；如果库仍没有男装，选衣会回落到现有库并提示，不会悄悄按女装当男装。</div>`;
  const personaRows = (personas ?? []).map((p) => {
    const policy = config.personaPolicy?.[p.id] ?? 'auto';
    const genderChoice = config.personaGender?.[p.id] ?? 'auto';
    const age = p.age === null ? '年龄未标注' : `${p.age} 岁`;
    const state = p.adult ? '成年 · 可解锁私密/泳装/派对' : '未成年 · 只用日常款';
    const genderText = p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未标注';
    const ageValue = config.personaAge?.[p.id] ?? '';
    const genderFrom = p.genderSource === 'host' ? '（宿主资料）' : p.genderSource === 'config' ? '（手动标记）' : '';
    const genderPill = p.gender === 'male'
      ? `<span class="pill bad">性别：男 · 当前库可能没有男装</span>`
      : `<span class="pill${p.gender === 'female' ? ' good' : ''}">性别：${genderText}${genderFrom}</span>`;
    return `<label>${esc(p.name)}（${esc(p.id)}）
      <span class="hint" style="display:block">${esc(age)} · ${esc(state)} ${genderPill}</span>
      <input type="number" name="age_${esc(p.id)}" min="1" max="120" value="${ageValue}" placeholder="显式年龄，留空按未标注">
      <select name="policy_${esc(p.id)}">
        <option value="auto"${policy === 'auto' ? ' selected' : ''}>按年龄自动</option>
        <option value="minor"${policy === 'minor' ? ' selected' : ''}>强制未成年</option>
        <option value="adult"${policy === 'adult' ? ' selected' : ''}>成年（年龄未满时不生效）</option>
      </select>
      <select name="gender_${esc(p.id)}" aria-label="人格性别">
        <option value="auto"${genderChoice === 'auto' ? ' selected' : ''}>性别：按宿主资料/未标注</option>
        <option value="female"${genderChoice === 'female' ? ' selected' : ''}>性别：女</option>
        <option value="male"${genderChoice === 'male' ? ' selected' : ''}>性别：男</option>
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
    <div class="row" style="margin:6px 0 0">
      <button type="button" id="rerollNow">现在换一套</button>
      <button type="button" id="altNow">看备选</button>
      <button type="button" id="lockToggle">${today?.locked ? '已锁定 · 解锁' : '锁定今天'}</button>
      <a href="/plugins/schedule/settings" style="text-decoration:none"><button type="button">日程设置</button></a>
    </div>
  </div>
</div>`
    : `<p class="muted">今天还没有日程，先去日程里排一排，衣柜会自动配。</p>`;

  const weather = today?.weather
    ? `${esc(today.weather.text ?? '')} ${today.weather.min ?? '—'}–${today.weather.max ?? '—'}℃ · ${esc(today.weatherSourceLabel ?? '按月份')}`
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
    <p class="sub">日程的子插件 · 服装库${stats.libraryBundled ? '（内置）' : '（自定义）'} · ${stats.assetMode === 'remote' ? '云端图源' : '本地图源'} · v${esc(data.version)}</p>
  </div>
  <div class="row" style="margin:0"><span class="pill">${stats.outfits} 套入库</span><span class="pill">${esc(me?.name ?? '默认人格')} ${me?.adult ? '成年' : '未成年'}</span></div>
</header>

<div id="msg"></div>
${genderNotice}

<section class="card">
  <h2>现在穿 <span class="pill">${esc(weather)}</span>${today?.locked ? ' <span class="pill">已锁定</span>' : ''}</h2>
  ${hero}
  <div id="altPanel"></div>
</section>

<section class="card">
  <h2>今天的安排</h2>
  ${list}
</section>

<section class="card">
  <h2>多日打包</h2>
  <div class="row">
    <input type="date" id="packStart" value="${esc(today?.date ?? '')}" aria-label="打包开始日期">
    <input type="date" id="packEnd" value="${esc(today?.date ?? '')}" aria-label="打包结束日期">
    <button type="button" id="packRun">生成打包</button>
  </div>
  <pre id="packOut" class="hint" style="white-space:pre-wrap"></pre>
</section>

<section class="card">
  <h2>设置</h2>
  <form id="form">
    <div class="grid3">
      <label>每轮告诉当前人格今天穿什么
        <select name="inject"><option value="1"${config.inject ? ' selected' : ''}>开</option><option value="0"${config.inject ? '' : ' selected'}>关</option></select>
      </label>
      <label>最近几天不重复<input type="number" name="avoidDays" min="1" max="10" value="${config.avoidDays}"></label>
      <label>服装库根目录
        <input type="text" name="libraryRoot" value="${esc(config.libraryRoot)}" placeholder="留空 = 内置 library/">
        <span class="hint" style="display:block">当前：${esc(stats.libraryPath || '未设置')}${stats.libraryBundled ? '（插件内置）' : ''}</span>
      </label>
    </div>
    <div class="grid3" style="margin-top:10px">
      <label>图片 CDN 前缀
        <input type="text" name="assetBaseUrl" value="${esc(config.assetBaseUrl)}" placeholder="https://.../assets/">
        <span class="hint" style="display:block">留空 = 从本地库读图；填了就 302 到 CDN，HOM-* 仍走本地。</span>
      </label>
      <label>重新导入的源目录
        <input type="text" name="importRoot" value="${esc(config.importRoot)}" placeholder="留空 = 用上面的服装库">
        <span class="hint" style="display:block">换库时填库根目录（含 data/costume-zh.json 的那一层）。</span>
      </label>
      <label>成年年龄线<input type="number" name="adultThreshold" min="18" max="30" value="${config.adultThreshold}"></label>
    </div>
    <div class="grid3" style="margin-top:10px">
      <label>人格设定读不到年龄时
        <select name="unknownPersona">
          <option value="minor"${config.unknownPersona !== 'adult' ? ' selected' : ''}>按未成年（推荐）</option>
          <option value="adult"${config.unknownPersona === 'adult' ? ' selected' : ''}>按成年</option>
        </select>
      </label>
    </div>
    <p class="hint">人格分级：显式年龄满 ${config.adultThreshold} 岁才解锁私密/泳装/派对；年龄未满 ${config.adultThreshold} 岁时，手动改成“成年”也不会生效。商城环境不读取宿主私有文件，年龄请在这里填。</p>
    ${personaRows ? `<div class="grid3" style="margin-top:10px">${personaRows}</div>` : ''}
    <p class="hint">性别只用于筛选服装和画室提示，不会改人格设定：显式标记优先，其次用宿主公开资料；当前库没有对应性别时回落到现有库并给出提示。</p>
    <label style="display:block;margin-top:10px">分类映射（JSON）：分类名 → 季节 / 分级 / 场景
      <textarea name="categoryMap" rows="10" spellcheck="false" style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(JSON.stringify(config.categoryMap ?? {}, null, 2))}</textarea>
    </label>
    <p class="hint">共 ${stats.outfits} 套入库：日常 ${stats.tiers.general ?? 0}、私密 ${stats.tiers.private ?? 0}、泳装 ${stats.tiers.swim ?? 0}、派对 ${stats.tiers.party ?? 0}。普通日程段共用一套主穿搭，只有回家/泳池/晚宴/运动才换。未成年人格只用日常款；成年人格在泳池/海边匹配泳装、晚宴派对匹配礼服、居家可匹配私密款。年龄按上面显式填写，未填且宿主没给年龄时按未成年处理。</p>
    <div class="row">
      <button type="submit">保存设置</button>
      <button type="button" id="import">重新导入服装库</button>
    </div>
  </form>
  <details style="margin-top:14px">
    <summary class="muted">库统计</summary>
    <p class="hint">分级：${tierStats || '—'}</p>
    <p class="hint">场景：${sceneStats || '—'}</p>
    <p class="hint">导入时间：${esc(stats.report?.generatedAt ?? '—')}；来源 ${esc(stats.report?.library ?? '—')}；图源 ${esc(stats.assetBaseUrl || '本地文件')}</p>
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

const DATE = ${JSON.stringify(today?.date ?? '')};
const LOCKED = ${Boolean(today?.locked)};
function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function showAlternatives(blockId) {
  const panel = $('#altPanel');
  panel.innerHTML = '<p class="hint">正在找备选…</p>';
  try {
    const r = await post({ action: 'alternatives', date: DATE, blockId: blockId || undefined, count: 3 });
    if (!r.ok) throw new Error(r.error || '没找到备选');
    const result = r.result;
    if (!result.items.length) { panel.innerHTML = '<p class="hint">没有更多备选，可能是服装库太小或都被排除了。</p>'; return; }
    const cards = result.items.map((item) =>
      '<div class="altCard" data-apply="' + escHtml(item.id) + '">' +
        '<img src="' + escHtml(item.thumb) + '" alt="" loading="lazy" onerror="this.remove()">' +
        '<div class="name">' + escHtml(item.name) + '</div>' +
        '<div class="why">' + escHtml(item.id) + ' · ' + escHtml(item.score) + ' 分 · ' + escHtml(item.reason) + '</div>' +
      '</div>').join('');
    panel.innerHTML = '<div class="altGrid">' + cards + '</div><p class="hint">点一套直接换上。</p>';
    panel.querySelectorAll('[data-apply]').forEach((card) => card.addEventListener('click', async () => {
      card.style.opacity = '0.5';
      try {
        const r2 = await post({ action: 'wear', date: DATE, blockId: blockId || undefined, id: card.dataset.apply });
        if (!r2.ok) throw new Error(r2.error || '换装失败');
        msg('换好了：' + (r2.result.outfit?.name || card.dataset.apply));
        setTimeout(() => location.reload(), 650);
      } catch (err) { msg(String(err.message || err), true); card.style.opacity = ''; }
    }));
  } catch (err) { panel.innerHTML = ''; msg(String(err.message || err), true); }
}

document.querySelectorAll('[data-alt]').forEach((btn) => btn.addEventListener('click', () => showAlternatives(btn.dataset.alt)));
$('#altNow')?.addEventListener('click', () => showAlternatives(''));

document.querySelectorAll('[data-fav], [data-dislike], [data-never]').forEach((btn) => btn.addEventListener('click', async () => {
  const id = btn.dataset.id;
  if (!id) return;
  btn.disabled = true;
  try {
    const action = btn.dataset.fav ? 'like' : btn.dataset.dislike ? 'dislike' : 'never';
    const r = await post({ action: 'feedback', feedbackAction: action, id, date: DATE });
    if (!r.ok) throw new Error(r.error || '记录失败');
    msg(action === 'like' ? '已记为喜欢' : action === 'never' ? '已屏蔽，不再自动出现' : '已记为不喜欢');
    setTimeout(() => location.reload(), 650);
  } catch (err) { msg(String(err.message || err), true); btn.disabled = false; }
}));

$('#lockToggle')?.addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await post({ action: 'lock', date: DATE, locked: !LOCKED });
    if (!r.ok) throw new Error(r.error || '锁定失败');
    msg(r.result.locked ? '今天已锁定，不再自动改衣' : '已解锁，恢复自动重配');
    setTimeout(() => location.reload(), 650);
  } catch (err) { msg(String(err.message || err), true); e.target.disabled = false; }
});

$('#packRun')?.addEventListener('click', async (e) => {
  const start = $('#packStart').value;
  const end = $('#packEnd').value;
  if (!start || !end) return msg('先选开始和结束日期', true);
  e.target.disabled = true;
  $('#packOut').textContent = '正在打包…';
  try {
    const r = await post({ action: 'pack', start, end });
    if (!r.ok) throw new Error(r.error || '打包失败');
    const result = r.result;
    $('#packOut').textContent = result.days.map((day) => {
      const specials = Object.entries(day.specials || {}).map(([scene, outfit]) => scene + ':' + ((outfit && outfit.name) || '—'));
      return day.date + '  ' + ((day.base && day.base.name) || '—') + (specials.length ? '  ' + specials.join('，') : '');
    }).join('\\n') + '\\n共 ' + result.days.length + ' 天 · ' + result.uniqueOutfits + ' 套';
    $('#packOut').textContent += '\\n' + result.note;
  } catch (err) { $('#packOut').textContent = String(err.message || err); }
  e.target.disabled = false;
});
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const personaPolicy = {};
  const personaGender = {};
  const personaAge = {};
  for (const [key, value] of f.entries()) {
    if (key.startsWith('policy_') && value !== 'auto') personaPolicy[key.slice(7)] = value;
    if (key.startsWith('gender_') && value !== 'auto') personaGender[key.slice(7)] = value;
    if (key.startsWith('age_')) {
      const age = Number(value);
      if (value && Number.isFinite(age) && age >= 1 && age <= 120) personaAge[key.slice(4)] = Math.round(age);
    }
  }
  try {
    const r = await post({ action: 'save', config: {
      inject: f.get('inject') === '1',
      avoidDays: Number(f.get('avoidDays')),
      libraryRoot: String(f.get('libraryRoot') || ''),
      assetBaseUrl: String(f.get('assetBaseUrl') || ''),
      importRoot: String(f.get('importRoot') || ''),
      adultThreshold: Number(f.get('adultThreshold')),
      unknownPersona: String(f.get('unknownPersona') || 'minor'),
      categoryMap: String(f.get('categoryMap') || ''),
      personaPolicy,
      personaAge,
      personaGender,
    } });
    if (!r.ok) throw new Error(r.error || '保存失败');
    msg('设置已保存');
  } catch (err) { msg(String(err.message || err), true); }
});
$('#import').addEventListener('click', async (e) => {
  e.target.disabled = true;
  msg('正在扫描服装库，可能要十几秒…');
  try {
    const r = await post({ action: 'import', root: $('#form').elements.importRoot.value || $('#form').elements.libraryRoot.value });
    if (!r.ok) throw new Error((r.result && r.result.stderr) || r.error || '导入失败');
    msg('导入完成：' + JSON.stringify(r.result && r.result.kept ? { kept: r.result.kept } : r.result));
    setTimeout(() => location.reload(), 900);
  } catch (err) { msg(String(err.message || err), true); e.target.disabled = false; }
});
</script>
</main></body></html>`;
}
