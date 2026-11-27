// ホストと参加者の間で送るメッセージ。
import type { CommandBody } from '../core/commands';
import type { ViewPatch } from '../core/diff';
import type { View } from '../core/project';
import type { ObjectId, SeatId, Vec3 } from '../core/state';
import type { AssetMessage } from '../assets/transfer';
import type { SeatInfo } from './seats';

/** 参加者が送る操作。席はホストが接続から埋める。 */
export type GuestCommand = CommandBody & { cmdId: string };

export type GuestToHost =
  | { type: 'hello'; name: string; seatKey?: string; fromLocal?: boolean }
  | { type: 'sit'; seat: SeatId }
  | { type: 'command'; cmd: GuestCommand }
  | { type: 'drag'; objId: ObjectId; pos: Vec3 }
  | { type: 'chat'; text: string }
  | { type: 'resync' }
  | { type: 'ping' };

export type HostToGuest =
  | { type: 'welcome'; seats: SeatInfo[]; you: { seat: SeatId | null }; assignmentPending: boolean }
  /** seat が null のときは未着席に戻った（読み込み後・空席に戻された）。 */
  | { type: 'seated'; seat: SeatId | null; seatKey: string | null }
  | { type: 'snapshot'; view: View }
  /** baseRev はこの差分を作った元の View の rev。参加者の rev と違えば取り直す。 */
  | { type: 'patch'; patch: ViewPatch; baseRev: number }
  | { type: 'log'; text: string }
  | { type: 'chat'; from: string; text: string }
  | { type: 'drag'; objId: ObjectId; pos: Vec3; seat: SeatId }
  | { type: 'error'; cmdId?: string; reason: string }
  | { type: 'seats'; seats: SeatInfo[]; assignmentPending: boolean }
  | { type: 'roomFull' }
  | { type: 'roomClosed' }
  | { type: 'ping' }
  | AssetMessage;

export function isAssetMessage(msg: { type: string }): msg is AssetMessage {
  return msg.type === 'asset-begin' || msg.type === 'asset-chunk' || msg.type === 'asset-end';
}

/** 受け取ったものがメッセージの形（type を持つオブジェクト）か。 */
export function hasType(msg: unknown): msg is { type: string } {
  return typeof msg === 'object' && msg !== null && typeof (msg as { type?: unknown }).type === 'string';
}

/** 小さなイベント発行器。on は購読解除の関数を返す。 */
export class Emitter<A extends unknown[]> {
  private cbs = new Set<(...args: A) => void>();

  on(cb: (...args: A) => void): () => void {
    this.cbs.add(cb);
    return () => {
      this.cbs.delete(cb);
    };
  }

  emit(...args: A): void {
    for (const cb of this.cbs) cb(...args);
  }
}
