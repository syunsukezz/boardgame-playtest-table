// 保存ファイルの中身の検証（KTD8）。外から来たファイルなので、形と大きさを確かめてから使う。
// 型の約束を信じず、1つずつ確かめて新しいオブジェクトに作り直す（余計なプロパティは捨てる）。
import {
  MAX_SEATS,
  isSeatId,
  type Card,
  type CardLocation,
  type ObjectId,
  type PieceShape,
  type Placement,
  type SeatId,
  type TableObject,
  type TableState,
  type Visibility,
} from '../core/state';

export const MAX_SAVE_BYTES = 300 * 1024 * 1024;
export const MAX_ASSET_BYTES = 30 * 1024 * 1024;
export const MAX_CARDS = 5000;
export const MAX_OBJECTS = 2000;

const PIECE_SHAPES: readonly PieceShape[] = ['pawn', 'cube', 'disc', 'cone'];

export class SaveError extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

const broken = (what: string): never => {
  throw new SaveError(`${what}の情報が壊れています`);
};

function placement(v: unknown, what: string): Placement {
  if (!isObj(v) || !isObj(v.pos) || !isFiniteNum(v.rot)) return broken(what);
  const { x, y, z } = v.pos;
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) return broken(what);
  return { pos: { x, y, z }, rot: v.rot };
}

function visibility(v: unknown): Visibility {
  if (!isObj(v)) return broken('手札のカードの見える人');
  if (v.kind === 'all' || v.kind === 'none') return { kind: v.kind };
  if (v.kind !== 'seats' || !Array.isArray(v.seats)) return broken('手札のカードの見える人');
  if (!v.seats.every((s) => typeof s === 'number' && isSeatId(s))) return broken('手札のカードの見える人');
  return { kind: 'seats', seats: [...(v.seats as SeatId[])] };
}

function cardLoc(v: unknown): CardLocation {
  if (!isObj(v)) return broken('カードの場所');
  switch (v.type) {
    case 'table':
      if (typeof v.faceUp !== 'boolean') return broken('卓上のカード');
      return { type: 'table', placement: placement(v.placement, '卓上のカードの位置'), faceUp: v.faceUp };
    case 'hand':
      if (typeof v.seat !== 'number' || !isSeatId(v.seat)) return broken('手札のカードの席');
      return { type: 'hand', seat: v.seat, visibility: visibility(v.visibility) };
    case 'stack':
      if (typeof v.stackId !== 'string') return broken('山札の中のカード');
      return { type: 'stack', stackId: v.stackId };
    default:
      return broken('カードの場所');
  }
}

function card(id: string, c: unknown): Card {
  if (!isObj(c) || c.id !== id || typeof c.faceHash !== 'string' || typeof c.backHash !== 'string' || typeof c.name !== 'string') {
    return broken('カード');
  }
  return { id, faceHash: c.faceHash, backHash: c.backHash, name: c.name, loc: cardLoc(c.loc) };
}

function tableObject(id: string, o: unknown): TableObject {
  if (!isObj(o) || o.id !== id) return broken('卓の上の物');
  const what = '卓の上の物';
  switch (o.kind) {
    case 'stack':
      if (!isStringArray(o.cardIds) || typeof o.backHash !== 'string') return broken('山札');
      return { id, kind: 'stack', placement: placement(o.placement, what), cardIds: [...o.cardIds], backHash: o.backHash };
    case 'board':
      if (typeof o.imageHash !== 'string' || !isFiniteNum(o.width) || !isFiniteNum(o.depth)) return broken('盤面');
      return { id, kind: 'board', imageHash: o.imageHash, width: o.width, depth: o.depth, placement: placement(o.placement, what) };
    case 'piece':
      if (!PIECE_SHAPES.includes(o.shape as PieceShape) || typeof o.color !== 'string') return broken('駒');
      return { id, kind: 'piece', shape: o.shape as PieceShape, color: o.color, placement: placement(o.placement, what) };
    case 'die':
      if (typeof o.value !== 'number' || !Number.isInteger(o.value) || o.value < 1 || o.value > 6) return broken('サイコロ');
      return { id, kind: 'die', value: o.value, placement: placement(o.placement, what) };
    default:
      return broken(what);
  }
}

/** TableState として正しい形をしているか。壊れていれば理由つきで SaveError を投げる。 */
export function validateState(v: unknown): TableState {
  if (!isObj(v)) throw new SaveError('卓の状態が読めません');
  const { cards: rawCards, objects: rawObjects, hands: rawHands, rev } = v;
  if (!isObj(rawCards) || !isObj(rawObjects) || !isObj(rawHands)) throw new SaveError('卓の状態の形が正しくありません');
  if (!isFiniteNum(rev)) throw new SaveError('卓の状態の版（rev）が正しくありません');
  if (Object.keys(rawCards).length > MAX_CARDS) throw new SaveError(`カードが多すぎます（上限 ${MAX_CARDS} 枚）`);
  if (Object.keys(rawObjects).length > MAX_OBJECTS) throw new SaveError('卓の上の物が多すぎます');

  const cards: Record<ObjectId, Card> = {};
  for (const [id, c] of Object.entries(rawCards)) cards[id] = card(id, c);
  const objects: Record<ObjectId, TableObject> = {};
  for (const [id, o] of Object.entries(rawObjects)) {
    if (cards[id]) broken('卓の上の物');
    objects[id] = tableObject(id, o);
  }

  // 山札とその中のカードが互いに指し合っているか（どのカードも1つの山札にだけ入る）
  const inStack = new Map<ObjectId, ObjectId>();
  for (const o of Object.values(objects)) {
    if (o.kind !== 'stack') continue;
    for (const cid of o.cardIds) {
      const c = cards[cid];
      if (!c || c.loc.type !== 'stack' || c.loc.stackId !== o.id || inStack.has(cid)) broken('山札');
      inStack.set(cid, o.id);
    }
  }
  for (const c of Object.values(cards)) {
    if (c.loc.type === 'stack' && inStack.get(c.id) !== c.loc.stackId) broken('山札の中のカード');
  }

  // 手札の並びとカードの席が一致しているか（手札のカードはちょうど1回ずつ並ぶ）
  const hands: Record<SeatId, ObjectId[]> = {};
  const inHand = new Set<ObjectId>();
  for (let s = 0; s < MAX_SEATS; s++) {
    const h = rawHands[s];
    if (!isStringArray(h)) throw new SaveError('手札の情報が壊れています');
    for (const id of h) {
      const c = cards[id];
      if (!c || c.loc.type !== 'hand' || c.loc.seat !== s || inHand.has(id)) throw new SaveError('手札の情報が壊れています');
      inHand.add(id);
    }
    hands[s] = [...h];
  }
  for (const c of Object.values(cards)) {
    if (c.loc.type === 'hand' && !inHand.has(c.id)) throw new SaveError('手札の情報が壊れています');
  }

  return { rev, cards, objects, hands, heldBy: {}, recentCmdIds: [] };
}
