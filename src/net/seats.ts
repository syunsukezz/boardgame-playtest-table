// 席の管理（HTD「席の状態」、R12, R14, R20, R21, KTD6）。通信に依存しない純粋なロジック。
import { MAX_SEATS, type SeatId } from '../core/state';
import { randomBase32 } from './random';

export type SeatStatus = 'empty' | 'occupied' | 'hosted' | 'disconnected' | 'host';

/** 参加者に配る席の一覧。鍵は入れない。 */
export interface SeatInfo {
  seat: SeatId;
  status: SeatStatus;
  name?: string;
}

interface SeatRecord {
  status: SeatStatus;
  name?: string;
  seatKey?: string;
  connId?: string;
}

export type SitResult =
  | { ok: true; seatKey: string; wasHosted: boolean }
  | { ok: false; reason: 'invalid-seat' | 'seat-taken' | 'already-seated' | 'assignment-pending' };

export const HOST_SEAT: SeatId = 0;

/** 推測できない席の鍵（base32 26文字 ≒ 130bit）。 */
export function randomSeatKey(): string {
  return randomBase32(26);
}

/** 参加者が座れる席（空席か兼任中の席）か。 */
export function isSittable(status: SeatStatus | undefined): boolean {
  return status === 'empty' || status === 'hosted';
}

export class SeatManager {
  private seats: SeatRecord[] = [];
  assignmentPending = false;

  constructor(private readonly newKey: () => string = randomSeatKey) {
    for (let s = 0; s < MAX_SEATS; s++) this.seats.push({ status: s === HOST_SEAT ? 'host' : 'empty' });
  }

  list(): SeatInfo[] {
    return this.seats.map((r, seat) => (r.name !== undefined ? { seat, status: r.status, name: r.name } : { seat, status: r.status }));
  }

  status(seat: SeatId): SeatStatus | undefined {
    return this.seats[seat]?.status;
  }

  nameOf(seat: SeatId): string | undefined {
    return this.seats[seat]?.name;
  }

  seatOf(connId: string): SeatId | null {
    const i = this.seats.findIndex((r) => r.connId === connId && r.status === 'occupied');
    return i >= 0 ? i : null;
  }

  /** 座れる席（空席と兼任中の席）の数。 */
  freeCount(): number {
    return this.seats.filter((r) => isSittable(r.status)).length;
  }

  sit(connId: string, seat: SeatId, name: string): SitResult {
    if (this.assignmentPending) return { ok: false, reason: 'assignment-pending' };
    const r = this.seats[seat];
    if (!r || !Number.isInteger(seat)) return { ok: false, reason: 'invalid-seat' };
    if (this.seatOf(connId) !== null) return { ok: false, reason: 'already-seated' };
    if (!isSittable(r.status)) return { ok: false, reason: 'seat-taken' };
    const wasHosted = r.status === 'hosted';
    return { ok: true, seatKey: this.occupy(seat, connId, name), wasHosted };
  }

  /**
   * 席の鍵で戻る。切断中の席にも、着席中の席（古い接続との差し替え）にも使える。
   * fromLocal の鍵（別タブの可能性がある）では、着席中の席は奪わない。
   */
  rejoin(connId: string, seatKey: string, opts: { fromLocal?: boolean } = {}): { seat: SeatId; replacedConnId: string | undefined } | null {
    if (!seatKey) return null;
    const seat = this.seats.findIndex((r) => r.seatKey === seatKey && (r.status === 'occupied' || r.status === 'disconnected'));
    if (seat < 0) return null;
    const r = this.seats[seat]!;
    if (r.status === 'occupied' && opts.fromLocal) return null;
    const replacedConnId = r.status === 'occupied' && r.connId !== connId ? r.connId : undefined;
    r.status = 'occupied';
    r.connId = connId;
    return { seat, replacedConnId };
  }

  /** 接続が切れた席を切断中にする。席に座っていなければ null。 */
  markDisconnected(connId: string): SeatId | null {
    const seat = this.seatOf(connId);
    if (seat === null) return null;
    const r = this.seats[seat]!;
    r.status = 'disconnected';
    delete r.connId;
    return seat;
  }

  hostSeat(seat: SeatId): boolean {
    const r = this.seats[seat];
    if (!r || r.status !== 'empty') return false;
    this.seats[seat] = { status: 'hosted' };
    return true;
  }

  unhostSeat(seat: SeatId): boolean {
    const r = this.seats[seat];
    if (!r || r.status !== 'hosted') return false;
    this.seats[seat] = { status: 'empty' };
    return true;
  }

  /** 切断中・着席中の席を空席に戻す。手札は state 側に残る。戻した席にいた接続 ID を返す。 */
  freeSeat(seat: SeatId): { ok: boolean; connId?: string } {
    const r = this.seats[seat];
    if (!r || (r.status !== 'disconnected' && r.status !== 'occupied')) return { ok: false };
    const connId = r.connId;
    this.seats[seat] = { status: 'empty' };
    return connId !== undefined ? { ok: true, connId } : { ok: true };
  }

  /** ホストによる割り当て（読み込み後など）。新しい鍵を返す。 */
  assign(connId: string, seat: SeatId, name: string): string | null {
    const r = this.seats[seat];
    if (!r || !isSittable(r.status)) return null;
    if (this.seatOf(connId) !== null) return null;
    return this.occupy(seat, connId, name);
  }

  finishAssignment(): void {
    this.assignmentPending = false;
  }

  /** 席を着席中にし、新しい鍵を発行して返す（呼ぶたびに新しい鍵）。 */
  private occupy(seat: SeatId, connId: string, name: string): string {
    const seatKey = this.newKey();
    this.seats[seat] = { status: 'occupied', name, seatKey, connId };
    return seatKey;
  }

  /** 保存ファイルの読み込み: ホスト以外の全席を空席にし、割り当て待ちにする（R21）。 */
  resetForLoad(): void {
    for (let s = 0; s < MAX_SEATS; s++) if (s !== HOST_SEAT) this.seats[s] = { status: 'empty' };
    this.assignmentPending = true;
  }
}
