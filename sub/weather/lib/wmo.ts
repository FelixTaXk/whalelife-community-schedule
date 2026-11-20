/*! 日程 · 天气子插件 · WMO 天气代码 → 中文与图标。 */

export type CodeInfo = { text: string; icon: string };

const INFO: Record<number, CodeInfo> = {
  0: { text: '晴', icon: '☀️' },
  1: { text: '晴间多云', icon: '🌤️' },
  2: { text: '多云', icon: '⛅' },
  3: { text: '阴', icon: '☁️' },
  45: { text: '雾', icon: '🌫️' },
  48: { text: '霜雾', icon: '🌫️' },
  51: { text: '小毛毛雨', icon: '🌦️' },
  53: { text: '毛毛雨', icon: '🌦️' },
  55: { text: '大毛毛雨', icon: '🌧️' },
  56: { text: '冻毛毛雨', icon: '🌧️' },
  57: { text: '强冻毛毛雨', icon: '🌧️' },
  61: { text: '小雨', icon: '🌦️' },
  63: { text: '中雨', icon: '🌧️' },
  65: { text: '大雨', icon: '🌧️' },
  66: { text: '冻雨', icon: '🌧️' },
  67: { text: '强冻雨', icon: '🌧️' },
  71: { text: '小雪', icon: '🌨️' },
  73: { text: '中雪', icon: '🌨️' },
  75: { text: '大雪', icon: '❄️' },
  77: { text: '米雪', icon: '❄️' },
  80: { text: '小阵雨', icon: '🌦️' },
  81: { text: '阵雨', icon: '🌧️' },
  82: { text: '强阵雨', icon: '⛈️' },
  85: { text: '小阵雪', icon: '🌨️' },
  86: { text: '强阵雪', icon: '❄️' },
  95: { text: '雷阵雨', icon: '⛈️' },
  96: { text: '雷暴伴小冰雹', icon: '⛈️' },
  99: { text: '雷暴伴大冰雹', icon: '⛈️' },
};

export function codeInfo(code: unknown): CodeInfo {
  const value = Number(code);
  return INFO[value] ?? { text: '未知天气', icon: '❓' };
}

export function isWet(code: number): boolean {
  return code >= 51;
}

/** 一句话出门建议；没有明显建议时返回空字符串。 */
export function dayTip(code: number, precipitationProbability: number, min: number, max: number): string {
  if (code >= 95) return '有雷雨，别在户外久留';
  if (code >= 71 && code <= 86) return '有雪，路滑慢点';
  if (isWet(code)) return '记得带伞';
  if (precipitationProbability >= 40) return '可能下雨，带把伞';
  if (max <= 3) return '很冷，穿厚一点';
  if (code <= 1 && max >= 30) return '晒，注意防晒';
  if (code <= 2 && precipitationProbability < 20 && min >= 5) return '适合出门走走';
  return '';
}

export function outdoorFriendly(code: number, precipitationProbability: number, max: number): boolean {
  return code < 51 && precipitationProbability < 40 && max >= 5;
}
