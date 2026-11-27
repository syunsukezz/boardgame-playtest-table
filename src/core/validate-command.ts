// 参加者から届いた操作の形を確かめる。外から来た値なので、型の約束を信じず1つずつ確かめて作り直す。
// 形が正しくなければ null（ホストは invalid-args を返す）。中身の妥当性（物があるか等）は apply が確かめる。
import type { CommandBody, DealVisibility, NewCardSpec } from './commands';
import { isSeatId, type PieceShape, type Placement, type SeatId, type Vec3, type Visibility } from './state';

/** 1回の spawnDeck で受け付けるカードの上限。 */
export const MAX_SPAWN_CARDS = 1000;
export const MAX_CARD_NAME = 100;
export const MAX_COLOR_LENGTH = 32;
/** ID・ハッシュとして受け付ける文字列の長さの上限。 */
const MAX_ID_LENGTH = 128;

const DEAL_VISIBILITIES: readonly DealVisibility[] = ['recipient', 'others', 'none', 'all'];
const PIECE_SHAPES: readonly PieceShape[] = ['pawn', 'cube', 'disc', 'cone'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

export function parseVec3(v: unknown): Vec3 | null {
  if (!isObj(v) || !isFiniteNum(v.x) || !isFiniteNum(v.y) || !isFiniteNum(v.z)) return null;
  return { x: v.x, y: v.y, z: v.z };
}

export function parsePlacement(v: unknown): Placement | null {
  if (!isObj(v) || !isFiniteNum(v.rot)) return null;
  const pos = parseVec3(v.pos);
  return pos ? { pos, rot: v.rot } : null;
}

export function parseSeats(v: unknown): SeatId[] | null {
  if (!Array.isArray(v) || v.length > 64) return null;
  if (!v.every((s) => typeof s === 'number' && isSeatId(s))) return null;
  return [...(v as SeatId[])];
}

export function parseVisibility(v: unknown): Visibility | null {
  if (!isObj(v)) return null;
  if (v.kind === 'all' || v.kind === 'none') return { kind: v.kind };
  if (v.kind !== 'seats') return null;
  const seats = parseSeats(v.seats);
  return seats ? { kind: 'seats', seats } : null;
}

function parseCards(v: unknown): NewCardSpec[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_SPAWN_CARDS) return null;
  const out: NewCardSpec[] = [];
  for (const c of v) {
    if (!isObj(c) || !isId(c.faceHash) || !isId(c.backHash)) return null;
    if (typeof c.name !== 'string' || c.name.length > MAX_CARD_NAME) return null;
    out.push({ faceHash: c.faceHash, backHash: c.backHash, name: c.name });
  }
  return out;
}

/** 届いた操作を、型どおりの新しいオブジェクトに作り直す。余計なプロパティは捨てる。 */
export function validateCommandBody(body: unknown): CommandBody | null {
  if (!isObj(body)) return null;
  const b = body;
  switch (b.type) {
    case 'grab':
    case 'release':
    case 'delete':
      return isId(b.objId) ? { type: b.type, objId: b.objId } : null;
    case 'move': {
      const pos = parseVec3(b.pos);
      return isId(b.objId) && pos ? { type: 'move', objId: b.objId, pos } : null;
    }
    case 'rotate':
      return isId(b.objId) && isFiniteNum(b.rot) ? { type: 'rotate', objId: b.objId, rot: b.rot } : null;
    case 'flip':
    case 'toHand':
      return isId(b.cardId) ? { type: b.type, cardId: b.cardId } : null;
    case 'stack':
      return isId(b.objId) && isId(b.targetId) ? { type: 'stack', objId: b.objId, targetId: b.targetId } : null;
    case 'draw':
      return isId(b.stackId) && isPositiveInt(b.count) ? { type: 'draw', stackId: b.stackId, count: b.count } : null;
    case 'play': {
      const pos = parseVec3(b.pos);
      if (!isId(b.cardId) || !pos) return null;
      if (b.faceUp !== undefined && typeof b.faceUp !== 'boolean') return null;
      return b.faceUp === undefined ? { type: 'play', cardId: b.cardId, pos } : { type: 'play', cardId: b.cardId, pos, faceUp: b.faceUp };
    }
    case 'drawToTable': {
      const pos = parseVec3(b.pos);
      return isId(b.stackId) && pos ? { type: 'drawToTable', stackId: b.stackId, pos } : null;
    }
    case 'shuffle':
      return isId(b.stackId) ? { type: 'shuffle', stackId: b.stackId } : null;
    case 'deal': {
      const seats = parseSeats(b.seats);
      const vis = b.visibility;
      if (!isId(b.stackId) || !isPositiveInt(b.count) || !seats) return null;
      if (!DEAL_VISIBILITIES.includes(vis as DealVisibility)) return null;
      return { type: 'deal', stackId: b.stackId, count: b.count, seats, visibility: vis as DealVisibility };
    }
    case 'setVisibility': {
      const visibility = parseVisibility(b.visibility);
      return isId(b.cardId) && visibility ? { type: 'setVisibility', cardId: b.cardId, visibility } : null;
    }
    case 'roll':
      // 出目はホストが決める（KTD7）。参加者が送った outcome は形を問わず捨てる。
      return isId(b.dieId) ? { type: 'roll', dieId: b.dieId } : null;
    case 'spawnDeck': {
      const cards = parseCards(b.cards);
      const placement = parsePlacement(b.placement);
      return cards && placement ? { type: 'spawnDeck', cards, placement } : null;
    }
    case 'spawnBoard': {
      const placement = parsePlacement(b.placement);
      if (!isId(b.imageHash) || !placement) return null;
      if (!isFiniteNum(b.width) || !isFiniteNum(b.depth) || b.width <= 0 || b.depth <= 0) return null;
      return { type: 'spawnBoard', imageHash: b.imageHash, width: b.width, depth: b.depth, placement };
    }
    case 'spawnPiece': {
      const placement = parsePlacement(b.placement);
      if (!PIECE_SHAPES.includes(b.shape as PieceShape) || !placement) return null;
      if (typeof b.color !== 'string' || b.color.length > MAX_COLOR_LENGTH) return null;
      return { type: 'spawnPiece', shape: b.shape as PieceShape, color: b.color, placement };
    }
    case 'spawnDie': {
      const placement = parsePlacement(b.placement);
      return placement ? { type: 'spawnDie', placement } : null;
    }
    default:
      return null;
  }
}
