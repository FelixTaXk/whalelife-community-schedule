/*! 日程 plugin · 页面公共样式（自带，不依赖控制台 CSS）。 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const BASE_CSS = `
:root{color-scheme:light dark;--ink:#203438;--muted:#617477;--line:#dce6e5;--paper:#fff;--soft:#f4f8f7;
--accent:#126e68;--accent-soft:#e5f2f0;--warn:#a26a1f;--bad:#b23c3c;--good:#126e68;
font:15px/1.65 system-ui,-apple-system,"Microsoft YaHei",sans-serif;background:var(--soft);color:var(--ink)}
@media (prefers-color-scheme:dark){:root{--ink:#e4ecee;--muted:#9aadb2;--line:#2d3b3f;--paper:#1b2427;--soft:#151b1d;
--accent:#5cb5ad;--accent-soft:#223a39;--warn:#d6a863;--bad:#e08a8a}}
*{box-sizing:border-box}
body{margin:0;padding:28px 24px 36px;background:var(--soft);color:var(--ink)}
main{max-width:980px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;flex-wrap:wrap}
h1{font-size:26px;letter-spacing:-.5px;margin:0 0 4px;font-weight:650}
h2{font-size:16px;margin:0 0 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
p.sub{margin:0;color:var(--muted);font-size:13px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:16px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 18px}
.wide{grid-column:1/-1}
label{display:grid;gap:6px;font-size:13px;color:var(--muted)}
label.check{display:flex;align-items:center;gap:8px;color:var(--ink);font-size:14px}
input,select,textarea{font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);width:100%}
textarea{min-height:88px;resize:vertical;font-family:inherit}
input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent)}
input[type=time]{font-family:inherit}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:16px}
button{font:inherit;padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);cursor:pointer}
button:hover{border-color:var(--accent)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.ghost{background:transparent}
button.small{padding:4px 10px;font-size:12px}
button:disabled{opacity:.45;cursor:not-allowed}
.pill{font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.pill.good{color:var(--good);border-color:var(--good)}
.pill.bad{color:var(--bad);border-color:var(--bad)}
.pill.warn{color:var(--warn);border-color:var(--warn)}
.muted{color:var(--muted);font-size:13px}
.alert{border-left:3px solid var(--warn);background:rgba(162,106,31,.08);padding:10px 14px;border-radius:8px;margin:12px 0 0;font-size:13px}
.alert.bad{border-left-color:var(--bad);background:rgba(178,60,60,.08)}
.hint{font-size:12px;color:var(--muted);margin:6px 0 0;line-height:1.6}
.msg{min-height:20px;font-size:13px;color:var(--muted);margin-top:10px}
.days{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:999px;padding:3px 9px;font-size:12px;cursor:pointer;user-select:none}
.chip input{display:none}
.chip:has(input:checked){border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
@media (max-width:700px){.grid,.grid3{grid-template-columns:1fr}body{padding:18px 14px 28px}h1{font-size:22px}}
`;
