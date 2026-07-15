// 「空いた時間」と「そのときの気分」から、今やるとよさそうなタスクを選ぶ。
//
// 考え方: 3つの観点をそれぞれ 0〜100 点にして、重みつきで足す。
//   締切 (urgency)  … 期限までの残り日数と、残り作業量から来る切迫感
//   時間 (timeFit)  … その空き時間にきれいに収まるか、無駄なく使えるか
//   気分 (moodFit)  … 今の集中力・やりたい種類と噛み合うか
// 重みは合計 1.0。どれかを 0 にしても壊れないようにしてある。

import {
  KINDS, daysUntil, remainingUnits, remainingMinutes, isChunkable, activeTasks,
} from './store.js';

const WEIGHTS = { urgency: 0.38, timeFit: 0.30, moodFit: 0.32 };

/** 気分プリセット。energy は 1=だるい 2=ふつう 3=やる気ある。 */
export const MOODS = [
  { id: 'low', label: 'だるい', icon: '🥱', energy: 1, kinds: [] },
  { id: 'normal', label: 'ふつう', icon: '🙂', energy: 2, kinds: [] },
  { id: 'high', label: 'やる気ある', icon: '🔥', energy: 3, kinds: [] },
];

/** 締切までの日数を切迫感に変換する。 */
function urgencyFromDays(d) {
  if (d < 0) return 100;       // 期限切れ
  if (d === 0) return 96;      // 今日まで
  if (d <= 1) return 88;
  if (d <= 3) return 76;
  if (d <= 7) return 62;
  if (d <= 14) return 50;
  if (d <= 30) return 40;
  if (d <= 90) return 27;
  if (d <= 180) return 17;
  return 10;
}

/**
 * 残り作業量から来る上乗せ。
 * 期限まで毎日どれくらい進めないと終わらないか＝1日あたり必要な分数で測る。
 * 1日1時間以上必要なら満点近くまで上乗せする。
 */
function pressureBonus(task) {
  const d = Math.max(1, daysUntil(task.due));
  const perDay = remainingMinutes(task) / d;
  return Math.min(20, (perDay / 60) * 20);
}

/**
 * その空き時間で実際に何単位こなせるかを求める。
 * 区切れないタスクは「まるごと入るか、入らないか」の二択。
 */
export function planFor(task, freeMinutes) {
  const remUnits = remainingUnits(task);
  const remMin = remainingMinutes(task);
  if (remUnits <= 0) return { units: 0, minutes: 0, finishes: false };

  if (!isChunkable(task)) {
    if (remMin <= freeMinutes) return { units: remUnits, minutes: remMin, finishes: true };
    return { units: 0, minutes: 0, finishes: false };
  }
  const units = Math.min(remUnits, Math.floor(freeMinutes / task.minutesPerUnit));
  return { units, minutes: units * task.minutesPerUnit, finishes: units === remUnits };
}

/** 空き時間をどれだけ有効に使えるか。使い切るほど高い。終わり切るならボーナス。 */
function timeFitScore(plan, freeMinutes) {
  if (plan.minutes <= 0) return 0;
  const utilization = Math.min(1, plan.minutes / freeMinutes);
  let score = 40 + 60 * utilization;
  if (plan.finishes) score = Math.min(100, score + 12); // 片付くのは気持ちいいので少し優遇
  return score;
}

/** 今の集中力と、タスクが要求する集中度の噛み合い。 */
function energyFitScore(task, energy) {
  const diff = task.focus - energy;
  if (diff > 0) return Math.max(0, 100 - diff * 40);  // 気力が足りない
  return 100 + diff * 15;                             // 余力あり（少しもったいない）
}

/** やりたい種類との一致。何も選んでいなければ中立。 */
function kindFitScore(task, kinds) {
  if (!kinds || kinds.length === 0) return 60;
  return kinds.includes(task.kind) ? 100 : 25;
}

function reasonsFor(task, plan, days, parts) {
  const r = [];
  if (days < 0) r.push(`⚠️ ${-days}日 過ぎている`);
  else if (days === 0) r.push('⏰ 締切は今日');
  else if (days <= 3) r.push(`⏰ あと${days}日`);
  else if (days <= 7) r.push(`残り${days}日`);

  if (plan.finishes) r.push('✅ この時間で終わる');
  else if (task.unitType !== 'task') r.push(`${plan.units}${unitWord(task)}進められる`);

  if (parts.moodFit >= 75) r.push('👍 今の気分に合う');
  else if (parts.moodFit < 40) r.push('気力は要るかも');

  const perDay = remainingMinutes(task) / Math.max(1, days);
  if (days > 0 && perDay >= 60) r.push(`このままだと1日${Math.round(perDay)}分ペース`);
  return r;
}

function unitWord(task) {
  return task.unitType === 'page' ? 'ページ' : task.unitType === 'item' ? '個' : '回';
}

/**
 * 提案を作る。
 * @param {{minutes:number, energy:number, kinds:string[]}} mood
 * @returns {{picks:Array, tooLong:Array}} picks=おすすめ順, tooLong=時間が足りず外したもの
 */
export function suggest({ minutes, energy, kinds }) {
  const free = Math.max(1, Number(minutes) || 0);
  const picks = [];
  const tooLong = [];

  for (const task of activeTasks()) {
    const plan = planFor(task, free);
    const days = daysUntil(task.due);

    if (plan.minutes <= 0) {
      tooLong.push({ task, shortBy: remainingMinutes(task) - free });
      continue;
    }

    const parts = {
      urgency: Math.min(100, urgencyFromDays(days) + pressureBonus(task)),
      timeFit: timeFitScore(plan, free),
      moodFit: 0.6 * energyFitScore(task, energy) + 0.4 * kindFitScore(task, kinds),
    };
    const score =
      parts.urgency * WEIGHTS.urgency +
      parts.timeFit * WEIGHTS.timeFit +
      parts.moodFit * WEIGHTS.moodFit;

    picks.push({ task, plan, score, parts, days, reasons: reasonsFor(task, plan, days, parts) });
  }

  picks.sort((a, b) => b.score - a.score || a.days - b.days);
  tooLong.sort((a, b) => a.shortBy - b.shortBy);
  return { picks, tooLong };
}

/** カードに出す短い説明。スコアの内訳のうち一番効いた観点を言葉にする。 */
export function headline(pick) {
  const { parts } = pick;
  const top = Object.entries(parts).sort((a, b) => b[1] * WEIGHTS[b[0]] - a[1] * WEIGHTS[a[0]])[0][0];
  if (top === 'urgency') return '締切が迫っているので';
  if (top === 'timeFit') return '空き時間にぴったり収まるので';
  return '今の気分で進めやすいので';
}

export { KINDS };
