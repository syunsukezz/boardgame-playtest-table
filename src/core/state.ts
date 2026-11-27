// 卓の全状態。ホストだけがこの完全な形を持つ（KTD2）。
// three.js や PeerJS を参照しない純粋なデータとして保つ。

export type SeatId = number;
export type ObjectId = string;

export const MAX_SEATS = 8;

/** 卓面の半分の幅（x）と奥行き（z）。卓面は y=0。描画とサイコロの物理演算で共有する。 */
export const TABLE_HALF_W = 6;
export const TABLE_HALF_D = 4;

/** 0〜MAX_SEATS-1 の整数か。 */
export function isSeatId(n: number): n is SeatId {
  return Number.isInteger(n) && n >= 0 && n < MAX_SEATS;
}

/** 席の並びを整える: 重複と範囲外を除き、小さい順に並べる。 */
export function normalizeSeats(seats: readonly number[]): SeatId[] {
  return [...new Set(seats)].filter(isSeatId).sort((a, b) => a - b);
}

/** 席番号（0始まり）を画面の名前にする。 */
export function seatLabel(seat: number): string {
  return `席${seat + 1}`;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 卓面上の位置と、上向き軸まわりの回転（ラジアン）。 */
export interface Placement {
  pos: Vec3;
  rot: number;
}

/** 手札のカードの「見える人」（R5）。 */
export type Visibility =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'seats'; seats: SeatId[] };

/** カードのある場所。見える人は場所で決まる（R5, R19）。 */
export type CardLocation =
  | { type: 'table'; placement: Placement; faceUp: boolean }
  | { type: 'hand'; seat: SeatId; visibility: Visibility }
  | { type: 'stack'; stackId: ObjectId };

export interface Card {
  id: ObjectId;
  /** 表の画像のハッシュ。中身そのもの。 */
  faceHash: string;
  /** 裏の画像のハッシュ。山札ごとに共通。 */
  backHash: string;
  name: string;
  loc: CardLocation;
}

/** 卓上の山札。cardIds の末尾が一番上。山札の中のカードは誰にも見えない。 */
export interface Stack {
  id: ObjectId;
  kind: 'stack';
  placement: Placement;
  cardIds: ObjectId[];
  /** 山札が空になったときに表示する裏面。 */
  backHash: string;
}

export type PieceShape = 'pawn' | 'cube' | 'disc' | 'cone';

export interface Piece {
  id: ObjectId;
  kind: 'piece';
  shape: PieceShape;
  color: string;
  placement: Placement;
}

export interface Die {
  id: ObjectId;
  kind: 'die';
  placement: Placement;
  /** 最後に出た目（1〜6）。 */
  value: number;
}

export interface Board {
  id: ObjectId;
  kind: 'board';
  imageHash: string;
  width: number;
  depth: number;
  placement: Placement;
}

export type TableObject = Stack | Piece | Die | Board;

export interface TableState {
  rev: number;
  cards: Record<ObjectId, Card>;
  objects: Record<ObjectId, TableObject>;
  /** 席ごとの手札の並び順。 */
  hands: Record<SeatId, ObjectId[]>;
  /** 物をつかんでいる席（KTD10）。 */
  heldBy: Record<ObjectId, SeatId>;
  /** 同じ操作を二重に適用しないための、最近の cmdId。 */
  recentCmdIds: string[];
}

export function emptyState(): TableState {
  const hands: Record<SeatId, ObjectId[]> = {};
  for (let s = 0; s < MAX_SEATS; s++) hands[s] = [];
  return { rev: 0, cards: {}, objects: {}, hands, heldBy: {}, recentCmdIds: [] };
}
