/*! 套装标签拆解：服装库只有整套图，这里从中文关键词里提取单品与色板，供展示和混搭提示词使用。 */

import type { Outfit } from './catalog.ts';

export type PieceKind = 'top' | 'bottom' | 'outer' | 'shoes' | 'accessory';

export type PieceView = {
  pieces: Record<PieceKind, string[]>;
  palette: string[];
  summary: string;
};

const RULES: Array<{ kind: PieceKind; words: string[] }> = [
  { kind: 'outer', words: ['大衣', '外套', '夹克', '风衣', '开衫', '羽绒', '马甲', '西装'] },
  { kind: 'bottom', words: ['连衣裙', '半身裙', '长裤', '短裤', '牛仔裤', '百褶', '裙', '裤'] },
  { kind: 'shoes', words: ['运动鞋', '高跟鞋', '凉鞋', '靴', '鞋', '乐福鞋'] },
  { kind: 'accessory', words: ['包', '帽', '袜', '围巾', '腰带', '耳环', '项链', '手链', '戒指', '眼镜'] },
  { kind: 'top', words: ['衬衫', 'T恤', '针织', '毛衣', '背心', '吊带', '卫衣', '短袖', '长袖', '上衣', '开衫'] },
];

const COLORS = [
  '白', '黑', '灰', '象牙白', '米', '杏', '粉', '红', '橙', '黄', '绿', '蓝',
  '紫', '棕', '咖', '卡其', '藏青', '牛仔', '银', '金',
];

function contains(hay: string, needle: string): boolean {
  return hay.includes(needle);
}

/** 按关键词归类；同一件词只落到一个类别，外套优先于上衣。 */
export function piecesOf(item: Outfit): PieceView {
  const words = Array.isArray(item.zh) ? item.zh.map(String) : [];
  const pieces: Record<PieceKind, string[]> = { top: [], bottom: [], outer: [], shoes: [], accessory: [] };
  const used = new Set<string>();
  for (const rule of RULES) {
    for (const word of words) {
      if (used.has(word)) continue;
      if (!rule.words.some((needle) => contains(word, needle))) continue;
      pieces[rule.kind].push(word);
      used.add(word);
    }
  }
  const palette = words.filter((word) => COLORS.some((color) => contains(word, color)));
  const summary = (['outer', 'top', 'bottom', 'shoes', 'accessory'] as PieceKind[])
    .flatMap((kind) => pieces[kind].map((word) => `${kind}:${word}`))
    .join(' / ');
  return { pieces, palette, summary };
}

/** 给混搭提示词用：每类最多取一件，优先让上衣和下装来自不同套装。 */
export function composePieces(items: Outfit[]): PieceView {
  const views = items.map((item) => piecesOf(item));
  const picked: Record<PieceKind, string[]> = { top: [], bottom: [], outer: [], shoes: [], accessory: [] };
  const topAt = views.findIndex((view) => view.pieces.top.length);
  for (const kind of ['outer', 'top', 'bottom', 'shoes', 'accessory'] as PieceKind[]) {
    let source = kind === 'bottom' && topAt >= 0 ? views.findIndex((view, index) => index !== topAt && view.pieces.bottom.length) : -1;
    if (source < 0) source = views.findIndex((view) => view.pieces[kind].length);
    if (source >= 0) picked[kind].push(views[source].pieces[kind][0]);
  }
  const palette = [...new Set(views.flatMap((view) => view.palette))].slice(0, 8);
  const summary = (['outer', 'top', 'bottom', 'shoes', 'accessory'] as PieceKind[])
    .flatMap((kind) => picked[kind].map((word) => `${kind}:${word}`))
    .join(' / ');
  return { pieces: picked, palette, summary };
}
