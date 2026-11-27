// 短い通知（トースト）。操作の失敗やホストへのお知らせに使い、チャットログには流さない。
import { h } from './dom';

const REASONS: Record<string, string> = {
  'held-by-other': 'ほかの人がつかんでいます',
  'not-found': '対象が見つかりません（もう無くなったかもしれません）',
  'invalid-target': 'そこにはその操作ができません',
  'invalid-args': '操作の内容が正しくありません',
  duplicate: '同じ操作が二重に送られました',
  'not-seated': '席に座ってから操作してください',
  'not-your-seat': 'その席は操作できません',
  'seat-taken': 'その席はもう埋まっています',
  'already-seated': 'すでに席に座っています',
  'assignment-pending': 'ホストが席を割り当てるのを待っています',
  'invalid-seat': 'その席はありません',
};

/** 操作の失敗の理由（コード）を、画面に出す文にする。 */
export function errorMessage(reason: string): string {
  return REASONS[reason] ?? `操作できませんでした（${reason}）`;
}

let container: HTMLElement | null = null;

/** 通知を出す。ms が Infinity なら自動では消えない。返り値の関数で消せる。 */
export function showToast(text: string, kind: 'info' | 'error' | 'warn' = 'info', ms = 3500): () => void {
  if (!container || !container.isConnected) {
    container = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(container);
  }
  const t = h('div', { class: `toast ${kind}` }, text);
  container.append(t);
  if (Number.isFinite(ms)) setTimeout(() => t.remove(), ms);
  return () => t.remove();
}
