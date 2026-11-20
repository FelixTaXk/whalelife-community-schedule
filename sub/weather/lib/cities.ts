/*! 日程 · 天气子插件 · 常用城市坐标，中文城市名不必依赖英文地名接口。 */

export type CityEntry = { name: string; province: string; latitude: number; longitude: number };

export const CITIES: readonly CityEntry[] = [
  { name: '常州', province: '江苏', latitude: 31.77359, longitude: 119.95401 },
  { name: '北京', province: '北京', latitude: 39.9042, longitude: 116.4074 },
  { name: '上海', province: '上海', latitude: 31.2304, longitude: 121.4737 },
  { name: '广州', province: '广东', latitude: 23.1291, longitude: 113.2644 },
  { name: '深圳', province: '广东', latitude: 22.5431, longitude: 114.0579 },
  { name: '杭州', province: '浙江', latitude: 30.2741, longitude: 120.1551 },
  { name: '南京', province: '江苏', latitude: 32.0603, longitude: 118.7969 },
  { name: '苏州', province: '江苏', latitude: 31.2989, longitude: 120.5853 },
  { name: '无锡', province: '江苏', latitude: 31.4912, longitude: 120.3119 },
  { name: '宁波', province: '浙江', latitude: 29.8683, longitude: 121.5440 },
  { name: '成都', province: '四川', latitude: 30.5728, longitude: 104.0668 },
  { name: '重庆', province: '重庆', latitude: 29.5630, longitude: 106.5516 },
  { name: '武汉', province: '湖北', latitude: 30.5928, longitude: 114.3055 },
  { name: '西安', province: '陕西', latitude: 34.3416, longitude: 108.9398 },
  { name: '天津', province: '天津', latitude: 39.0842, longitude: 117.2009 },
  { name: '长沙', province: '湖南', latitude: 28.2282, longitude: 112.9388 },
  { name: '郑州', province: '河南', latitude: 34.7466, longitude: 113.6254 },
  { name: '济南', province: '山东', latitude: 36.6512, longitude: 117.1201 },
  { name: '青岛', province: '山东', latitude: 36.0671, longitude: 120.3826 },
  { name: '合肥', province: '安徽', latitude: 31.8206, longitude: 117.2272 },
  { name: '福州', province: '福建', latitude: 26.0745, longitude: 119.2965 },
  { name: '厦门', province: '福建', latitude: 24.4798, longitude: 118.0894 },
  { name: '昆明', province: '云南', latitude: 25.0389, longitude: 102.7183 },
  { name: '贵阳', province: '贵州', latitude: 26.6470, longitude: 106.6302 },
  { name: '南宁', province: '广西', latitude: 22.8170, longitude: 108.3665 },
  { name: '海口', province: '海南', latitude: 20.0440, longitude: 110.1999 },
  { name: '三亚', province: '海南', latitude: 18.2528, longitude: 109.5119 },
  { name: '沈阳', province: '辽宁', latitude: 41.8057, longitude: 123.4315 },
  { name: '大连', province: '辽宁', latitude: 38.9140, longitude: 121.6147 },
  { name: '长春', province: '吉林', latitude: 43.8171, longitude: 125.3235 },
  { name: '哈尔滨', province: '黑龙江', latitude: 45.8038, longitude: 126.5350 },
  { name: '石家庄', province: '河北', latitude: 38.0428, longitude: 114.5149 },
  { name: '太原', province: '山西', latitude: 37.8706, longitude: 112.5489 },
  { name: '南昌', province: '江西', latitude: 28.6820, longitude: 115.8579 },
  { name: '兰州', province: '甘肃', latitude: 36.0611, longitude: 103.8343 },
  { name: '西宁', province: '青海', latitude: 36.6171, longitude: 101.7782 },
  { name: '银川', province: '宁夏', latitude: 38.4872, longitude: 106.2309 },
  { name: '乌鲁木齐', province: '新疆', latitude: 43.8256, longitude: 87.6168 },
  { name: '呼和浩特', province: '内蒙古', latitude: 40.8426, longitude: 111.7492 },
  { name: '拉萨', province: '西藏', latitude: 29.6520, longitude: 91.1721 },
  { name: '香港', province: '香港', latitude: 22.3193, longitude: 114.1694 },
  { name: '澳门', province: '澳门', latitude: 22.1987, longitude: 113.5439 },
  { name: '台北', province: '台湾', latitude: 25.0330, longitude: 121.5654 },
  { name: '东莞', province: '广东', latitude: 23.0207, longitude: 113.7518 },
  { name: '佛山', province: '广东', latitude: 23.0219, longitude: 113.1211 },
  { name: '温州', province: '浙江', latitude: 27.9938, longitude: 120.6994 },
  { name: '绍兴', province: '浙江', latitude: 30.0023, longitude: 120.5811 },
  { name: '嘉兴', province: '浙江', latitude: 30.7522, longitude: 120.7550 },
  { name: '扬州', province: '江苏', latitude: 32.3942, longitude: 119.4129 },
  { name: '镇江', province: '江苏', latitude: 32.1878, longitude: 119.4250 },
  { name: '南通', province: '江苏', latitude: 31.9802, longitude: 120.8943 },
  { name: '徐州', province: '江苏', latitude: 34.2058, longitude: 117.2840 },
  { name: '盐城', province: '江苏', latitude: 33.3474, longitude: 120.1625 },
  { name: '淮安', province: '江苏', latitude: 33.5974, longitude: 119.0153 },
  { name: '连云港', province: '江苏', latitude: 34.5967, longitude: 119.2216 },
  { name: '宿迁', province: '江苏', latitude: 33.9633, longitude: 118.2753 },
  { name: '泰州', province: '江苏', latitude: 32.4849, longitude: 119.9155 },
];

export function findCity(name: string): CityEntry | null {
  const key = name.trim().replace(/市$/, '');
  return CITIES.find((entry) => entry.name === key) ?? null;
}

export function cityLabel(entry: CityEntry): string {
  return entry.province && entry.province !== entry.name ? `${entry.name} · ${entry.province}` : entry.name;
}
