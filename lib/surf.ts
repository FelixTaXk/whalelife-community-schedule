/*! 日程 plugin · 网上冲浪可选排期：只识别已经注册的视频工具，不导入平台实现。 */

export type SurfTarget = {
  id: string;
  label: string;
  /** 已注册的浏览/搜索工具，按发现顺序保留。 */
  tools: string[];
  /** 这条排期可以怎么用，写成给人格看的短提示。 */
  hint: string;
};

type PlatformDef = {
  id: string;
  label: string;
  /** 至少有一个就视为平台可用；优先用 browse。 */
  probes: string[];
  browse: string;
  view?: string;
  grab?: string;
};

/**
 * 这些名字是网上冲浪子插件的公开工具名，不是本机路径或账号数据。
 * 未安装、未启用或宿主没有注册工具时，平台不会出现在设置和日程里。
 */
const PLATFORMS: readonly PlatformDef[] = [
  {
    id: 'bilibili',
    label: 'B 站',
    probes: ['bilibili_browse', 'bilibili_search', 'bilibili_open'],
    browse: 'bilibili_browse',
    view: 'bilibili_watch',
    grab: 'bilibili_search',
  },
  {
    id: 'douyin',
    label: '抖音',
    probes: ['douyin_feed', 'douyin_binge', 'douyin_search'],
    browse: 'douyin_feed',
    view: 'douyin_view',
    grab: 'douyin_binge',
  },
];

type ToolDescriptor = { name?: string; function?: { name?: string } };

export function detectSurfTargets(tools: readonly ToolDescriptor[]): SurfTarget[] {
  const names = new Set<string>();
  for (const tool of tools) {
    const name = tool.name || tool.function?.name;
    if (name) names.add(name);
  }
  const targets: SurfTarget[] = [];
  for (const platform of PLATFORMS) {
    if (!platform.probes.some((name) => names.has(name))) continue;
    const available: string[] = [];
    for (const name of [platform.browse, platform.grab, platform.view]) {
      if (name && names.has(name) && !available.includes(name)) available.push(name);
    }
    const hint = available.length
      ? `这条是给自己排的冲浪时间。可用工具：${available.join(' / ')}；想刷就刷，不想刷可以把这条标成跳过，不自动播放。`
      : '这条是给自己排的冲浪时间；当前没有发现可用的平台工具，先装对应子插件。';
    targets.push({ id: platform.id, label: platform.label, tools: available, hint });
  }
  return targets;
}

/** 配置里选中的平台；空数组表示所有当前可用的平台。 */
export function chooseSurfTargets(config: { platforms: string[] }, targets: SurfTarget[]): SurfTarget[] {
  if (!config.platforms.length) return [...targets];
  return targets.filter((target) => config.platforms.includes(target.id));
}
