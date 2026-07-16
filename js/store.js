// データの保存・読み書き。保存先はブラウザの localStorage のみ（サーバーには何も送りません）。

const KEY = 'now-todo/v1';
const SCHEMA = 2;

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

const emptyState = () => ({
  schema: SCHEMA,
  tasks: [],
  history: [],
  slots: [],      // 「この日のこの時間が空いている」
  plan: null,     // 空き時間に割り当てた予定
  settings: { apiKey: '', useAI: false },
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) return emptyState();
    const base = emptyState();
    // 古い版で保存したデータには slots などが無いので、既定値で埋める。
    const s = { ...base, ...parsed, schema: SCHEMA };
    s.history = Array.isArray(s.history) ? s.history : [];
    s.slots = Array.isArray(s.slots) ? s.slots.map(normalizeSlot).filter(Boolean) : [];
    s.settings = { ...base.settings, ...(s.settings || {}) };
    s.tasks = s.tasks.map(normalize);
    return s;
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

/** 壊れた空き時間（終わりが始まりより前など）は捨てる。 */
function normalizeSlot(s) {
  if (!s || !isISO(s.date) || !isHHMM(s.start) || !isHHMM(s.end)) return null;
  if (toMinutes(s.end) <= toMinutes(s.start)) return null;
  return { id: s.id || uid(), date: s.date, start: s.start, end: s.end };
}

function isISO(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isHHMM(v) {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
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

// ---- 時刻ユーティリティ（"HH:MM" ⇔ 0時からの分数） ----

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function toHHMM(min) {
  const m = Math.max(0, Math.min(24 * 60, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function slotMinutes(slot) {
  return toMinutes(slot.end) - toMinutes(slot.start);
}

/** 分数を「1時間30分」のように読みやすくする。 */
export function formatMinutes(min) {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
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

// ---- 空き時間 ----

export function slotsOn(iso) {
  return state.slots
    .filter((s) => s.date === iso)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

/** 今日以降の空き時間を、早い順に返す。 */
export function upcomingSlots(fromISO = todayISO()) {
  return state.slots
    .filter((s) => s.date >= fromISO)
    .sort((a, b) => (a.date === b.date ? toMinutes(a.start) - toMinutes(b.start) : a.date < b.date ? -1 : 1));
}

/** 追加できたら slot、時間が逆・重複しているなら理由の文字列を返す。 */
export function addSlot({ date, start, end }) {
  const slot = normalizeSlot({ date, start, end });
  if (!slot) return '終わりの時刻を始まりより後にしてください';
  const overlap = slotsOn(date).find(
    (s) => toMinutes(slot.start) < toMinutes(s.end) && toMinutes(s.start) < toMinutes(slot.end),
  );
  if (overlap) return `${overlap.start}〜${overlap.end} と重なっています`;
  state.slots.push(slot);
  persist();
  return slot;
}

export function removeSlot(id) {
  state.slots = state.slots.filter((s) => s.id !== id);
  if (state.plan) state.plan.items = state.plan.items.filter((i) => i.slotId !== id);
  persist();
}

/** 過ぎた日の空き時間を片付ける。件数を返す。 */
export function pruneOldSlots() {
  const today = todayISO();
  const before = state.slots.length;
  state.slots = state.slots.filter((s) => s.date >= today);
  if (state.slots.length !== before) persist();
  return before - state.slots.length;
}

// ---- 予定（空き時間への割り当て） ----

export function setPlan(plan) {
  state.plan = plan;
  persist();
}

export function clearPlan() {
  state.plan = null;
  persist();
}

export function planItemsOn(iso) {
  if (!state.plan) return [];
  return state.plan.items.filter((i) => i.date === iso);
}

// ---- 設定 ----

export function getSettings() {
  return state.settings;
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist();
}

// ---- バックアップ ----

export function exportJSON() {
  // APIキーは書き出さない。バックアップファイルが漏れても鍵は漏れないようにする。
  const { settings, ...rest } = state;
  return JSON.stringify(
    { ...rest, settings: { useAI: settings.useAI }, exportedAt: new Date().toISOString() },
    null,
    2,
  );
}

export function importJSON(text, mode = 'merge') {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.tasks)) throw new Error('タスクの配列が見つかりません');
  const incoming = parsed.tasks.map(normalize);
  const incomingSlots = Array.isArray(parsed.slots) ? parsed.slots.map(normalizeSlot).filter(Boolean) : [];
  if (mode === 'replace') {
    // 設定（APIキー）はこの端末のものを残す。読み込んだファイルには入っていない。
    state = { ...emptyState(), tasks: incoming, history: parsed.history || [], slots: incomingSlots, settings: state.settings };
  } else {
    const knownTasks = new Set(state.tasks.map((t) => t.id));
    state.tasks.push(...incoming.filter((t) => !knownTasks.has(t.id)));
    const knownSlots = new Set(state.slots.map((s) => s.id));
    state.slots.push(...incomingSlots.filter((s) => !knownSlots.has(s.id)));
  }
  persist();
  return incoming.length;
}

export function clearAll() {
  state = emptyState();
  persist();
}

export { normalizeSlot };
