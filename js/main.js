// 画面の組み立てと操作。状態は store.js、提案の計算は suggest.js に置いてある。

import * as store from './store.js';
import { KINDS, FOCUS, UNITS, HORIZONS } from './store.js';
import { MOODS, suggest, planFor, headline } from './suggest.js';
import { renderCalendar, monthLabel, dayLabel, formatMinutes } from './calendar.js';

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
  if (name === 'settings') renderSettings();
  location.hash = name;
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

  // --- 設定
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
  store.subscribe(renderAll);

  const hash = location.hash.replace('#', '');
  setView(['now', 'tasks', 'calendar', 'settings'].includes(hash) ? hash : 'now');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW登録に失敗', e));
    });
  }
}

boot();
