# 日程 · WhaleLife 插件

按作息自动排出她每天的时间表：到点补生成、跨天自动接上，聊天里问「今天有什么安排」「现在在干嘛」时读的是同一份计划，不靠临场编；每一轮对话还会把「现在在做什么、下一项是什么」直接放进迟宝的上下文。

- 版本：0.3.0
- 依赖：`tools` / `web` / `llm` / `models`（都是内置服务）；`context` 是宿主新增的每轮上下文服务，旧宿主没有时自动跳过；天气是可选子插件
- 数据：只写本插件 `data/`，不上传；时间按本机时区

## 能做什么

1. **自动生成**：每天 07:00（可在设置页改）生成今天和后面几天；错过时间、跨天、软件隔天再打开都会补今天。
2. **按作息铺时间**：起床、早餐、通勤、正事（上课/上班，可多选星期）、午饭、晚饭、运动、固定安排、睡前洗漱依次落位；中间空档用爱好池轮着铺，不会空一大片。
3. **手动兜底**：日程表里可以重排某天、加一项、改时间/标题/备注、标完成或跳过、删除。
4. **改动保护**：手动改过的计划会打上 `edited`，自动重排不再覆盖；只有明确 `force`（页面上的「重排这天」确认过）才覆盖。
5. **可选 AI 润色**：用 WhaleLife 里已配好的对话模型，把「自由 · 看剧」这类空档换成更具体的安排；模型失败/超时/返回不合法就保留规则骨架，并把原因记在计划里，不会卡住生成。
6. **给模型 5 个工具**：读今天、读此刻、读多天、生成、编辑。全部 `safe` 权限，异常只回文字、不抛给宿主。
7. **天气子插件（可选）**：`sub/weather` 走 Open-Meteo，不需要 API key，提供实时天气 + 未来 7 天预报；日程页当天卡片显示天气条、周页签显示天气图标，设置页显示摘要，`schedule_today` / `schedule_now` 末尾追加一行天气。子插件独立配置、独立启停，停用后日程照常工作。
8. **天气参与排程**：生成今天/未来几天时读取预报，雨雪、雷暴、高温会把运动和户外空档改成室内；周末天气好会留一段出门时间；因天气改过的计划会标记 `weatherAdjusted`，并在日程卡片和工具输出里说明。手动改过的计划仍然不会被覆盖。
9. **第一层：每轮注入**：通过宿主的 `ctx.context.register()`，在迟宝每轮对话时注入当天计划里的「正在做什么、到几点、下一项、后面几项、天气调整」。不是靠模型临时想起调工具，也不需要每次调用 `schedule_now`；只在 `whale` / 「周小迟」人格生效，其他人格不受影响。注入失败、插件停用或旧宿主没有 `context` 服务时，聊天照常，不会卡住。

天气自己的工具：`weather_now`（现在 + 今天建议）、`weather_forecast`（未来 1–7 天）。

## 安装与启用

插件已经在 `whalelife/plugins/schedule/`，WhaleLife 启动时会自动扫描加载。

- 0.3.0 的「每轮注入」需要宿主提供 `context` 服务；本目录配套的宿主补丁在 `core/context-feed.ts`、`core/plugin-api.ts`、`core/context.ts`、`core/plugin-worker.ts`、`core/runtime.ts`、`core/context-material.ts`、`core/session.ts`。只把插件目录复制到旧版 WhaleLife 时，日程、工具、页面都照常，只是不会自动注入上下文。
- 安装完成后**重启 WhaleLife**（或退出再打开），控制台「插件」列表出现「日程」；「日程 · 天气」收在父插件工作区的「子插件」页签里。
- 设置页：控制台 →「日程」→「设置」（`/plugins/schedule/settings`，需要控制台登录）。
- 天气设置：日程设置页的「打开天气设置」，或直接访问 `/plugins/schedule/weather/settings`。
- 日程表：左侧导航「日程」（`/plugins/schedule/calendar`）。
- 首次加载会自动排今天的计划；不想自动就关掉「启用自动生成」，已有计划仍可查看和手动生成。
- 新增/更新子插件后必须重启 WhaleLife，运行中的进程不会热扫 `sub/` 目录。

## 设置项

| 分组 | 字段 | 说明 |
| --- | --- | --- |
| 自动生成 | 开关、生成时间、预生成天数、保留天数 | 生成时间之后会补今天 + 后面 N-1 天；历史只留最近 N 天 |
| 作息 | 起床、睡觉、起床后洗漱、早餐、单程通勤、睡前洗漱 | 睡觉早于起床按「次日」算，末尾显示 `24:00` 和睡觉时间 |
| 正事 | 开关、名称、地点、星期、开始、结束 | 名称可写「上课」「上班」，会自动加往返通勤 |
| 三餐 / 运动 | 各自开关、时间、时长；运动可指定星期 | 午饭会把正事切成上午/下午两段 |
| 固定安排 | 多行文本 | 格式 `标题 \| 星期 \| 开始 \| 分钟 \| 地点`，星期写 `1-7`、`每天`、`工作日`、`周末` |
| 爱好池 | 每行一个 | 空档按日期轮换，不会每天一模一样 |
| AI 润色 | 开关、模型、额外要求 | 模型只从 WhaleLife 已有的对话模型里选；没选模型就只用规则骨架 |
| 天气（子插件） | 城市、经纬度、刷新间隔、预报天数、超时、接口地址 | 默认常州 `31.77359 / 119.95401`；建议用「按城市名定位」再保存 |

模板：设置页可一键套用「上学（默认）」「上班」「自由职业」三套作息，只覆盖作息字段，不动 AI 和保留天数。

## 生成规则（可预期，不随机跳）

1. 先放锚点，优先级：固定安排 > 三餐 > 正事 > 运动 > 通勤 > 起床/睡前。高优先级会切开低优先级（例如午饭把 9:00–18:00 切成两段）。
2. 空档 ≥ 30 分钟才铺自由安排；单段最多 120 分钟，长空档按 90 分钟切。
3. 同一天、同一套作息的结果是稳定的（按「日期 + 作息哈希」取爱好和基调），刷新页面不会变。
4. 睡觉跨零点时，睡前安排到 `24:00`，计划里记 `sleepAt: 00:30（次日）`。
5. 有预报时按天气改写：降水概率 ≥ 60% 或雨雪雷暴 → 运动加「室内 ·」，户外空档换成室内爱好；最高温 ≥ 33℃ 同样避开午后户外；周末晴好、15–28℃、降水概率 < 30% → 留一段「出去走走」。预报类别变化（晴转雨等）会让未手动改过的计划自动重排。

## 工具

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| `schedule_today` | `detail`: `brief` / `full` | 读今天，缺失会补生成 |
| `schedule_now` | — | 此刻在做什么、还剩多久、下一项 |
| `schedule_range` | `days` 1–7、`from` | 读未来几天，窗口内的缺计划会补 |
| `schedule_generate` | `date`、`force` | 生成/重排某天，`force` 覆盖手动改动 |
| `schedule_edit` | `action` add/update/remove/status，`id`、时间、标题等 | 加、改、删、标完成/跳过 |
| `weather_now` | — | 当前天气 + 今天温度/降水/出门建议（天气子插件提供） |
| `weather_forecast` | `days` 1–7 | 未来几天预报（天气子插件提供） |

工具说明里已经写明：问到日程先调用，不要凭记忆编造。

## HTTP 接口（页面用，均需登录）

- `POST /plugins/schedule/config`：`{action:"read"|"save"|"preset", config?, fixedText?, hobbiesText?, preset?}`
- `POST /plugins/schedule/data`：`{from, days}` → 一周/多天计划 + 配置摘要 + 运行状态 + `weather` 快照
- `POST /plugins/schedule/generate`：`{date?|dates?, force?}`
- `POST /plugins/schedule/item`：`{date, action, id?, start?, end?, title?, note?, place?, kind?, status?}`
- `POST /plugins/schedule/weather/config`：`{action:"read"|"geocode"|"save", city?, config?}`
- `POST /plugins/schedule/weather/data`：`{force?}` → 天气快照

## 数据与隐私

- `data/config.json`：设置。
- `data/days/YYYY-MM-DD.json`：每天的计划；`keepDays` 之外自动清理。
- `sub/weather/data/config.json`：天气配置（城市、经纬度、刷新间隔等）。
- 全部在本机。只有开启 AI 润色时才会把「当天已有安排 + 空档 + 你的额外要求」发给所选模型；不发送聊天记录、记忆或人格文件。
- 天气只把经纬度发给 Open-Meteo（`api.open-meteo.com` / `geocoding-api.open-meteo.com`），不发送日程、聊天或身份信息；不需要 API key。默认 30 分钟缓存，失败后约 60 秒内不重复请求。

## 测试

仓库自带 Node 24，可直接跑纯函数测试和临时宿主集成测试（不会碰你的真实 `config/` 和 `data/`）：

```powershell
cd D:\AI\whalelife
.\runtime\node-v24.22.1-win-x64\node.exe --test plugins\schedule\test\plan.test.ts plugins\schedule\test\integration.test.ts plugins\schedule\test\weather.test.ts
```

集成测试覆盖：插件加载、两个页面入口、自动补生成、编辑落盘、停用/重载、5 个日程工具、AI 成功与失败回退、第一层上下文注入（`context.render` 与真实模型请求里的 system 文本）；天气另用本地假接口覆盖 WMO 映射、预报解析、缓存/强制刷新、城市定位、父页面天气条、`schedule_today` 天气行、天气规则改写、生成时写入天气、子插件停用与恢复。

天气与父插件通过宿主事件总线通信（`plugin:schedule:weather-request` / `plugin:schedule/weather:snapshot`），因为父进程读不到子插件的本地 `provide` 服务；子插件停用后请求超时，父插件自动降级。

## 卸载

控制台停用「日程」→ 删除 `plugins/schedule/`（想连数据一起清就删掉目录里的 `data/`）→ 重启 WhaleLife。


## 手动安装

1. 下载本仓库（git clone 或 Code → Download ZIP）。
2. 把仓库内容放进 WhaleLife 本体的 plugins\schedule\ 目录；**目录名必须是 $id**（manifest 要求 id 与目录同名）。
3. 重启本体，或到控制台「插件管理」里重载该插件。
4. 在「插件管理」确认状态为「运行中」；首次使用请打开插件设置页完成必要配置。

本插件不包含任何运行时数据（data/ 已被忽略），升级时直接覆盖源码即可保留你自己的配置。