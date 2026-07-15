// 月表示のカレンダー。締切日にタスクを置いて、その日の残り時間の合計を見せる。

import { toISO, todayISO, fromISO, daysUntil, remainingMinutes, tasksOn } from './store.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

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

export function formatMinutes(min) {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
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
  const start = new Date(year, month, 1 - first.getDay()); // 週の頭（日曜）に揃える
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

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal__day';
    cell.dataset.iso = iso;
    if (d.getMonth() !== month) cell.classList.add('is-other');
    if (iso === today) cell.classList.add('is-today');
    if (iso === selected) cell.classList.add('is-selected');
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

    const count = tasks.length ? `、タスク${tasks.length}件` : '';
    cell.setAttribute('aria-label', `${month + 1}月${d.getDate()}日${count}`);
    cell.addEventListener('click', () => onSelect(iso));
    grid.append(cell);
  }
}

export function monthLabel(cursor) {
  return `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月`;
}

export function dayLabel(iso) {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
}
