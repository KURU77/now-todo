// 月表示のカレンダー。締切日にタスクを置いて、その日の残り時間の合計を見せる。

import { toISO, todayISO, fromISO, daysUntil, remainingMinutes, tasksOn, slotsOn, slotMinutes, formatMinutes } from './store.js';

// 書式そのものは store.js に置いてあるが、画面側はここから使うのでそのまま通す。
export { formatMinutes };

// 週は月曜はじまり。JSの getDay() は日曜=0 なので、並べ替えの計算では毎回ずらす。
const WEEK = ['月', '火', '水', '木', '金', '土', '日'];

/** その日が週の何番目か（月曜=0 〜 日曜=6）。 */
function weekIndex(d) {
  return (d.getDay() + 6) % 7;
}

/** 日付ごとの状態を色分けするためのクラス名を返す。 */
function dayClassFor(tasks) {
  if (tasks.length === 0) return '';
  if (tasks.every((t) => t.done)) return 'dot--done';
  const undone = tasks.filter((t) => !t.done);
  const min = Math.min(...undone.map((t) => daysUntil(t.due)));
  if (min < 0) return 'dot--over';
  if (min <= 3) return 'dot--soon';
  return 'dot--later';
}

/**
 * カレンダーを描画する。
 * @param {HTMLElement} grid 描画先
 * @param {Date} cursor 表示する月（日は無視）
 * @param {string} selected 選択中の日付 ISO
 * @param {(iso:string)=>void} onSelect
 */
export function renderCalendar(grid, cursor, selected, onSelect) {
  grid.innerHTML = '';
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - weekIndex(first)); // 週の頭（月曜）に揃える
  const today = todayISO();

  for (const w of WEEK) {
    const el = document.createElement('div');
    el.className = 'cal__wd';
    el.textContent = w;
    grid.append(el);
  }

  // 6週ぶん固定で描くと、月をまたいでも高さが動かない。
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISO(d);
    const tasks = tasksOn(iso);
    const undone = tasks.filter((t) => !t.done);
    const mins = undone.reduce((s, t) => s + remainingMinutes(t), 0);

    const slots = slotsOn(iso);
    const freeMins = slots.reduce((s, x) => s + slotMinutes(x), 0);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal__day';
    cell.dataset.iso = iso;
    if (d.getMonth() !== month) cell.classList.add('is-other');
    if (iso === today) cell.classList.add('is-today');
    if (iso === selected) cell.classList.add('is-selected');
    if (slots.length) cell.classList.add('has-slot');
    if (d.getDay() === 0) cell.classList.add('is-sun');
    if (d.getDay() === 6) cell.classList.add('is-sat');

    const num = document.createElement('span');
    num.className = 'cal__num';
    num.textContent = d.getDate();
    cell.append(num);

    if (tasks.length) {
      const dot = document.createElement('i');
      dot.className = `dot ${dayClassFor(tasks)}`;
      cell.append(dot);

      const label = document.createElement('span');
      label.className = 'cal__mins';
      label.textContent = mins ? formatMinutes(mins) : '済';
      cell.append(label);
    }

    const count = tasks.length ? `、締切のタスク${tasks.length}件` : '';
    const free = slots.length ? `、空き時間${formatMinutes(freeMins)}` : '';
    // 前後の月にはみ出したマスもあるので、表示中の月ではなくマス自身の月を読ませる。
    cell.setAttribute('aria-label', `${d.getMonth() + 1}月${d.getDate()}日${count}${free}`);
    cell.addEventListener('click', () => onSelect(iso));
    grid.append(cell);
  }
}

export function monthLabel(cursor) {
  return `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月`;
}

export function dayLabel(iso) {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[weekIndex(d)]}）`;
}
