// 画面の組み立てと操作。状態は store.js、提案の計算は suggest.js に置いてある。

import * as store from './store.js';
import { KINDS, FOCUS, UNITS, HORIZONS } from './store.js';
import { MOODS, suggest, planFor, headline } from './suggest.js';
import { renderCalendar, monthLabel, dayLabel, formatMinutes } from './calendar.js';
import { buildPlan, summarize, candidates } from './scheduler.js';
import { planOrder, aiEnabled, hasApiKey } from './ai.js';

const $ = (sel, root = document) => root.querySelector(sel);

const MINUTE_PRESETS = [10, 15, 30, 45, 60, 90, 120];

const FILTERS = [
  { id: 'all', label: 'すべて', days: Infinity },
  { id: 'd1', label: '1日以内', days: 1 },
  { id: 'w1', label: '1週間', days: 7 },
  { id: 'm1', label: '1か月', days: 31 },
  { id: 'm3', label: '3か月', days: 90 },
  { id: 'm6', label: '半年', days: 180 },
  { id: 'y1', label: '1年', days: 365 },
];

/** 空き時間の入力を早くするためのよくある時間帯。 */
const SLOT_PRESETS = [
  { label: '朝', start: '07:00', end: '09:00' },
  { label: '昼休み', start: '12:00', end: '13:00' },
  { label: '夕方', start: '17:00', end: '19:00' },
  { label: '夜', start: '19:00', end: '22:00' },
];

const ui = {
  view: 'now',
  free: 30,
  moodId: 'normal',
  kinds: [],
  filter: 'all',
  showDone: false,
  cursor: new Date(),
  selectedDay: store.todayISO(),
  editing: null,      // 編集中タスクのid（新規なら null）
  draft: null,        // ダイアログ内のチップ選択状態
  showAllPicks: false,
  lastResult: null,
  planning: false,    // 割り当ての実行中
  planNote: '',       // AIの助言、または退避したときの理由
};

// ---------------------------------------------------------------- 共通パーツ

function chipButton({ label, icon, active, onClick, title }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (active ? ' is-active' : '');
  b.setAttribute('aria-pressed', String(!!active));
  if (title) {
    // title だけだと読み上げが補足文に置き換わってしまうので、名前を明示する。
    b.title = title;
    b.setAttribute('aria-label', `${label}（${title}）`);
  }
  b.innerHTML = icon ? `<span class="chip__icon">${icon}</span>${escape(label)}` : escape(label);
  b.addEventListener('click', onClick);
  return b;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function dueBadge(task) {
  const d = store.daysUntil(task.due);
  if (task.done) return { text: '完了', cls: 'badge--done' };
  if (d < 0) return { text: `${-d}日超過`, cls: 'badge--over' };
  if (d === 0) return { text: '今日まで', cls: 'badge--over' };
  if (d === 1) return { text: '明日まで', cls: 'badge--soon' };
  if (d <= 3) return { text: `あと${d}日`, cls: 'badge--soon' };
  if (d <= 30) return { text: `あと${d}日`, cls: 'badge--later' };
  return { text: `あと${Math.round(d / 30)}か月`, cls: 'badge--far' };
}

function unitWord(task) {
  return UNITS[task.unitType].per;
}

// ---------------------------------------------------------------- 「今！」画面

function renderNowInputs() {
  const mc = $('#minute-chips');
  mc.innerHTML = '';
  for (const m of MINUTE_PRESETS) {
    mc.append(chipButton({
      label: m < 60 ? `${m}分` : formatMinutes(m),
      active: ui.free === m,
      onClick: () => { ui.free = m; $('#minutes-input').value = m; renderNowInputs(); },
    }));
  }

  const mood = $('#mood-chips');
  mood.innerHTML = '';
  for (const m of MOODS) {
    mood.append(chipButton({
      label: m.label,
      icon: m.icon,
      active: ui.moodId === m.id,
      onClick: () => { ui.moodId = m.id; renderNowInputs(); },
    }));
  }

  const kc = $('#kind-chips');
  kc.innerHTML = '';
  for (const [id, k] of Object.entries(KINDS)) {
    kc.append(chipButton({
      label: k.label,
      icon: k.icon,
      active: ui.kinds.includes(id),
      onClick: () => {
        ui.kinds = ui.kinds.includes(id) ? ui.kinds.filter((x) => x !== id) : [...ui.kinds, id];
        renderNowInputs();
      },
    }));
  }
}

function runSuggest() {
  const mood = MOODS.find((m) => m.id === ui.moodId) || MOODS[1];
  ui.lastResult = suggest({ minutes: ui.free, energy: mood.energy, kinds: ui.kinds });
  ui.showAllPicks = false;
  renderSuggestResult();
  $('#suggest-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSuggestResult() {
  const box = $('#suggest-result');
  box.innerHTML = '';
  if (!ui.lastResult) return;
  const { picks, tooLong } = ui.lastResult;

  if (picks.length === 0) {
    box.append(emptyState(
      store.activeTasks().length === 0
        ? 'まだタスクがありません'
        : `${ui.free}分で手を付けられるタスクがありませんでした`,
      store.activeTasks().length === 0
        ? '右上の ＋ から、締切とだいたいの所要時間を登録してみてください。'
        : '空き時間を増やすか、大きいタスクを「ページ単位」に分けて登録すると提案しやすくなります。',
    ));
    if (tooLong.length) box.append(renderTooLong(tooLong));
    return;
  }

  const head = document.createElement('p');
  head.className = 'suggest-result__head';
  head.textContent = `${ui.free}分・${MOODS.find((m) => m.id === ui.moodId).label} なら、この順番がおすすめです`;
  box.append(head);

  const shown = ui.showAllPicks ? picks : picks.slice(0, 3);
  shown.forEach((pick, i) => box.append(renderPick(pick, i)));

  if (picks.length > shown.length) {
    const more = document.createElement('button');
    more.className = 'btn btn--ghost btn--wide';
    more.type = 'button';
    more.textContent = `残り${picks.length - shown.length}件も見る`;
    more.addEventListener('click', () => { ui.showAllPicks = true; renderSuggestResult(); });
    box.append(more);
  }
  if (tooLong.length) box.append(renderTooLong(tooLong));
}

function renderPick(pick, index) {
  const { task, plan } = pick;
  const el = document.createElement('article');
  el.className = 'pick' + (index === 0 ? ' pick--top' : '');

  const chunk = task.unitType === 'task'
    ? `${formatMinutes(plan.minutes)}で片付く`
    : `${formatMinutes(plan.minutes)}で ${plan.units}${unitWord(task)}`;

  const badge = dueBadge(task);
  el.innerHTML = `
    <div class="pick__rank">${index + 1}</div>
    <div class="pick__main">
      <h3 class="pick__title">${escape(task.title)}</h3>
      <p class="pick__why">${escape(headline(pick))}</p>
      <div class="pick__tags">
        <span class="badge ${badge.cls}">${badge.text}</span>
        <span class="badge">${KINDS[task.kind].icon} ${KINDS[task.kind].label}</span>
        <span class="badge">${chunk}</span>
      </div>
      <ul class="pick__reasons">${pick.reasons.map((r) => `<li>${escape(r)}</li>`).join('')}</ul>
    </div>
    <div class="pick__actions">
      <button class="btn btn--primary" data-start>始める（${plan.minutes}分）</button>
      <button class="btn btn--ghost" data-edit>詳細</button>
    </div>`;

  $('[data-start]', el).addEventListener('click', () => startTimer(task, plan));
  $('[data-edit]', el).addEventListener('click', () => openTaskDialog(task.id));
  return el;
}

function renderTooLong(tooLong) {
  const el = document.createElement('details');
  el.className = 'toolong';
  el.innerHTML = `<summary>時間が足りなくて外したもの（${tooLong.length}件）</summary>`;
  const ul = document.createElement('ul');
  for (const { task, shortBy } of tooLong.slice(0, 8)) {
    const li = document.createElement('li');
    li.textContent = `${task.title} … あと${formatMinutes(Math.max(1, shortBy))}足りない`;
    ul.append(li);
  }
  el.append(ul);
  return el;
}

function emptyState(title, body) {
  const el = document.createElement('div');
  el.className = 'empty';
  el.innerHTML = `<p class="empty__title">${escape(title)}</p><p class="empty__body">${escape(body)}</p>`;
  return el;
}

// ---------------------------------------------------------------- タスク一覧

function renderFilters() {
  const box = $('#filter-chips');
  box.innerHTML = '';
  for (const f of FILTERS) {
    box.append(chipButton({
      label: f.label,
      active: ui.filter === f.id,
      onClick: () => { ui.filter = f.id; renderTaskList(); renderFilters(); },
    }));
  }
}

function renderTaskList() {
  const box = $('#task-list');
  box.innerHTML = '';
  const limit = FILTERS.find((f) => f.id === ui.filter).days;
  let list = store.getState().tasks.filter((t) => {
    if (!ui.showDone && t.done) return false;
    return store.daysUntil(t.due) <= limit;
  });
  list = store.sortedTasks(list);

  if (list.length === 0) {
    box.append(emptyState('該当するタスクがありません', '右上の ＋ から追加するか、絞り込みを「すべて」にしてみてください。'));
    return;
  }

  const total = list.filter((t) => !t.done).reduce((s, t) => s + store.remainingMinutes(t), 0);
  const head = document.createElement('p');
  head.className = 'task-list__head';
  head.textContent = `${list.filter((t) => !t.done).length}件 / 残り合計 ${formatMinutes(total)}`;
  box.append(head);

  for (const t of list) box.append(renderTaskRow(t));
}

function renderTaskRow(t) {
  const el = document.createElement('article');
  el.className = 'task' + (t.done ? ' is-done' : '');
  const badge = dueBadge(t);
  const rem = store.remainingMinutes(t);
  const pct = Math.round(store.progressRatio(t) * 100);
  const amount = t.unitType === 'task'
    ? formatMinutes(store.totalMinutes(t))
    : `${t.doneUnits}/${t.totalUnits}${unitWord(t)}・残り${formatMinutes(rem)}`;

  el.innerHTML = `
    <button class="task__check" type="button" aria-label="${t.done ? '未完了に戻す' : '完了にする'}">${t.done ? '✓' : ''}</button>
    <button class="task__body" type="button">
      <h3 class="task__title">${escape(t.title)}</h3>
      <div class="task__meta">
        <span class="badge ${badge.cls}">${badge.text}</span>
        <span class="task__due">${escape(dayLabel(t.due))}</span>
        <span>${KINDS[t.kind].icon}</span>
        <span>${'●'.repeat(t.focus)}<span class="dim">${'○'.repeat(3 - t.focus)}</span></span>
        <span>${escape(amount)}</span>
      </div>
      <div class="progress"><i style="width:${pct}%"></i></div>
    </button>`;

  $('.task__check', el).addEventListener('click', () => {
    store.toggleDone(t.id);
    toast(t.done ? '未完了に戻しました' : `「${t.title}」を完了にしました`);
  });
  $('.task__body', el).addEventListener('click', () => openTaskDialog(t.id));
  return el;
}

// ---------------------------------------------------------------- カレンダー

function renderCalendarView() {
  $('#cal-label').textContent = monthLabel(ui.cursor);
  renderCalendar($('#cal-grid'), ui.cursor, ui.selectedDay, (iso) => {
    ui.selectedDay = iso;
    renderCalendarView();
  });
  renderDayDetail();
}

function renderDayDetail() {
  const box = $('#cal-detail');
  box.innerHTML = '';
  const iso = ui.selectedDay;
  const tasks = store.sortedTasks(store.tasksOn(iso));

  const head = document.createElement('div');
  head.className = 'cal__detail-head';
  const mins = tasks.filter((t) => !t.done).reduce((s, t) => s + store.remainingMinutes(t), 0);
  head.innerHTML = `<h3>${escape(dayLabel(iso))}</h3>
    <span class="dim">${tasks.length ? `${tasks.length}件・残り${formatMinutes(mins)}` : '締切なし'}</span>`;
  const add = document.createElement('button');
  add.className = 'btn btn--ghost';
  add.type = 'button';
  add.textContent = 'この日を締切に追加';
  add.addEventListener('click', () => openTaskDialog(null, iso));
  head.append(add);
  box.append(head);

  for (const t of tasks) box.append(renderTaskRow(t));

  // この日の空き時間と、そこに割り当てられた予定。
  const slots = store.slotsOn(iso);
  const items = store.planItemsOn(iso);
  const sub = document.createElement('div');
  sub.className = 'cal__slots';
  const free = slots.reduce((s, x) => s + store.slotMinutes(x), 0);
  sub.innerHTML = `<h4>空き時間 <span class="dim">${slots.length ? formatMinutes(free) : 'なし'}</span></h4>`;

  for (const slot of slots) {
    const planned = items.filter((i) => i.slotId === slot.id);
    const row = document.createElement('div');
    row.className = 'slot';
    const names = planned
      .map((i) => store.getState().tasks.find((t) => t.id === i.taskId)?.title)
      .filter(Boolean);
    row.innerHTML = `
      <span class="slot__time">${slot.start} 〜 ${slot.end}</span>
      <span class="slot__len dim">${names.length ? escape(names.join('、')) : '未割り当て'}</span>
      <button class="btn btn--icon" type="button" aria-label="この空き時間を削除">✕</button>`;
    $('button', row).addEventListener('click', () => {
      store.removeSlot(slot.id);
      toast('空き時間を削除しました');
    });
    sub.append(row);
  }

  const addSlot = document.createElement('button');
  addSlot.className = 'btn btn--ghost btn--wide';
  addSlot.type = 'button';
  addSlot.textContent = 'この日の空き時間を登録する';
  addSlot.addEventListener('click', () => {
    $('#s-date').value = iso;
    setView('plan');
    setTimeout(() => $('#s-start').focus(), 50);
  });
  sub.append(addSlot);
  box.append(sub);
}

// ---------------------------------------------------------------- 予定（自動割り当て）

function renderPlanView() {
  renderSlotSection();
  renderPlanMode();
  renderPlanResult();
}

function renderSlotSection() {
  const slots = store.upcomingSlots();
  const total = slots.reduce((s, x) => s + store.slotMinutes(x), 0);
  $('#slot-summary').textContent = slots.length
    ? `これから先の空き時間は ${slots.length}枠・合計 ${formatMinutes(total)}`
    : 'まだ空き時間が登録されていません。下のフォームで「この日のこの時間が空いている」を登録してください。';

  const quick = $('#slot-quick');
  quick.innerHTML = '';
  for (const p of SLOT_PRESETS) {
    quick.append(chipButton({
      label: p.label,
      title: `${p.start}〜${p.end}`,
      onClick: () => { $('#s-start').value = p.start; $('#s-end').value = p.end; },
    }));
  }

  const box = $('#slot-list');
  box.innerHTML = '';
  if (slots.length === 0) return;

  let lastDate = null;
  for (const slot of slots) {
    if (slot.date !== lastDate) {
      const h = document.createElement('h3');
      h.className = 'slot-list__day';
      h.textContent = dayLabel(slot.date);
      box.append(h);
      lastDate = slot.date;
    }
    const row = document.createElement('div');
    row.className = 'slot';
    row.innerHTML = `
      <span class="slot__time">${slot.start} 〜 ${slot.end}</span>
      <span class="slot__len dim">${formatMinutes(store.slotMinutes(slot))}</span>
      <button class="btn btn--icon" type="button" aria-label="${escape(dayLabel(slot.date))} ${slot.start}からの空き時間を削除">✕</button>`;
    $('button', row).addEventListener('click', () => {
      store.removeSlot(slot.id);
      toast('空き時間を削除しました');
    });
    box.append(row);
  }
}

function renderPlanMode() {
  const el = $('#plan-mode');
  if (aiEnabled()) el.textContent = 'AIに順番を相談してから割り当てます（時間の計算はアプリが行います）';
  else if (hasApiKey()) el.textContent = 'AIは使いません（設定でオンにできます）';
  else el.textContent = '締切が早いものから順に詰めます';
  $('#btn-plan').disabled = ui.planning;
  $('#btn-plan').textContent = ui.planning ? '考えています…' : '空き時間にタスクを割り当てる';
}

async function runPlan() {
  if (ui.planning) return;
  const slots = store.upcomingSlots();
  if (slots.length === 0) {
    toast('先に空き時間を登録してください');
    return;
  }
  const tasks = candidates();
  if (tasks.length === 0) {
    toast('割り当てられるタスクがありません');
    return;
  }

  ui.planning = true;
  ui.planNote = '';
  renderPlanMode();

  let order = null;
  let source = 'auto';
  try {
    if (aiEnabled()) {
      const res = await planOrder({ tasks, slots });
      order = res.order;
      ui.planNote = res.advice;
      source = 'ai';
    }
  } catch (e) {
    // AIが失敗しても予定は作れる。理由だけ伝えて締切順に退避する。
    console.warn('AIの相談に失敗しました', e);
    ui.planNote = `AIに相談できなかったので、締切が早い順に組みました。（${e.message}）`;
  }

  const plan = buildPlan({ order });
  store.setPlan({
    generatedAt: new Date().toISOString(),
    source,
    items: plan.items,
  });

  ui.planning = false;
  ui.lastPlan = plan;
  renderPlanView();
  $('#plan-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPlanResult() {
  const box = $('#plan-result');
  box.innerHTML = '';
  const saved = store.getState().plan;
  if (!saved) return;

  // 保存してある予定は、タスクが完了・削除されていることもあるので毎回組み直す。
  const plan = ui.lastPlan || buildPlan();
  const sum = summarize(plan);

  if (ui.planNote) {
    const note = document.createElement('div');
    note.className = 'plan-note';
    note.innerHTML = `<span class="plan-note__icon">${saved.source === 'ai' ? '💡' : 'ℹ️'}</span><p>${escape(ui.planNote)}</p>`;
    box.append(note);
  }

  const head = document.createElement('p');
  head.className = 'suggest-result__head';
  head.textContent = sum.placed
    ? `${sum.days}日ぶんの空き時間に ${formatMinutes(sum.minutes)} を割り当てました`
    : '空き時間に入るタスクがありませんでした';
  box.append(head);

  const byDate = new Map();
  for (const item of plan.items) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  for (const [date, items] of byDate) box.append(renderPlanDay(date, items));

  if (sum.free > 0) {
    const left = document.createElement('p');
    left.className = 'card__hint';
    left.textContent = `空き時間のうち ${formatMinutes(sum.free)} は余りました。`;
    box.append(left);
  }
  if (plan.unplaced.length) box.append(renderUnplaced(plan.unplaced));
}

function renderPlanDay(date, items) {
  const el = document.createElement('article');
  el.className = 'planday';
  const mins = items.reduce((s, i) => s + i.minutes, 0);
  const head = document.createElement('div');
  head.className = 'planday__head';
  head.innerHTML = `<h3>${escape(dayLabel(date))}</h3><span class="dim">${formatMinutes(mins)}</span>`;
  el.append(head);

  for (const item of items) {
    const task = store.getState().tasks.find((t) => t.id === item.taskId);
    if (!task) continue;
    const amount = task.unitType === 'task' ? '仕上げる' : `${item.units}${unitWord(task)}`;
    const row = document.createElement('div');
    row.className = 'planrow';
    row.innerHTML = `
      <span class="planrow__time">${item.start}<br><span class="dim">${item.end}</span></span>
      <button class="planrow__body" type="button">
        <span class="planrow__title">${escape(task.title)}</span>
        <span class="planrow__meta">
          <span class="badge">${KINDS[task.kind].icon} ${escape(amount)}</span>
          <span class="badge ${dueBadge(task).cls}">${dueBadge(task).text}</span>
          <span class="dim">${formatMinutes(item.minutes)}</span>
        </span>
      </button>
      <button class="btn btn--icon" type="button" aria-label="${escape(task.title)} を始める">▶</button>`;
    $('.planrow__body', row).addEventListener('click', () => openTaskDialog(task.id));
    $('.btn--icon', row).addEventListener('click', () => {
      startTimer(task, { units: item.units, minutes: item.minutes, finishes: item.units >= store.remainingUnits(task) });
    });
    el.append(row);
  }
  return el;
}

function renderUnplaced(unplaced) {
  const el = document.createElement('div');
  el.className = 'card card--danger';
  el.innerHTML = `<h3 class="card__title">⚠️ 間に合わないかもしれません（${unplaced.length}件）</h3>`;
  const ul = document.createElement('ul');
  ul.className = 'prose prose--list';
  for (const u of unplaced) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${escape(u.task.title)}</strong>（残り${formatMinutes(u.minutes)}）… ${escape(u.reason)}`;
    ul.append(li);
  }
  el.append(ul);
  const hint = document.createElement('p');
  hint.className = 'card__hint';
  hint.textContent = '空き時間を足すか、締切を延ばすか、見積もりを見直してください。';
  el.append(hint);
  return el;
}

// ---------------------------------------------------------------- タスク編集

function openTaskDialog(id = null, presetDue = null) {
  ui.editing = id;
  const t = id ? store.getState().tasks.find((x) => x.id === id) : null;
  ui.draft = t
    ? { unitType: t.unitType, focus: t.focus, kind: t.kind }
    : { unitType: 'task', focus: 2, kind: 'think' };

  $('#task-dialog-title').textContent = t ? 'タスクを編集' : 'タスクを追加';
  $('#f-title').value = t ? t.title : '';
  $('#f-due').value = t ? t.due : (presetDue || store.horizonDate('week'));
  $('#f-count').value = t ? t.totalUnits : 1;
  $('#f-minutes').value = t ? t.minutesPerUnit : 30;
  $('#f-note').value = t ? t.note : '';
  $('#btn-delete').hidden = !t;

  renderDialogChips();
  $('#task-dialog').showModal();
  if (!t) setTimeout(() => $('#f-title').focus(), 50);
}

function renderDialogChips() {
  const due = $('#due-chips');
  due.innerHTML = '';
  for (const h of HORIZONS) {
    const iso = store.horizonDate(h.id);
    due.append(chipButton({
      label: h.label,
      active: $('#f-due').value === iso,
      title: iso,
      onClick: () => { $('#f-due').value = iso; renderDialogChips(); },
    }));
  }

  const unit = $('#unit-chips');
  unit.innerHTML = '';
  for (const [id, u] of Object.entries(UNITS)) {
    unit.append(chipButton({
      label: u.label,
      active: ui.draft.unitType === id,
      onClick: () => {
        ui.draft.unitType = id;
        if (id === 'task') $('#f-count').value = 1;
        renderDialogChips();
        updateEstimate();
      },
    }));
  }

  const focus = $('#focus-chips');
  focus.innerHTML = '';
  for (const [lvl, f] of Object.entries(FOCUS)) {
    focus.append(chipButton({
      label: f.label,
      title: f.hint,
      active: ui.draft.focus === Number(lvl),
      onClick: () => { ui.draft.focus = Number(lvl); renderDialogChips(); },
    }));
  }

  const kind = $('#kind-select');
  kind.innerHTML = '';
  for (const [id, k] of Object.entries(KINDS)) {
    kind.append(chipButton({
      label: k.label,
      icon: k.icon,
      active: ui.draft.kind === id,
      onClick: () => { ui.draft.kind = id; renderDialogChips(); },
    }));
  }
  updateEstimate();
}

function updateEstimate() {
  const u = UNITS[ui.draft.unitType];
  $('#f-count-label').textContent = u.countLabel;
  $('#f-per-label').textContent = u.per;
  const count = Number($('#f-count').value) || 1;
  const per = Number($('#f-minutes').value) || 0;
  $('#f-total').textContent = `合計 ${formatMinutes(Math.max(0, count * per))}`;
}

function saveTaskFromForm() {
  const data = {
    title: $('#f-title').value.trim(),
    due: $('#f-due').value,
    note: $('#f-note').value.trim(),
    unitType: ui.draft.unitType,
    focus: ui.draft.focus,
    kind: ui.draft.kind,
    totalUnits: Number($('#f-count').value),
    minutesPerUnit: Number($('#f-minutes').value),
  };
  if (!data.title || !data.due) return;

  if (ui.editing) {
    store.updateTask(ui.editing, data);
    toast('保存しました');
  } else {
    store.addTask({ ...data, doneUnits: 0 });
    toast(`「${data.title}」を追加しました`);
  }
  ui.editing = null;
}

// ---------------------------------------------------------------- タイマー

const timer = { taskId: null, plan: null, left: 0, elapsed: 0, paused: false, handle: null };

function startTimer(task, plan) {
  timer.taskId = task.id;
  timer.plan = plan;
  timer.left = plan.minutes * 60;
  timer.elapsed = 0;
  timer.paused = false;

  $('#timer-task').textContent = task.title;
  $('#timer-plan').textContent = task.unitType === 'task'
    ? 'この時間で終わらせる想定です'
    : `${plan.units}${unitWord(task)}進める想定（${task.minutesPerUnit}分/${unitWord(task)}）`;
  $('#timer-units').value = plan.units;
  $('#timer-units-label').textContent = unitWord(task);
  $('#timer-units').max = store.remainingUnits(task);
  $('#timer-running').hidden = false;
  $('#timer-report').hidden = true;
  $('#timer-toggle').textContent = '一時停止';
  drawClock();

  $('#timer-dialog').showModal();
  clearInterval(timer.handle);
  timer.handle = setInterval(tick, 1000);
}

function tick() {
  if (timer.paused) return;
  timer.elapsed++;
  timer.left--;
  drawClock();
  if (timer.left === 0) {
    document.body.classList.add('is-timeup');
    toast('時間になりました。お疲れさまでした！');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

function drawClock() {
  const t = Math.abs(timer.left);
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  const clock = $('#timer-clock');
  clock.textContent = (timer.left < 0 ? '+' : '') + `${mm}:${ss}`;
  clock.classList.toggle('is-over', timer.left < 0);
}

function stopTimer() {
  clearInterval(timer.handle);
  timer.handle = null;
  document.body.classList.remove('is-timeup');
}

function showTimerReport() {
  const task = store.getState().tasks.find((t) => t.id === timer.taskId);
  if (!task) return closeTimer();
  timer.paused = true;
  $('#timer-running').hidden = true;
  $('#timer-report').hidden = false;
  $('#timer-elapsed').textContent = `作業時間 ${formatMinutes(Math.max(1, Math.round(timer.elapsed / 60)))}`;

  // 分割できないタスクは「何単位進んだか」を聞いても意味がないので、終わったかどうかだけ聞く。
  const whole = task.unitType === 'task';
  $('#timer-units-field').hidden = whole;
  $('#timer-units').value = whole ? 1 : timer.plan.units;
  $('#timer-question').textContent = whole ? '終わりましたか？' : 'どこまで進みましたか？';
  $('#timer-save').textContent = whole ? '完了にする' : '記録する';
  if (!whole) $('#timer-units').focus();
}

function closeTimer() {
  stopTimer();
  $('#timer-dialog').close();
}

// ---------------------------------------------------------------- 設定

function renderSettings() {
  const cfg = store.getSettings();
  $('#use-ai').checked = !!cfg.useAI;
  if ($('#api-key') !== document.activeElement) $('#api-key').value = cfg.apiKey || '';

  const s = store.getState();
  const active = s.tasks.filter((t) => !t.done);
  const soon = active.filter((t) => store.daysUntil(t.due) <= 7).length;
  const over = active.filter((t) => store.daysUntil(t.due) < 0).length;
  const loggedMin = s.history.reduce((sum, h) => sum + (h.minutes || 0), 0);

  $('#stats').innerHTML = `
    <div class="stat"><b>${active.length}</b><span>未完了</span></div>
    <div class="stat"><b>${soon}</b><span>1週間以内</span></div>
    <div class="stat"><b>${over}</b><span>期限切れ</span></div>
    <div class="stat"><b>${formatMinutes(loggedMin)}</b><span>記録した作業</span></div>`;

  const h = $('#history');
  h.innerHTML = '';
  const recent = [...s.history].reverse().slice(0, 10);
  if (recent.length === 0) {
    h.innerHTML = '<p class="card__hint">タイマーで作業を終えると、ここに記録が残ります。</p>';
    return;
  }
  for (const item of recent) {
    const d = new Date(item.at);
    const li = document.createElement('div');
    li.className = 'history__item';
    li.innerHTML = `<span class="dim">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span>
      <span>${escape(item.title)}</span>
      <span class="dim">${formatMinutes(item.minutes)}</span>`;
    h.append(li);
  }
}

function exportFile() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `now-todo-${store.todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('バックアップを書き出しました');
}

async function importFile(file) {
  try {
    const n = store.importJSON(await file.text(), 'merge');
    toast(`${n}件を読み込みました`);
  } catch (e) {
    console.error(e);
    alert(`読み込めませんでした。\n${e.message}`);
  }
}

// ---------------------------------------------------------------- 画面切り替え

function setView(name) {
  ui.view = name;
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('is-active', t.dataset.view === name);
  window.scrollTo({ top: 0 });
  if (name === 'calendar') renderCalendarView();
  if (name === 'plan') renderPlanView();
  if (name === 'settings') renderSettings();
  location.hash = name;
}

/** 「つながるか試す」。実際の割り当てはせず、応答が返るかだけを見る。 */
async function testAI() {
  const btn = $('#btn-test-ai');
  const status = $('#ai-status');
  if (!hasApiKey()) {
    status.textContent = '先にAPIキーを入力してください。';
    return;
  }
  btn.disabled = true;
  status.textContent = 'つないでいます…';
  const probe = {
    id: 'probe',
    title: 'テスト',
    note: '',
    due: store.todayISO(),
    unitType: 'task',
    minutesPerUnit: 30,
    totalUnits: 1,
    doneUnits: 0,
    focus: 2,
    kind: 'think',
  };
  try {
    await planOrder({
      tasks: [probe],
      slots: [{ id: 'probe', date: store.todayISO(), start: '09:00', end: '10:00' }],
    });
    status.textContent = '✅ つながりました。AIに順番を相談できます。';
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
  }
  btn.disabled = false;
}

// ---------------------------------------------------------------- 起動

function bind() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => setView(t.dataset.view));
  });

  $('#btn-add').addEventListener('click', () => openTaskDialog());
  $('#btn-suggest').addEventListener('click', runSuggest);

  $('#minutes-input').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v > 0) { ui.free = Math.min(600, v); renderNowInputs(); }
  });

  $('#show-done').addEventListener('change', (e) => { ui.showDone = e.target.checked; renderTaskList(); });

  $('#cal-prev').addEventListener('click', () => {
    ui.cursor = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth() - 1, 1);
    renderCalendarView();
  });
  $('#cal-next').addEventListener('click', () => {
    ui.cursor = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth() + 1, 1);
    renderCalendarView();
  });
  $('#cal-today').addEventListener('click', () => {
    ui.cursor = new Date();
    ui.selectedDay = store.todayISO();
    renderCalendarView();
  });

  // --- タスクダイアログ
  const dlg = $('#task-dialog');
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close('cancel')));
  $('#task-form').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'save') saveTaskFromForm();
  });
  $('#f-count').addEventListener('input', updateEstimate);
  $('#f-minutes').addEventListener('input', updateEstimate);
  $('#f-due').addEventListener('change', renderDialogChips);
  $('#btn-delete').addEventListener('click', () => {
    const t = store.getState().tasks.find((x) => x.id === ui.editing);
    if (!t) return;
    if (!confirm(`「${t.title}」を削除します。よろしいですか？`)) return;
    store.removeTask(ui.editing);
    ui.editing = null;
    dlg.close('deleted');
    toast('削除しました');
  });

  // --- タイマー
  $('#timer-toggle').addEventListener('click', () => {
    timer.paused = !timer.paused;
    $('#timer-toggle').textContent = timer.paused ? '再開' : '一時停止';
  });
  $('#timer-finish').addEventListener('click', showTimerReport);
  $('#timer-close').addEventListener('click', () => {
    if ($('#timer-report').hidden) showTimerReport();
    else closeTimer();
  });
  $('#timer-skip').addEventListener('click', closeTimer);
  $('#timer-report').addEventListener('submit', (e) => {
    e.preventDefault();
    const units = Number($('#timer-units').value) || 0;
    if (units > 0) {
      store.logProgress(timer.taskId, units, Math.round(timer.elapsed / 60));
      const t = store.getState().tasks.find((x) => x.id === timer.taskId);
      toast(t && t.done ? `「${t.title}」を完了にしました 🎉` : '記録しました');
    }
    closeTimer();
  });
  $('#timer-dialog').addEventListener('close', stopTimer);

  // --- 予定（空き時間の登録と自動割り当て）
  $('#slot-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = store.addSlot({
      date: $('#s-date').value,
      start: $('#s-start').value,
      end: $('#s-end').value,
    });
    if (typeof res === 'string') {
      toast(res);
      return;
    }
    toast(`${dayLabel(res.date)} ${res.start}〜${res.end} を追加しました`);
  });
  $('#btn-plan').addEventListener('click', runPlan);

  // --- 設定
  $('#use-ai').addEventListener('change', (e) => {
    if (e.target.checked && !hasApiKey()) {
      e.target.checked = false;
      $('#ai-status').textContent = '先にAPIキーを入力してください。';
      return;
    }
    store.updateSettings({ useAI: e.target.checked });
  });
  $('#api-key').addEventListener('change', (e) => {
    const key = e.target.value.trim();
    store.updateSettings({ apiKey: key, useAI: key ? store.getSettings().useAI : false });
    $('#ai-status').textContent = key ? 'キーを保存しました。「つながるか試す」で確認できます。' : '';
  });
  $('#btn-test-ai').addEventListener('click', testAI);
  $('#btn-clear-key').addEventListener('click', () => {
    store.updateSettings({ apiKey: '', useAI: false });
    $('#api-key').value = '';
    $('#ai-status').textContent = 'キーを消しました。';
    toast('APIキーを削除しました');
  });

  $('#btn-export').addEventListener('click', exportFile);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-clear').addEventListener('click', () => {
    if (!confirm('すべてのタスクと記録を削除します。元に戻せません。よろしいですか？')) return;
    store.clearAll();
    toast('すべて削除しました');
  });
}

function renderAll() {
  renderNowInputs();
  renderFilters();
  renderTaskList();
  if (ui.view === 'calendar') renderCalendarView();
  if (ui.view === 'plan') { ui.lastPlan = null; renderPlanView(); }
  if (ui.view === 'settings') renderSettings();
  // 提案は表示中のときだけ、最新のタスクで作り直す。
  if (ui.lastResult) {
    const mood = MOODS.find((m) => m.id === ui.moodId) || MOODS[1];
    ui.lastResult = suggest({ minutes: ui.free, energy: mood.energy, kinds: ui.kinds });
    renderSuggestResult();
  }
}

function boot() {
  bind();
  store.pruneOldSlots();   // 過ぎた日の空き時間は残しておいても邪魔なだけ
  $('#s-date').value = store.todayISO();
  $('#s-date').min = store.todayISO();
  store.subscribe(renderAll);

  const hash = location.hash.replace('#', '');
  setView(['now', 'tasks', 'calendar', 'plan', 'settings'].includes(hash) ? hash : 'now');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW登録に失敗', e));
    });
  }
}

boot();
