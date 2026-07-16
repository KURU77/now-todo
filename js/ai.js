// Claude API を使って、割り当ての「順番」だけを決めてもらう（任意機能）。
//
// なぜ順番だけなのか:
//   何分の枠に何ページ入るかは算数で、アルゴリズムが必ず正確に解ける（scheduler.js）。
//   AIに数えさせると間違える余地が増えるだけで、精度は上がらない。
//   一方「タスク名から察するに、これは頭が冴えている午前向き」「この2つは続けてやると楽」
//   といった判断はアルゴリズムには書けない。そこだけを任せる。
//
// AIが返すのは優先順のタスクIDと理由だけ。実際の時間割りは scheduler.js が計算し直すので、
// AIがおかしなことを言っても予定が壊れることはない。
//
// APIキーはこの端末のブラウザに保存され、ここから api.anthropic.com へ直接送られます。
// 中継サーバーは無いので、キーが他人の手に渡ることはありません。

import { getSettings } from './store.js';
import { taskBrief, slotBrief } from './scheduler.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8';
const API_VERSION = '2023-06-01';

const SYSTEM = `あなたは日本語で応答する、予定づくりの相棒です。
利用者の「空き時間」と「やることリスト」を見て、どの順番で手を付けるのが良いかを決めてください。

前提:
- 実際に何分の枠へ何ページ入るかは、アプリ側が正確に計算します。あなたは順番だけを決めてください。
- 時間の計算や個数の割り算をする必要はありません。
- 締切に間に合わせることが最優先です。ただし締切が同じくらいなら、以下も考慮してください。
  - 集中度(focus)が高いものは、まとまった時間が取れる枠で進めたい
  - 似た種類(kind)のものは続けたほうが切り替えの負担が少ない
  - タスク名やメモから読み取れる事情（下ごしらえが要る、他人を待たせている等）

出力:
- order: タスクIDを、着手してほしい順に並べた配列。すべてのタスクを必ず1回ずつ含めること。
- advice: 利用者に向けた助言を1〜2文で。日本語で、事実に基づいて簡潔に。
  間に合いそうにないタスクがあるなら、それを率直に伝えてください。`;

/** 返答の形をここで固定する。API側でスキーマが強制されるので、壊れたJSONは返ってこない。 */
const SCHEMA = {
  type: 'object',
  properties: {
    order: {
      type: 'array',
      description: '着手してほしい順に並べたタスクID',
      items: { type: 'string' },
    },
    advice: {
      type: 'string',
      description: '利用者に向けた1〜2文の助言（日本語）',
    },
  },
  required: ['order', 'advice'],
  additionalProperties: false,
};

export function hasApiKey() {
  const k = getSettings().apiKey;
  return typeof k === 'string' && k.trim().length > 0;
}

export function aiEnabled() {
  return !!getSettings().useAI && hasApiKey();
}

/**
 * 優先順をAIに決めてもらう。
 * @returns {Promise<{order:string[], advice:string}>}
 * @throws {Error} 通信・認証・応答形式の失敗。呼び出し側でアルゴリズムのみに退避すること。
 */
export async function planOrder({ tasks, slots, signal }) {
  const apiKey = getSettings().apiKey.trim();
  if (!apiKey) throw new Error('APIキーが設定されていません');

  const payload = {
    today: new Date().toISOString().slice(0, 10),
    slots: slots.map(slotBrief),
    tasks: tasks.map(taskBrief),
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      // ブラウザから直接呼ぶための明示的な同意。これが無いとCORSで弾かれる。
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{ role: 'user', content: JSON.stringify(payload, null, 2) }],
    }),
  });

  if (!res.ok) throw new Error(await describeError(res));

  const data = await res.json();

  // 安全側の拒否。順番を作れないので、呼び出し側でアルゴリズムに退避する。
  if (data.stop_reason === 'refusal') throw new Error('AIが応答を控えました');
  if (data.stop_reason === 'max_tokens') throw new Error('AIの応答が長すぎて途中で切れました');

  const text = (data.content || []).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('AIの応答が空でした');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AIの応答を読み取れませんでした');
  }
  if (!Array.isArray(parsed.order)) throw new Error('AIの応答に順番が含まれていません');

  return {
    order: parsed.order.filter((id) => typeof id === 'string'),
    advice: typeof parsed.advice === 'string' ? parsed.advice : '',
    usage: data.usage,
  };
}

/** エラーを利用者に見せられる日本語にする。 */
async function describeError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch {
    // 本文が読めないこともある。ステータスだけで案内する。
  }
  const known = {
    401: 'APIキーが正しくないようです。設定を確認してください。',
    403: 'このAPIキーには権限がないようです。',
    404: 'モデルが見つかりません。アプリの更新が必要かもしれません。',
    429: '短時間に使いすぎています。少し待ってからもう一度試してください。',
    529: 'AI側が混み合っています。少し待ってからもう一度試してください。',
  };
  const base = known[res.status] || (res.status >= 500 ? 'AI側で問題が起きています。' : `AIの呼び出しに失敗しました（${res.status}）`);
  return detail ? `${base}\n${detail}` : base;
}
