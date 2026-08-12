// 締切の通知。動く場所によって仕組みが変わる。
//
// ・アプリ版（Capacitor）: OSのローカル通知を「未来の時刻」に予約する。
//   アプリを閉じていても、締切当日の朝などにちゃんと鳴る。これが本命。
// ・ブラウザ（Web版）: 未来の予約はできない（閉じている間は動けない）ので、
//   アプリを開いたときに「その間に過ぎた締切」をまとめてお知らせする。best-effort。
//
// どちらもタスクは端末内のデータから作るだけで、外部には何も送りません。

import * as store from './store.js';

/** アプリ版なら LocalNotifications プラグイン、Web版なら null。 */
function LN() {
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

/** 'native' | 'web' | 'none' */
export function mode() {
  if (LN()) return 'native';
  if ('Notification' in window) return 'web';
  return 'none';
}

/** タスクidと種類から、通知の安定した整数ID（OSは32bit整数を要求する）を作る。 */
function notifId(taskId, kind) {
  const str = `${taskId}:${kind}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2147483000) + 1;
}

/** いま設定されている締切通知の一覧（未来・過去を問わず全部）を作る。 */
function reminders() {
  const n = store.getSettings().notify;
  if (!n.enabled) return [];
  const [h, m] = String(n.time || '09:00').split(':').map(Number);
  const at = (iso) => { const d = store.fromISO(iso); d.setHours(h || 0, m || 0, 0, 0); return d; };
  const title = '今！やることリスト';
  const out = [];

  for (const t of store.activeTasks()) {
    // 締切当日
    out.push({ id: notifId(t.id, 'due'), at: at(t.due), title, body: `今日が締切: ${t.title}`, taskId: t.id });
    // 前日
    if (n.dayBefore) {
      out.push({ id: notifId(t.id, 'before'), at: at(store.addDaysISO(t.due, -1)), title, body: `明日が締切: ${t.title}`, taskId: t.id });
    }
    // 期間タスクは開始日にも
    if (store.isPeriod(t)) {
      out.push({ id: notifId(t.id, 'start'), at: at(t.start), title, body: `今日から: ${t.title}`, taskId: t.id });
    }
  }
  return out;
}

/** 現在の許可状態。'granted' | 'denied' | 'prompt' */
export async function checkPermission() {
  const ln = LN();
  if (ln) {
    try {
      const r = await ln.checkPermissions();
      return r.display || 'prompt';
    } catch {
      return 'prompt';
    }
  }
  if ('Notification' in window) {
    return Notification.permission === 'default' ? 'prompt' : Notification.permission;
  }
  return 'denied';
}

/** 許可を求める。許可されたら true。 */
export async function requestPermission() {
  const ln = LN();
  if (ln) {
    try {
      const r = await ln.requestPermissions();
      return r.display === 'granted';
    } catch {
      return false;
    }
  }
  if ('Notification' in window) {
    const r = await Notification.requestPermission();
    return r === 'granted';
  }
  return false;
}

/**
 * アプリ版: OSの予約を組み直す（毎回、既存を全部消してから未来ぶんを入れ直す）。
 * store が変わるたびに呼んでよい（このなかで store は書き換えないのでループしない）。
 */
export async function syncSchedule() {
  const ln = LN();
  if (!ln) return; // Web版はここでは何もしない
  try {
    const pending = await ln.getPending();
    if (pending?.notifications?.length) {
      await ln.cancel({ notifications: pending.notifications.map((x) => ({ id: x.id })) });
    }
    if (!store.getSettings().notify.enabled) return;
    if ((await checkPermission()) !== 'granted') return;

    const now = Date.now();
    const notifs = reminders()
      .filter((r) => r.at.getTime() > now)   // 未来のぶんだけ
      .slice(0, 480)                          // 予約数の上限に配慮
      .map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        schedule: { at: r.at, allowWhileIdle: true },
        extra: { taskId: r.taskId },
      }));
    if (notifs.length) await ln.schedule({ notifications: notifs });
  } catch (e) {
    console.warn('通知の予約に失敗しました', e);
  }
}

/**
 * Web版: アプリを開いたときに、前回開いてから過ぎた締切をまとめて知らせる。
 * boot と、画面が再表示されたときに呼ぶ（store.subscribe からは呼ばない＝ループ防止）。
 */
export async function catchUp() {
  if (mode() !== 'web') return;
  const n = store.getSettings().notify;
  if (!n.enabled || Notification.permission !== 'granted') return;

  const now = Date.now();
  // 初回（lastCheck が無い）は過去を掘り起こさない。以後、前回確認〜今の間に過ぎたものだけ。
  const since = n.lastCheck ? new Date(n.lastCheck).getTime() : now;
  const due = reminders().filter((r) => {
    const t = r.at.getTime();
    return t > since && t <= now;
  });
  for (const r of due) {
    try {
      new Notification(r.title, { body: r.body, tag: `now-todo-${r.id}` });
    } catch {
      // 通知を出せない環境もある。黙って諦める。
    }
  }
  store.setNotify({ lastCheck: new Date(now).toISOString() });
}
