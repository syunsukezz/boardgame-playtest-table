// 名前のある基本操作（R2）。参加者はこれを送り、ホストが apply で適用する（KTD2）。
import type { ObjectId, PieceShape, Placement, SeatId, Vec3, Visibility } from './state';

/** 配るときの見える人（R8）。 */
export type DealVisibility = 'recipient' | 'others' | 'none' | 'all';

export interface NewCardSpec {
  faceHash: string;
  backHash: string;
  name: string;
}

export type CommandBody =
  | { type: 'grab'; objId: ObjectId }
  | { type: 'release'; objId: ObjectId }
  | { type: 'move'; objId: ObjectId; pos: Vec3 }
  | { type: 'rotate'; objId: ObjectId; rot: number }
  | { type: 'flip'; cardId: ObjectId }
  /** 卓上のカード・山札・手札のカードを、山札（または卓上のカード）の上に重ねる。 */
  | { type: 'stack'; objId: ObjectId; targetId: ObjectId }
  | { type: 'draw'; stackId: ObjectId; count: number }
  /** 卓上のカードを自分の手札に戻す。 */
  | { type: 'toHand'; cardId: ObjectId }
  /** 手札のカードを卓に出す。faceUp を省くと表（R19）。 */
  | { type: 'play'; cardId: ObjectId; pos: Vec3; faceUp?: boolean }
  /** 山札の一番上を卓に出す（裏向き）。 */
  | { type: 'drawToTable'; stackId: ObjectId; pos: Vec3 }
  | { type: 'shuffle'; stackId: ObjectId }
  | { type: 'deal'; stackId: ObjectId; count: number; seats: SeatId[]; visibility: DealVisibility }
  | { type: 'setVisibility'; cardId: ObjectId; visibility: Visibility }
  /** outcome はホストが決めて埋める（KTD7）。参加者が送った値は使わない。 */
  | { type: 'roll'; dieId: ObjectId; outcome?: { value: number; keyframes?: number[] } }
  | { type: 'spawnDeck'; cards: NewCardSpec[]; placement: Placement }
  | { type: 'spawnBoard'; imageHash: string; width: number; depth: number; placement: Placement }
  | { type: 'spawnPiece'; shape: PieceShape; color: string; placement: Placement }
  | { type: 'spawnDie'; placement: Placement }
  | { type: 'delete'; objId: ObjectId };

export type Command = CommandBody & {
  /** 操作した席。兼任中の席として操作したときはその席（R14）。 */
  seat: SeatId;
  /** 二重適用を防ぐための操作 ID。 */
  cmdId: string;
};

/** ログに流す出来事（R11）。文面は席ごとに log.ts で作る。 */
export type LogEvent =
  | { type: 'shuffle'; seat: SeatId; stackId: ObjectId; count: number }
  | { type: 'deal'; seat: SeatId; count: number; seats: SeatId[]; shortfall: number }
  | { type: 'draw'; seat: SeatId; count: number }
  | { type: 'setVisibility'; seat: SeatId; cardId: ObjectId }
  | { type: 'roll'; seat: SeatId; dieId: ObjectId; value: number }
  | { type: 'play'; seat: SeatId; cardId: ObjectId; faceUp: boolean };

export type ApplyError =
  | 'not-found'
  | 'held-by-other'
  | 'invalid-target'
  | 'invalid-args'
  | 'duplicate';
