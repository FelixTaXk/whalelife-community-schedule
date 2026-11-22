/*! 日程 plugin · 给模型用的读写工具（全部 safe，异常一律转成文字，不抛给宿主）。 */

import type { Context } from '../../../core/context.ts';
import type { ScheduleService } from './service.ts';
import { EXCEPTION_LABELS } from './exceptions.ts';
import type { WeatherBridge } from './weather-bridge.ts';
import { briefRange, formatEditResult, formatNow, formatPlan, nowInfo } from './format.ts';
import { addDays, dateKey, isValidDateKey } from './time.ts';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pickDate(value: unknown): string {
  return typeof value === 'string' && isValidDateKey(value) ? value : dateKey(new Date());
}

export function registerTools(ctx: Context, service: ScheduleService, weather: WeatherBridge) {
  ctx.tools.register({
    name: 'schedule_today',
    description: '读取今天的日程（时间、安排、地点、完成状态）。用户问「今天有什么安排」「今天要做什么」「今天的计划」时先调用它，不要凭记忆编造。今天还没生成时会自动补一份。',
    schema: {
      type: 'object',
      properties: {
        detail: { type: 'string', enum: ['brief', 'full'], description: 'brief 只列时间与标题；full 带地点、备注和完成状态' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '日程', action: '读取今天' },
    run: async (args: any) => {
      try {
        const date = dateKey(new Date());
        const plan = await service.read(date) ?? (service.config.enabled ? await service.ensureToday() : null);
        if (!plan) return '自动生成已关闭，今天没有日程。可以在「日程」设置页打开自动生成。';
        const text = formatPlan(plan, args?.detail === 'full' ? 'full' : 'brief');
        const weatherLine = await weather.line(date);
        return weatherLine ? `${text}\n${weatherLine}` : text;
      } catch (error) {
        return `读取今天的日程失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'schedule_now',
    description: '看此刻在做什么：正在进行的事、还剩多久、下一项什么时候。用户问「你现在在干嘛」「等下有空吗」「忙不忙」时调用。',
    schema: { type: 'object', properties: {}, required: [] },
    danger: 'safe',
    origin: { platform: '日程', action: '读取此刻' },
    run: async () => {
      try {
        const date = dateKey(new Date());
        const plan = await service.read(date) ?? (service.config.enabled ? await service.ensureToday() : null);
        if (!plan) return '今天还没有日程。';
        const text = formatNow(plan, nowInfo(plan));
        const weatherLine = await weather.line(date);
        return weatherLine ? `${text}\n${weatherLine}` : text;
      } catch (error) {
        return `读取此刻安排失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'schedule_range',
    description: '读取未来几天的日程（最多 7 天）。用户问「明天」「这周末」「接下来几天」的安排时调用，不要猜。',
    schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '从今天算起看几天，1–7，默认 3' },
        from: { type: 'string', description: '起始日期 YYYY-MM-DD，省略就从今天开始' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '日程', action: '读取多天' },
    run: async (args: any) => {
      try {
        const from = pickDate(args?.from);
        const days = Math.min(7, Math.max(1, Math.round(Number(args?.days) || 3)));
        const today = dateKey(new Date());
        for (let index = 0; index < days; index += 1) {
          const date = addDays(from, index);
          if (service.config.enabled && date >= today && date <= addDays(today, service.config.daysAhead - 1)) {
            await service.ensure(date);
          }
        }
        const entries = await service.list(from, days);
        return briefRange(entries);
      } catch (error) {
        return `读取日程失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'schedule_generate',
    description: '按当前作息给某一天生成（或重排）日程。force 为 true 会覆盖这一天已有的安排，包括手动改过的；用户没明确要求重排时不要传 force。',
    schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD，省略就是今天' },
        force: { type: 'boolean', description: 'true = 覆盖已有安排；默认 false 只补缺失或过期的' },
      },
      required: [],
    },
    danger: 'safe',
    origin: { platform: '日程', action: '生成日程' },
    run: async (args: any) => {
      try {
        const date = pickDate(args?.date);
        const plan = await service.ensure(date, { force: args?.force === true });
        const header = formatPlan(plan, 'brief').split('\n')[0];
        return `${header}\n已按作息排好 ${plan.items.length} 项，共 ${plan.items.filter((item) => item.kind !== 'sleep').length} 段安排。`;
      } catch (error) {
        return `生成日程失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'schedule_exception',
    description: '处理异常日：生病、临时请假、加班、休息半天/一天时，用 set 一键生成当天覆盖版（不改长期作息）；恢复了用 clear 撤销；read 只读当前异常记录。用户说「今天不舒服」「请假了」「要加班」「今天想休息」时用。',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'set', 'clear'], description: 'read 查看、set 设置、clear 撤销' },
        date: { type: 'string', description: '日期 YYYY-MM-DD，省略就是今天' },
        kind: { type: 'string', enum: ['sick', 'leave', 'overtime', 'half', 'rest'], description: 'set 时用：生病 / 请假 / 加班 / 休息半天 / 休息' },
        note: { type: 'string', description: '可选原因，最多 80 字' },
      },
      required: ['action'],
    },
    danger: 'safe',
    origin: { platform: '日程', action: '异常日' },
    run: async (args: any) => {
      try {
        const date = pickDate(args?.date);
        const action = String(args?.action ?? 'read');
        if (action === 'read') {
          const exception = await service.readException(date);
          if (!exception) return `${date} 不是异常日。`;
          return `${date} 是异常日：${exception.note || exception.kind}（${EXCEPTION_LABELS[exception.kind]}）。日程已按当天状态压缩。`;
        }
        if (action === 'clear') {
          const plan = await service.clearException(date);
          return `已取消 ${date} 的异常日，恢复常规排程。\n${formatPlan(plan, 'brief')}`;
        }
        if (action !== 'set') throw Error('动作只能是 read / set / clear');
        const result = await service.setException(date, String(args?.kind ?? ''), typeof args?.note === 'string' ? args.note : '');
        return `已把 ${date} 设为 ${result.exception.kind} 异常日：${result.exception.note}。长期作息没改，点 clear 可撤销。\n${formatPlan(result.plan, 'brief')}`;
      } catch (error) {
        return `异常日操作失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'schedule_todo',
    description: '管理待办池：list 看未完成待办，add 加一条（可标「今天必须做」），schedule 排到某天（会找空档写进计划），done 标记完成，remove 删除。用户说「记个待办」「这件事今天必须做」「这周找个时间做」时用。',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'schedule', 'done', 'remove'], description: '操作类型' },
        id: { type: 'string', description: '待办 ID（list 返回的 txxxx）' },
        title: { type: 'string', description: '标题，最多 60 字' },
        minutes: { type: 'integer', description: '预计分钟数 10–480，默认 30' },
        priority: { type: 'string', enum: ['normal', 'must'], description: 'normal 普通；must 今天必须做，生成日程时优先' },
        date: { type: 'string', description: 'schedule 操作用的日期 YYYY-MM-DD，省略就是今天' },
        done: { type: 'boolean', description: 'done 操作：true 完成，false 恢复' },
      },
      required: ['action'],
    },
    danger: 'safe',
    origin: { platform: '日程', action: '管理待办' },
    run: async (args: any) => {
      try {
        const action = String(args?.action ?? 'list');
        if (action === 'list') {
          const items = await service.todos();
          const open = items.filter((item) => item.status !== 'done');
          if (!open.length) return '待办池是空的。';
          return open.slice(0, 20).map((item) => `${item.id} · ${item.title} · ${item.minutes} 分钟${item.priority === 'must' ? ' · 今天必须做' : ''}${item.scheduledDate ? ` · 已排 ${item.scheduledDate}` : ''}`).join('\n');
        }
        if (action === 'add') {
          const item = await service.addTodo({ title: args?.title, minutes: args?.minutes, priority: args?.priority, note: args?.note });
          return `已加入待办池：${item.id} · ${item.title} · ${item.minutes} 分钟。生成今天日程时会优先填空档。`;
        }
        if (action === 'schedule') {
          const id = String(args?.id ?? '');
          const plan = await service.scheduleTodo(pickDate(args?.date), id);
          return `已排进 ${plan.date}。\n${formatPlan(plan, 'brief')}`;
        }
        if (action === 'done' || action === 'remove') {
          const id = String(args?.id ?? '');
          if (!id) throw Error('缺少待办 ID');
          if (action === 'remove') {
            await service.removeTodo(id);
            return '已从待办池删除。';
          }
          const item = await service.completeTodo(id, args?.done !== false);
          return item.status === 'done' ? `已完成「${item.title}」。` : `已恢复「${item.title}」。`;
        }
        throw Error('动作只能是 list / add / schedule / done / remove');
      } catch (error) {
        return `待办操作失败：${errorText(error)}`;
      }
    },
  });

  ctx.tools.register({
    name: 'schedule_edit',
    description: '改日程里的一项：add 加、update 改时间/标题、remove 删、status 标完成/跳过。改动会标记为手动编辑，自动重排不会覆盖它。改时间或加新项时注意不要和已有安排重叠。',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'update', 'remove', 'status'], description: '操作类型' },
        date: { type: 'string', description: '日期 YYYY-MM-DD，省略就是今天' },
        id: { type: 'string', description: '要改的那一项的 id（从 schedule_today 里读到的 i1、i2…）' },
        start: { type: 'string', description: '开始时间 HH:MM' },
        end: { type: 'string', description: '结束时间 HH:MM' },
        title: { type: 'string', description: '标题，最多 24 字' },
        note: { type: 'string', description: '备注，最多 60 字' },
        place: { type: 'string', description: '地点，最多 20 字' },
        kind: { type: 'string', description: '类型：fixed / free / rest / chore / social / study / exercise / meal / commute / routine' },
        status: { type: 'string', enum: ['pending', 'done', 'skipped'], description: 'status 操作用：未做 / 已完成 / 跳过' },
      },
      required: ['action'],
    },
    danger: 'safe',
    origin: { platform: '日程', action: '编辑日程' },
    run: async (args: any) => {
      try {
        const date = pickDate(args?.date);
        const plan = await service.edit(date, {
          action: String(args?.action ?? ''),
          id: typeof args?.id === 'string' ? args.id : undefined,
          start: typeof args?.start === 'string' ? args.start : undefined,
          end: typeof args?.end === 'string' ? args.end : undefined,
          title: typeof args?.title === 'string' ? args.title : undefined,
          note: typeof args?.note === 'string' ? args.note : undefined,
          place: typeof args?.place === 'string' ? args.place : undefined,
          kind: typeof args?.kind === 'string' ? args.kind : undefined,
          status: typeof args?.status === 'string' ? args.status : undefined,
        });
        return `已保存。\n${formatEditResult(plan)}`;
      } catch (error) {
        return `没改成：${errorText(error)}`;
      }
    },
  });
}
