// 空き時間にタスクを割り当てる。
//
// 方針は「締切が早いものから順に、入る空き時間へ詰める」（EDF＝最早締切優先）。
// 締切を守ることが目的なら、この単純な規則が理論上いちばん強い。AIを使う場合も
// 計算そのものはここが担当し、AIには順番の入れ替えだけを任せる（ai.js）。

import {
  KINDS, todayISO, daysUntil, toMinutes, toHHMM, slotMinutes, formatMinutes,
  remainingUnits, remainingMinutes, isChunkable, activeTasks, upcomingSlots,
} from './store.js';

/** 割り当ての候補になるタスク。締切が早い順、同じなら集中度が高い順。 */
function candidates() {
  return activeTasks()
    .filter((t) => remainingUnits(t) > 0)
    .sort((a, b) => (a.due === b.due ? b.focus - a.focus : a.due < b.due ? -1 : 1));
}

/** その空き時間で、そのタスクを何単位こなせるか。 */
function fit(task, freeMinutes, remUnits) {
  if (remUnits <= 0 || freeMinutes <= 0) return 0;
  if (!isChunkable(task)) {
    return remUnits * task.minutesPerUnit <= freeMinutes ? remUnits : 0;
  }
  return Math.min(remUnits, Math.floor(freeMinutes / task.minutesPerUnit));
}

/**
 * 締切順に詰めていく。
 * @param {object} [opts]
 * @param {string[]} [opts.order] タスクIDの優先順（AIが返した順番。省略時は締切順）
 * @returns {{items:Array, unplaced:Array, leftover:Array}}
 */
export function buildPlan(opts = {}) {
  const today = todayISO();
  const slots = upcomingSlots(today);
  const tasks = candidates();

  // AIが順番を指定してきたら、それを優先順として使う。知らないIDは無視し、
  // 漏れたタスクは締切順で後ろに足す（AIが取りこぼしても必ず全部を検討する）。
  let ordered = tasks;
  if (Array.isArray(opts.order) && opts.order.length) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const seen = new Set();
    const picked = [];
    for (const id of opts.order) {
      const t = byId.get(id);
      if (t && !seen.has(id)) { seen.add(id); picked.push(t); }
    }
    ordered = [...picked, ...tasks.filter((t) => !seen.has(t.id))];
  }

  // 残り単位数をここで減らしながら進める（store は書き換えない）。
  const left = new Map(ordered.map((t) => [t.id, remainingUnits(t)]));
  const items = [];
  const leftover = [];

  for (const slot of slots) {
    let cursor = toMinutes(slot.start);
    const end = toMinutes(slot.end);

    for (const task of ordered) {
      const free = end - cursor;
      if (free <= 0) break;
      // 締切を過ぎた日には置かない。
      if (task.due < slot.date) continue;
      const units = fit(task, free, left.get(task.id));
      if (units <= 0) continue;

      const minutes = units * task.minutesPerUnit;
      items.push({
        id: `${slot.id}:${task.id}:${cursor}`,
        slotId: slot.id,
        taskId: task.id,
        date: slot.date,
        start: toHHMM(cursor),
        end: toHHMM(cursor + minutes),
        minutes,
        units,
      });
      left.set(task.id, left.get(task.id) - units);
      cursor += minutes;
    }
    if (end - cursor > 0) leftover.push({ slotId: slot.id, date: slot.date, minutes: end - cursor });
  }

  // 空き時間に入りきらなかったぶん。
  const unplaced = ordered
    .filter((t) => left.get(t.id) > 0)
    .map((t) => ({
      task: t,
      units: left.get(t.id),
      minutes: left.get(t.id) * t.minutesPerUnit,
      reason: whyUnplaced(t, slots),
    }));

  return { items, unplaced, leftover };
}

/** なぜ置けなかったのかを一言で。 */
function whyUnplaced(task, slots) {
  const inTime = slots.filter((s) => s.date <= task.due);
  if (inTime.length === 0) {
    return daysUntil(task.due) < 0 ? '締切を過ぎている' : '締切までに空き時間が登録されていない';
  }
  const longest = Math.max(...inTime.map(slotMinutes));
  if (!isChunkable(task) && remainingMinutes(task) > longest) {
    return `まとめて${formatMinutes(remainingMinutes(task))}必要（いちばん長い空きは${formatMinutes(longest)}）`;
  }
  return '締切までの空き時間が足りない';
}

/** 予定の合計や、間に合わないタスクの数をまとめる。 */
export function summarize(plan) {
  const minutes = plan.items.reduce((s, i) => s + i.minutes, 0);
  const days = new Set(plan.items.map((i) => i.date)).size;
  const free = plan.leftover.reduce((s, l) => s + l.minutes, 0);
  return { minutes, days, free, placed: plan.items.length, unplaced: plan.unplaced.length };
}

/** AIに渡す用に、タスクを最小限の平たい形にする。 */
export function taskBrief(task) {
  return {
    id: task.id,
    title: task.title,
    note: task.note || undefined,
    due: task.due,
    days_left: daysUntil(task.due),
    kind: KINDS[task.kind].label,
    focus: task.focus,
    minutes_per_unit: task.minutesPerUnit,
    remaining_units: remainingUnits(task),
    remaining_minutes: remainingMinutes(task),
    splittable: isChunkable(task),
  };
}

export function slotBrief(slot) {
  return {
    id: slot.id,
    date: slot.date,
    start: slot.start,
    end: slot.end,
    minutes: slotMinutes(slot),
  };
}

export { candidates };
