# 日程 · 衣柜（wardrobe）

日程的子插件。数据**只来自 ComfyUI 服装库**，按当天日程、天气、季节配一套主穿搭，只有特殊场景才换；同时按**人格年龄 + 场景**分级，未成年人格只用日常款，成年人格才解锁私密/泳装/派对。

## 数据：全量 1407 套

源：`D:\ComfyUI\custom_nodes\comfyui-costume-gallery\library\data\costume-zh.json`

| 分类 | 套数 | tier | 可用场景 |
| --- | --- | --- | --- |
| 春/夏/秋/冬 | 966 | `general` | 日常、上学、通勤、居家、运动 |
| 内衣 + 性感 | 339 | `private` | `home`（居家/起床/洗漱/睡前） |
| 泳装 | 54 | `swim` | `swim`（泳池/海边/温泉/戏水） |
| 派对 | 48 | `party` | `party`（晚宴/派对/年会/婚礼） |

- **1407 套全部入库，零关键词删减**，`import-report.json` 里 `kept=1407`、`dropped` 为空。
- 服装库本身没有逐套 `level/rating`，只有分类；`tier` 是导入时按分类映射出来的，这是唯一的分级依据。
- 条目带 `tier` 与 `rating`（`general` / `adult`），`report.tiers` 记录四类数量。
- 图片不复制：`thumb` / `preview` 只存相对路径，页面走 `/plugins/schedule/wardrobe/thumb` 回源。

## 人格分级

`lib/policy.ts` 从宿主 `config/config.json` 找到人格 md，用 `/(\d{1,3})\s*岁/` 读年龄；读不到就看设置。

- 年龄 ≥ `adultThreshold`（默认 18）→ 成年，解锁 `private/swim/party`；
- 年龄 < 18 → 未成年，只允许 `general`；即使手动改成“成年”也不生效；
- 读不到年龄 → 默认按未成年，可在设置里把该人格标成成年，或把“未标年龄”的默认改成成年。

场景闸门在 `lib/picker.ts`：

| 人格 | 泳池/海边 | 晚宴/派对 | 居家 | 日常 |
| --- | --- | --- | --- | --- |
| 未成年 | 回落到日常运动款，不穿泳装 | 回落到日常连衣裙，不穿礼服 | 回落到 `cozy` 日常款 | 日常款 |
| 成年 | 只允许 `swim` | 只允许 `party` | 允许 `private` + 日常 | 日常款，不穿私密 |

成年人格在 `home` 场景固定一套私密/居家款，不是每段重摇；在 `swim/party` 是硬匹配，不会拿日常款凑数。

## 状态隔离

`state.json` 结构：

```json
{
  "personas": {
    "whale": {
      "days": {
        "2026-11-22": {
          "base": "AUT-0136",
          "specials": { "home": "AUT-0249" },
          "blocks": { "i1": "AUT-0249", "i2": "AUT-0136" },
          "overrides": {}
        }
      },
      "recent": [...]
    },
    "another-persona": { "days": {...}, "recent": [...] }
  }
}
```

`base` 是当天主穿搭，`specials` 是 home/swim/party/active 各一套。每个人格一份，成年人格在泳池配的泳装不会串到未成年人格。旧版 `{days,recent}` 会自动迁移到宿主默认人格。

## 目录

```
sub/wardrobe/
├─ index.ts                 入口：工具/页面、每轮注入【穿搭】、加载时固定当天
├─ plugin.yaml
├─ lib/
│  ├─ catalog.ts            catalog.json、缩略图 URL
│  ├─ config.ts             inject / avoidDays / libraryRoot / adultThreshold / unknownPersona / personaPolicy
│  ├─ policy.ts             从人格设定读年龄、算 adult、列出人格
│  ├─ plan.ts               日程 day 文件、场景/季节/天气
│  ├─ picker.ts             tier 闸门 + 打分选衣
│  ├─ service.ts            todayView / snapshot / wear / pick / import / stats
│  ├─ state.ts              按人格存每天每段穿搭
│  ├─ tools.ts              5 个模型工具
│  └─ web.ts                设置页 + thumb/data API
├─ ui/settings.ts           设置页（人格分级、保存、重新导入、统计）
├─ scripts/import-costume.mjs
└─ data/{catalog.json, import-report.json, state.json}
```

## 和日程联动

- 读 `plugins/schedule/data/days/YYYY-MM-DD.json` 的 `items[]`。
- **一天一套主穿搭**：普通段（daily/school/outer/cozy）全穿 `day.base`，当天只挑一次；有 school 段时优先按 school 挑主穿搭。
- **特殊场景才换**：`home`、`swim`、`party`、`active` 各固定一套放在 `day.specials`，同场景连续段复用；离开特殊场景回到主穿搭。
- 普通一天通常只有主穿搭 + 居家两套；有泳池/晚宴/运动才多出第三、四套。
- `sceneForBlock` 按标题/地点/开始时间判 `school / active / cozy / outer / daily / home / swim / party`。
- `seasonBand` 优先天气温度，没天气退月份；`all` 季节条目给固定加成。
- 打分：季节 42/22、场景 +24、雨天外套 +14、冷天无外套 −8、热天外套 −10、关键词 ±22/−40、最近 −18、当天已用 −26、随机 0–6。
- `ensureDay` 写 `state.personas[人格]`；人格分级变化时会重配不合规的旧搭配。
- 每轮给当前人格注入 `【穿搭】…`，设置里可关。

## 工具

`wardrobe_today` / `wardrobe_now` / `wardrobe_for` / `wardrobe_pick` / `wardrobe_wear`。工具都从 `session.personaId` 取当前人格；`wardrobe_wear` 指定成人 id 时，未成年人格会被拒绝。

## 设置

`/plugins/schedule/wardrobe/settings`：

- 上下文注入、避免重复天数、服装库根目录；
- 成年年龄线、未标年龄人格的默认策略；
- 每个人格一行：显示读到年龄/当前判定，可设“按年龄自动 / 强制未成年 / 成年（未满不生效）”；
- 重新导入、分级与场景统计。

## 生效

```powershell
Invoke-RestMethod -Method Post 'http://127.0.0.1:9260/api/entries/whalelife/restart'
```

启动日志应出现：

`衣柜子插件已启用 {"version":"0.2.1","outfits":1407,"tiers":{"general":966,"private":339,"party":48,"swim":54}}`

## 已知限制

- 服装库没有逐套分级，只能按分类；上游以后若加 `level` 字段，应改成读字段。
- 「起床 · 洗漱」也会配一套；成年人格在该段可能拿到私密款，未成年只会拿日常款。
- 天气子插件未启用时，季节只按月份退化。
- 本插件只做选和记，不直接生成图片；studio 出图要另行把 `en` 关键词放进 prompt。



