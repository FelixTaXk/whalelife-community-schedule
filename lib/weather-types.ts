/*! 日程 · 天气子插件的共享契约（父插件与 sub/weather 都只依赖这个文件）。 */

export type WeatherNow = {
  at: string;
  temperature: number;
  apparent: number;
  humidity: number;
  precipitation: number;
  wind: number;
  code: number;
  text: string;
  icon: string;
  isDay: boolean;
};

export type WeatherHour = {
  /** 本地时间 YYYY-MM-DDTHH:00。 */
  time: string;
  date: string;
  hour: number;
  temperature: number;
  precipitation: number;
  precipitationProbability: number;
  code: number;
  text: string;
  icon: string;
};

export type WeatherDay = {
  date: string;
  code: number;
  text: string;
  icon: string;
  min: number;
  max: number;
  precipitation: number;
  precipitationProbability: number;
  windMax: number;
  sunrise: string;
  sunset: string;
  /** 一句话建议：带伞 / 适合出门 / 注意防晒… */
  tip: string;
  outdoor: boolean;
};

export type WeatherSnapshot = {
  version: 1;
  place: string;
  latitude: number;
  longitude: number;
  timezone: string;
  updatedAt: string;
  now: WeatherNow | null;
  days: WeatherDay[];
  /** 逐小时预报，最多 72 小时；父插件排户外/通勤用。 */
  hours?: WeatherHour[];
  error?: string;
};

/** 父插件与子插件之间的跨进程事件（父进程无法直接读取子插件的本地服务）。 */
export const WEATHER_REQUEST_EVENT = 'plugin:schedule:weather-request';
export const WEATHER_SNAPSHOT_EVENT = 'plugin:schedule/weather:snapshot';

