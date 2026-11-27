// 保存ファイルの中身の検証（KTD8）。外から来たファイルなので、形と大きさを確かめてから使う。
import { MAX_SEATS, type TableState } from '../core/state';

export const MAX_SAVE_BYTES = 300 * 1024 * 1024;
export const MAX_ASSET_BYTES = 30 * 1024 * 1024;
export const MAX_CARDS = 5000;
export const MAX_OBJECTS = 2000;

export class SaveError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** TableState として最低限の形をしているか。壊れていれば理由つきで SaveError を投げる。 */
export function validateState(v: unknown): TableState {
  if (!isObj(v)) throw new SaveError('卓の状態が読めません');
  const { cards, objects, hands } = v;
  if (!isObj(cards) || !isObj(objects) || !isObj(hands)) throw new SaveError('卓の状態の形が正しくありません');
  if (Object.keys(cards).length > MAX_CARDS) throw new SaveError(`カードが多すぎます（上限 ${MAX_CARDS} 枚）`);
  if (Object.keys(objects).length > MAX_OBJECTS) throw new SaveError('卓の上の物が多すぎます');
  for (const [id, c] of Object.entries(cards)) {
    if (!isObj(c) || c.id !== id || typeof c.faceHash !== 'string' || typeof c.backHash !== 'string' || !isObj(c.loc)) {
      throw new SaveError('カードの情報が壊れています');
    }
  }
  for (const [id, o] of Object.entries(objects)) {
    if (!isObj(o) || o.id !== id || typeof o.kind !== 'string') throw new SaveError('卓の上の物の情報が壊れています');
  }
  for (let s = 0; s < MAX_SEATS; s++) {
    const h = hands[s];
    if (!Array.isArray(h) || h.some((id) => typeof id !== 'string' || !cards[id])) {
      throw new SaveError('手札の情報が壊れています');
    }
  }
  return v as unknown as TableState;
}
