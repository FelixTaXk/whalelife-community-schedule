# 日程 · 衣柜（wardrobe）

日程的内置子插件，源码和发行包都并回日程主仓库；安装或更新日程时一起完成。安装后按当天日程、天气和季节给当前人格配穿搭。

## 安装与依赖

1. 先在插件商城安装或更新「日程」到 `0.8.2` 及以上，天气和衣柜会随主包一起装好；
2. 打开日程控制台里的「衣柜」页，或直接访问 `/plugins/schedule/wardrobe/settings`。
3. 之前装过独立衣柜的，先卸载独立衣柜再更新日程；卸载不清 `data/`，用户配置和导入记录都会保留。

日程父包的 `sub: [weather, wardrobe]` 与 `bundledPluginIds` 一起声明内置关系；发行包只带 `library/` 下的索引、缩略图和演示图，不带本地 `library/png` 原图快照。

## 功能

- **按日程配衣**：普通段共用当天主穿搭；回家、睡觉、泳池、晚宴、运动等特殊段单独换。
- **按天气/季节选**：优先用日程天气，其次天气子插件缓存，最后按月份；雨天加外套、冷天避薄、热天避厚。
- **人格分级**：显式年龄 + `adultThreshold`（默认 18）。未成年只用日常款；成年才解锁私密/泳装/派对。
- **性别筛选**：显式标记优先，其次宿主公开人格资料的性别；库里有对应性别/中性款就优先选，没有就回落并提示。
- **锁定当天**：锁定后日程/天气变化不自动改衣，手动换装仍有效。
- **备选**：给某一段生成 3–8 套候选，带分数和理由，点一下直接换上。
- **反馈**：喜欢加分、不喜欢减分、屏蔽后不再自动出现；只记在当前人格名下。
- **多日打包**：一次看 1–31 天的穿搭和重复套数，按整套复用统计，不拆上下装。
- **画室参考**：返回预览图地址/本地路径、英文关键词和生图提示词。
- **混搭提示**：把 2–4 套拆成上衣/下装/外套/鞋/配饰，生成一条混搭提示词和参考图列表；**只给提示，不合成新图**。
- **自动重配**：日程或天气的 `contextHash` 变化后自动重算；每 10 分钟兜底检查一次，锁定和手动覆盖不会被覆盖。

## 隐私与商城约束

- 不读取宿主私有配置文件，不读人格正文，不扫描本机目录找人格资料。
- 年龄只从设置页显式填写或宿主公开 `personas.list()` 返回的年龄取；性别同理。
- 所有路径都来自插件自身 `library/`、用户配置或环境变量，不写死盘符/用户名。
- `data/` 是运行数据，不随包分发；发行包只带 `library/` 下的索引和展示图。

## 服装库

内置演示库在 `library/`，索引优先读：

1. `data/catalog.json`（本地开发/重新导入后生成）
2. `library/catalog.json`（商城包兜底）
3. `library/data/catalog.json`

源数据格式为 `library/data/costume-zh.json`，每条至少包含：

```json
{
  "id": "SPR-0001",
  "分类": "春装",
  "关键词": ["白色", "衬衫", "半身裙"],
  "英文关键词": "white shirt, pleated skirt",
  "缩略图": "thumbs/SPR-0001.webp",
  "预览图": "img/SPR-0001.webp"
}
```

### 分类映射

设置页可编辑 `categoryMap`，把分类名翻译成季节/分级/场景/性别：

```json
{
  "春装": { "season": "spring", "tier": "general" },
  "家居服春": { "season": "spring", "tier": "general", "scenes": ["home", "sleep"] },
  "泳装": { "season": "summer", "tier": "swim", "scenes": ["swim"] },
  "男装": { "season": "all", "tier": "general", "gender": "male", "scenes": ["daily", "school", "outer", "active", "cozy"] }
}
```

- `season`：`spring / summer / autumn / winter / all`
- `tier`：`general / private / swim / party`
- `scenes`：可选；不写就按关键词自动打 `daily / school / active / cozy / outer / dress / skirt / pants`
- `gender`：可选 `female / male / unisex`；不写按女装处理

未识别的分类会进 `report.dropped.category`，不会静默丢数据。

### 换库 / 导入

- 设置页「重新导入的源目录」填库根目录（含 `data/costume-zh.json` 的那一层）；留空等于用当前库。
- 也可以命令行：

```bash
node scripts/import-costume.mjs /path/to/library
# 或
COSTUME_LIBRARY=/path/to/library COSTUME_CATEGORY_MAP='{"男装":{"season":"all","tier":"general","gender":"male"}}' node scripts/import-costume.mjs
```

- 导入会生成 `data/catalog.json` 与 `data/import-report.json`；如果导入的是插件内置 `library/`，同时写一份 `library/catalog.json` 供商城包兜底。
- 从外部库导入成功后，设置会自动把 `libraryRoot` 指过去，否则缩略图找不到。

### 图片与 CDN

- 留空 `assetBaseUrl`：从 `libraryRoot` 本地读图。
- 填 `https://…/assets/`：非 `HOM-*` 条目 302 到 CDN；`HOM-*` 家居服仍走本地。
- 发行包不带 `library/png` 原图，只带 `thumbs/`、`img/`、`data/catalog.json`（staging 时放到 `library/catalog.json`）。

## 配置

`data/config.json`（首次运行用默认值，设置页可改）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `inject` | `true` | 每轮是否注入 `【穿搭】…` |
| `avoidDays` | `3` | 多少天内尽量不重复 |
| `libraryRoot` | `""` | 库根目录；空 = 内置 `library/` |
| `assetBaseUrl` | `""` | 图片 CDN 前缀 |
| `importRoot` | `""` | 重新导入源目录 |
| `adultThreshold` | `18` | 成年线，最低 18 |
| `personaAge` | `{}` | 显式年龄：人格 id → 年龄 |
| `unknownPersona` | `minor` | 没有年龄时默认按未成年/成年 |
| `personaPolicy` | `{}` | 手动覆盖 `minor / adult`；年龄未满 18 时“成年”不生效 |
| `personaGender` | `{}` | 手动性别 `female / male` |
| `categoryMap` | 内置映射 | 分类 → 季节/分级/场景/性别 |

人格状态按 `personaId` 隔离；宿主没有提供人格时用中性 `default` 桶。

## 状态

`data/state.json`：

```json
{
  "personas": {
    "persona-a": {
      "days": {
        "2026-11-22": {
          "base": "AUT-0136",
          "specials": { "home": "AUT-0249" },
          "blocks": { "i1": "AUT-0249", "i2": "AUT-0136" },
          "overrides": {},
          "locked": true,
          "contextHash": "…"
        }
      },
      "recent": [{ "id": "AUT-0136", "date": "2026-11-21" }],
      "feedback": { "likes": [], "dislikes": [], "never": [] }
    }
  }
}
```

`base` 是当天主穿搭，`specials` 是特殊场景各一套，`overrides` 是手动换装。`locked` + `contextHash` 用来判断日程/天气/性别/成年线是否变了。

旧版 `{days, recent}` 会自动迁移到默认人格，不会因为升级丢历史。

## 工具

| 工具 | 用途 |
| --- | --- |
| `wardrobe_today` | 今天每段穿什么 |
| `wardrobe_now` | 现在/下一段穿什么 |
| `wardrobe_for` | 指定日期/时间/段 |
| `wardrobe_pick` | 按场景/季节/关键词挑候选 |
| `wardrobe_wear` | 手动换某段或整套 |
| `wardrobe_alternatives` | 某段 3–8 套备选 |
| `wardrobe_lock` | 锁定/解锁当天 |
| `wardrobe_feedback` | 喜欢/不喜欢/屏蔽/重置 |
| `wardrobe_pack` | 1–31 天打包 |
| `wardrobe_ref` | 画室参考图 + 提示词 |
| `wardrobe_combine` | 2–4 套混搭提示词 + 参考图 |

工具都从 `session.personaId` 取当前人格；成年款对未成年人格是硬拒绝，不会只给一句提示就放行。

## 场景规则

| 人格 | 泳池/海边 | 晚宴/派对 | 回家/居家 | 睡前/睡觉 | 日常 |
| --- | --- | --- | --- | --- | --- |
| 未成年 | 回落运动/日常款 | 回落日常连衣裙 | 优先家居服 `home` | 优先家居服 `sleep` | 日常款 |
| 成年 | 只允许 `swim` | 只允许 `party` | `private` 优先，其次家居服 | 家居服 | 日常款，不穿私密 |

`home/sleep` 在未成年时会优先只从家居服池里挑；库里没有家居服才回落，避免拿私密款凑数。

## 目录

```text
sub/wardrobe/
├─ index.ts                 入口：工具/页面/注入/定时重配
├─ plugin.yaml
├─ library/                 演示库：catalog、thumbs、img、data/costume-zh.json
├─ lib/
│  ├─ catalog.ts            索引加载、缩略图 URL
│  ├─ config.ts             配置归一化
│  ├─ paths.ts              库路径解析
│  ├─ policy.ts             公开人格资料 + 显式年龄/性别
│  ├─ plan.ts               日程 day、场景/季节/天气
│  ├─ picker.ts             分级/性别闸门 + 打分 + contextHash
│  ├─ pieces.ts             关键词拆单品/色板/混搭
│  ├─ service.ts            today/snapshot/wear/alt/lock/feedback/pack/ref/combine
│  ├─ state.ts              按人格存天状态与反馈
│  ├─ tools.ts              11 个模型工具
│  └─ web.ts                设置页 + thumb/data API
├─ ui/settings.ts           设置页
├─ scripts/import-costume.mjs
└─ data/                    运行数据，不进发行包
```

## 已知限制

- 服装库是**整套图**：打包按整套复用，混搭只给关键词和参考图，不会凭空合成一张新图。
- 只有女装库时，男性人格会回落到现有库并提示；要真正男装需导入带 `gender: male` 的库。
- 分类没有逐套分级时，`tier` 只能按分类映射；上游若以后提供 `level/rating`，应改成读字段。
- 天气子插件只在预报窗口内给具体日期；窗口外按月份。
- 发行包不含 `library/png` 原图；需要原图请另行保存，运行和展示只用 `thumbs/`、`img/`。
