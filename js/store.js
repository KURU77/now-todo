// データの保存・読み書き。保存先はブラウザの localStorage のみ（サーバーには何も送りません）。

const KEY = 'now-todo/v1';
const SCHEMA = 1;

/** タスクの「種類」。提案のときに気分と突き合わせます。 */
export const KINDS = {
  think: { label: '頭を使う', icon: '🧠' },
  create: { label: '作る・書く', icon: '✏️' },
  routine: { label: '単純作業', icon: '🔁' },
  social: { label: '人と関わる', icon: '💬' },
  move: { label: '体を動かす', icon: '🏃' },
  chore: { label: '雑務・家事', icon: '🧹' },
};

/** 必要な集中度。1=ぼんやりでもできる 〜 3=しっかり集中したい */
export const FOCUS = {
  1: { label: 'ゆるい', hint: 'ぼんやりでもできる' },
  2: { label: 'ふつう', hint: 'そこそこ頭を使う' },
  3: { label: 'がっつり', hint: '集中しないと無理' },
};

/** 見積もりの単位。「ページごと何分」「タスクごと何分」を切り替える。 */
export const UNITS = {
  task: { label: 'タスク全体', per: 'タスク', countLabel: '回数' },
  page: { label: 'ページ単位', per: 'ページ', countLabel: 'ページ数' },
  item: { label: '個数単位', per: '個', countLabel: '個数' },
};

/** 「いつまでに」のプリセット。カレンダーとフィルタの両方で使う。 */
export const HORIZONS = [
  { id: 'today', label: '今日', days: 0 },
  { id: 'tomorrow', label: '明日', days: 1 },
  { id: 'week', label: '1週間', days: 7 },
  { id: 'month', label: '今月中', days: 30 },
  { id: 'q', label: '3か月', days: 90 },
  { id: 'half', label: '半年', days: 180 },
  { id: 'year', label: '1年', days: 365 },
];

const emptyState = () => ({ schema: SCHEMA, tasks: [], history: [] });

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) return emptyState();
    parsed.schema = SCHEMA;
    parsed.history = Array.isArray(parsed.history) ? parsed.history : [];
    parsed.tasks = parsed.tasks.map(normalize);
    return parsed;
  } catch (e) {
    console.warn('保存データを読めませんでした。空の状態で始めます。', e);
    return emptyState();
  }
}

function normalize(t) {
  return {
    id: t.id || uid(),
    title: String(t.title || '(名称なし)'),
    note: String(t.note || ''),
    due: t.due || todayISO(),
    unitType: UNITS[t.unitType] ? t.unitType : 'task',
    minutesPerUnit: clampNum(t.minutesPerUnit, 1, 1440, 30),
    totalUnits: clampNum(t.totalUnits, 1, 9999, 1),
    doneUnits: clampNum(t.doneUnits, 0, 9999, 0),
    focus: [1, 2, 3].includes(t.focus) ? t.focus : 2,
    kind: KINDS[t.kind] ? t.kind : 'think',
    done: !!t.done,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || new Date().toISOString(),
    completedAt: t.completedAt || null,
  };
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // 容量超過など。データは失われていないので画面には出し続ける。
    console.error('保存に失敗しました', e);
    alert('データの保存に失敗しました。ブラウザの空き容量を確認してください。');
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---- 日付ユーティリティ（すべてローカル時間の YYYY-MM-DD 文字列で扱う） ----

export function todayISO() {
  return toISO(new Date());
}

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 今日から見て何日後か。過去なら負の数。 */
export function daysUntil(iso, from = todayISO()) {
  const ms = fromISO(iso) - fromISO(from);
  return Math.round(ms / 86400000);
}

export function horizonDate(id) {
  const h = HORIZONS.find((x) => x.id === id);
  if (!h) return todayISO();
  if (id === 'month') {
    // 「今月中」は月末。ただし月末が近すぎるときも素直に月末にする。
    const now = new Date();
    return toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }
  const d = new Date();
  d.setDate(d.getDate() + h.days);
  return toISO(d);
}

// ---- タスクの派生値 ----

export function remainingUnits(t) {
  return Math.max(0, t.totalUnits - t.doneUnits);
}

export function remainingMinutes(t) {
  return remainingUnits(t) * t.minutesPerUnit;
}

export function totalMinutes(t) {
  return t.totalUnits * t.minutesPerUnit;
}

/** 途中で区切れるか。ページ・個数もので残り2単位以上あるものだけ分割できる。 */
export function isChunkable(t) {
  return t.unitType !== 'task' && remainingUnits(t) > 1;
}

export function progressRatio(t) {
  if (t.done) return 1;
  return t.totalUnits ? t.doneUnits / t.totalUnits : 0;
}

// ---- 一覧の取得 ----

export function getState() {
  return state;
}

export function activeTasks() {
  return state.tasks.filter((t) => !t.done);
}

export function sortedTasks(list = state.tasks) {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return b.focus - a.focus;
  });
}

export function tasksOn(iso) {
  return state.tasks.filter((t) => t.due === iso);
}

// ---- 更新系 ----

export function addTask(data) {
  const t = normalize({ ...data, id: uid(), createdAt: new Date().toISOString() });
  state.tasks.push(t);
  persist();
  return t;
}

export function updateTask(id, patch) {
  const i = state.tasks.findIndex((t) => t.id === id);
  if (i < 0) return null;
  state.tasks[i] = normalize({ ...state.tasks[i], ...patch, updatedAt: new Date().toISOString() });
  const t = state.tasks[i];
  // 単位を全部こなしたら自動的に完了扱いにする。
  if (!t.done && remainingUnits(t) === 0) {
    t.done = true;
    t.completedAt = new Date().toISOString();
  }
  persist();
  return t;
}

export function toggleDone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.done) {
    t.done = false;
    t.completedAt = null;
    if (remainingUnits(t) === 0) t.doneUnits = Math.max(0, t.totalUnits - 1);
  } else {
    t.done = true;
    t.doneUnits = t.totalUnits;
    t.completedAt = new Date().toISOString();
  }
  t.updatedAt = new Date().toISOString();
  persist();
}

export function removeTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  persist();
}

/** 「◯単位ぶん進んだ」を記録する。 */
export function logProgress(id, units, minutes) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const add = Math.max(0, Math.min(remainingUnits(t), Math.round(units)));
  state.history.push({
    id: uid(),
    taskId: id,
    title: t.title,
    units: add,
    minutes: Math.round(minutes || add * t.minutesPerUnit),
    at: new Date().toISOString(),
  });
  // 直近200件だけ持てば十分（振り返り用途）。
  if (state.history.length > 200) state.history = state.history.slice(-200);
  updateTask(id, { doneUnits: t.doneUnits + add });
}

// ---- バックアップ ----

export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text, mode = 'merge') {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.tasks)) throw new Error('タスクの配列が見つかりません');
  const incoming = parsed.tasks.map(normalize);
  if (mode === 'replace') {
    state = { schema: SCHEMA, tasks: incoming, history: parsed.history || [] };
  } else {
    const known = new Set(state.tasks.map((t) => t.id));
    state.tasks.push(...incoming.filter((t) => !known.has(t.id)));
  }
  persist();
  return incoming.length;
}

export function clearAll() {
  state = emptyState();
  persist();
}
