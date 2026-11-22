/*! 日程 plugin · 天气桥：父插件读不到子插件的本地服务，改用宿主事件总线请求快照。
 * 子插件不在时请求超时，日程照常工作、只是不显示天气。 */

import type { Context } from '../../../core/context.ts';
import type { WeatherDay, WeatherSnapshot } from './weather-types.ts';
import { WEATHER_REQUEST_EVENT, WEATHER_SNAPSHOT_EVENT } from './weather-types.ts';
import { headline } from './weather-format.ts';

type Reply = { snapshot?: WeatherSnapshot | null; error?: string };
type Pending = { finish: (reply: Reply | null) => void };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WeatherBridge {
  private ctx: Context;
  private last: WeatherSnapshot | null = null;
  private reachable = false;
  private lastError = '';
  private seq = 0;
  private pending = new Map<string, Pending>();

  private constructor(ctx: Context) {
    this.ctx = ctx;
  }

  static create(ctx: Context): WeatherBridge {
    const bridge = new WeatherBridge(ctx);
    ctx.on(WEATHER_SNAPSHOT_EVENT, (payload: any) => {
      const id = typeof payload?.id === 'string' ? payload.id : '';
      const pending = bridge.pending.get(id);
      if (!pending) return;
      bridge.pending.delete(id);
      pending.finish({
        snapshot: payload?.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null,
        error: typeof payload?.error === 'string' ? payload.error : undefined,
      });
    });
    // 启动时探一次；子插件可能还没加载，就绪后再探一次，尽早把天气放进本地缓存。
    void bridge.probe().catch(() => undefined);
    ctx.on('whalelife/ready', () => { void bridge.probe().catch(() => undefined); });
    return bridge;
  }

  get available(): boolean {
    return this.reachable;
  }

  get error(): string {
    return this.lastError;
  }

  /** 最近一次快照，不发请求。 */
  peek(): WeatherSnapshot | null {
    return this.last;
  }

  private request(force: boolean, timeoutMs: number): Promise<WeatherSnapshot | null> {
    return new Promise((resolve) => {
      const id = `w${this.seq += 1}`;
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.pending.delete(id);
        this.reachable = false;
        resolve(this.last);
      }, timeoutMs);
      timer.unref?.();
      const finish = (reply: Reply | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(id);
        if (!reply) {
          this.reachable = false;
          resolve(this.last);
          return;
        }
        this.reachable = true;
        if (reply.snapshot) {
          this.last = reply.snapshot;
          this.lastError = '';
        } else if (reply.error) {
          this.lastError = reply.error;
        }
        resolve(this.last);
      };
      this.pending.set(id, { finish });
      try {
        this.ctx.emit(WEATHER_REQUEST_EVENT, { id, force });
      } catch (error) {
        this.ctx.logger.warn('请求天气事件失败', { error: errorText(error) });
        finish(null);
      }
    });
  }

  /** 页面/设置用：最多等 1.2 秒，顺便判断子插件是否在线。 */
  async probe(): Promise<WeatherSnapshot | null> {
    return this.request(false, 1200);
  }

  /** 日历用：最多等 350 毫秒，拿不到就用上次缓存，不拖慢日程。 */
  async quick(): Promise<WeatherSnapshot | null> {
    return this.request(false, 350);
  }

  /** 生成日程用：要盖住子插件的一次真实取数（含一次重试），慢一点也要拿到天气。 */
  async refresh(force = false): Promise<WeatherSnapshot | null> {
    return this.request(force === true, 10000);
  }

  async day(date: string): Promise<WeatherDay | null> {
    const snapshot = await this.refresh();
    return snapshot?.days.find((entry) => entry.date === date) ?? null;
  }

  /** 一行天气，用于 schedule_today / schedule_now 末尾；没有数据时返回空串。 */
  async line(date: string): Promise<string> {
    const snapshot = await this.refresh();
    if (!snapshot) return '';
    if (!snapshot.days.length && !snapshot.now) return '';
    const text = headline(snapshot, date);
    return text ? `天气：${text}` : '';
  }

  /** 设置页摘要：子插件不在线时给一句可操作的提示。 */
  async settingsSummary(): Promise<string> {
    const snapshot = await this.probe();
    if (!this.reachable) return '天气子插件没有启用或没有响应：日程照常使用。可以在插件管理里启用「日程 · 天气」，或重载日程插件。';
    if (!snapshot) return this.lastError ? `子插件在线，但取不到天气：${this.lastError}` : '子插件在线，还没有取到天气，打开天气设置页可以手动刷新。';
    const place = snapshot.place || '本地';
    const today = snapshot.days[0];
    const parts = [`${place} · ${snapshot.error ? '上次数据' : '已更新'}`];
    if (snapshot.now) parts.push(`现在 ${snapshot.now.temperature}℃ ${snapshot.now.text}`);
    if (today) parts.push(`今天 ${today.text} ${today.min}–${today.max}℃`);
    if (today?.tip) parts.push(today.tip);
    if (snapshot.error) parts.push(`刷新失败：${snapshot.error}`);
    return parts.join(' · ');
  }
}
