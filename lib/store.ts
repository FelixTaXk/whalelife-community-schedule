/*! 日程 plugin · 当天计划文件（data/days/YYYY-MM-DD.json）。 */

import { readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context } from '../../../core/context.ts';
import type { Plan } from './types.ts';
import { isPlan } from './types.ts';
import type { TravelChoice } from './travel.ts';
import { addDays } from './time.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DAYS_DIR = join(HERE, '..', 'data', 'days');

function fileName(date: string): string {
  return `days/${date}.json`;
}

export class Store {
  private ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  async read(date: string): Promise<Plan | null> {
    const raw = await this.ctx.config.read<unknown>(fileName(date));
    return isPlan(raw, date) ? raw : null;
  }

  async write(plan: Plan): Promise<void> {
    await this.ctx.config.save(fileName(plan.date), plan);
  }

  async remove(date: string): Promise<void> {
    try {
      await unlink(join(DAYS_DIR, `${date}.json`));
    } catch {
      // 不存在的文件视为已删除；其他错误留给调用方通过读取结果判断。
    }
  }

  /** 按日期升序返回已保存的日期键。 */
  async dates(): Promise<string[]> {
    try {
      const entries = await readdir(DAYS_DIR);
      return entries
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .map((name) => name.slice(0, 10))
        .sort();
    } catch {
      return [];
    }
  }

  /** 只保留最近 keepDays 天（含今天），未来日期不删。 */
  async prune(keepDays: number, today: string): Promise<number> {
    const limit = addDays(today, -Math.max(7, keepDays));
    let removed = 0;
    for (const date of await this.dates()) {
      if (date >= limit) continue;
      await this.remove(date);
      removed += 1;
    }
    return removed;
  }

  /** AI 选过的目的地按假期缓存；同一假期多天生成时不会每天换地方。 */
  async readTravelChoice(key: string): Promise<TravelChoice | null> {
    const raw = await this.ctx.config.read<unknown>('travel.json').catch(() => null);
    if (!raw || typeof raw !== 'object') return null;
    const value = (raw as Record<string, any>).choices?.[key];
    if (!value || typeof value !== 'object') return null;
    const destination = typeof value.destination === 'string' ? value.destination.trim().slice(0, 24) : '';
    const days = Number(value.days);
    const source = value.source === 'ai' || value.source === 'user' || value.source === 'pool' ? value.source : 'ai';
    if (!destination || !Number.isInteger(days) || days < 1 || days > 15) return null;
    return {
      key,
      destination,
      days,
      source,
      reason: typeof value.reason === 'string' ? value.reason.slice(0, 80) : '',
    };
  }

  async writeTravelChoice(choice: TravelChoice): Promise<void> {
    const raw = await this.ctx.config.read<unknown>('travel.json').catch(() => null);
    const old = raw && typeof raw === 'object' ? (raw as Record<string, any>).choices ?? {} : {};
    await this.ctx.config.save('travel.json', {
      version: 1,
      choices: { ...old, [choice.key]: choice },
    });
  }
}
