// チャットの文面の検証。文字列のまま扱い、HTML にはしない（表示側は textContent で出す）。

export const CHAT_MAX_LENGTH = 500;

/** 前後の空白を除き、500文字までに切る。空や文字列でないものは null。 */
export function sanitizeChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t.length === 0) return null;
  return [...t].slice(0, CHAT_MAX_LENGTH).join('');
}
