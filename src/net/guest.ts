// 参加者側のセッション。ホストから届く切り出し（View）を持ち、操作を送る。
import type { CommandBody } from '../core/commands';
import { applyPatch } from '../core/diff';
import type { View } from '../core/project';
import { cryptoRng, randomId } from '../core/rng';
import type { ObjectId, SeatId, Vec3 } from '../core/state';
import type { AssetStore } from '../assets/store';
import { AssetReceiver } from '../assets/transfer';
import { sanitizeChat } from './chat';
import { Heartbeat, type Clock } from './heartbeat';
import { DragThrottle } from './drag-throttle';
import { Emitter, hasType, isAssetMessage, type GuestToHost, type HostToGuest } from './protocol';
import type { SeatInfo } from './seats';
import { ConnectionError, type Connection, type ConnectionFailure, type GuestTransport } from './transport';

/** sessionStorage / localStorage と同じ形。テストでは2タブを模して差し替える。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SeatKeyStorage {
  /** タブごと。第一の保存先（KTD6）。 */
  session: StorageLike;
  /** ブラウザ共有。タブを閉じて開き直したときの控え。 */
  local: StorageLike;
}

export type GuestStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'full' | 'failed';

export interface GuestSessionOptions {
  transport: GuestTransport;
  assets: AssetStore;
  storage: SeatKeyStorage;
  roomId: string;
  /** 再接続の待ち時間。尽きたら failed。 */
  reconnectDelaysMs?: number[];
  clock?: Clock;
}

const DEFAULT_RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 8000];

export class GuestSession {
  private conn: Connection | null = null;
  private heartbeat: Heartbeat | null = null;
  private view: View | null = null;
  private seat: SeatId | null = null;
  private seats: SeatInfo[] = [];
  private assignmentPending = false;
  private status: GuestStatus = 'closed';
  private name = '';
  private terminated = false;
  private attempts = 0;
  private resyncPending = false;
  /** hello で送った鍵が sessionStorage のものか。 */
  private sentSessionKey = false;
  private readonly receiver = new AssetReceiver();
  private readonly rng = cryptoRng();
  private readonly drags = new DragThrottle<Vec3>((objId, pos) => this.send({ type: 'drag', objId, pos }), () => Date.now());
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly viewEv = new Emitter<[View]>();
  private readonly logEv = new Emitter<[string]>();
  private readonly chatEv = new Emitter<[string, string]>();
  private readonly seatsEv = new Emitter<[SeatInfo[], boolean]>();
  private readonly errorEv = new Emitter<[string, string | undefined]>();
  private readonly dragEv = new Emitter<[ObjectId, Vec3, SeatId]>();
  private readonly diceEv = new Emitter<[ObjectId, number[]]>();
  private readonly statusEv = new Emitter<[GuestStatus, ConnectionFailure | undefined]>();

  constructor(private readonly opts: GuestSessionOptions) {}

  // ---- イベント ----
  onView(cb: (view: View) => void): () => void {
    return this.viewEv.on(cb);
  }
  onLog(cb: (text: string) => void): () => void {
    return this.logEv.on(cb);
  }
  onChat(cb: (from: string, text: string) => void): () => void {
    return this.chatEv.on(cb);
  }
  onSeats(cb: (seats: SeatInfo[], assignmentPending: boolean) => void): () => void {
    return this.seatsEv.on(cb);
  }
  onError(cb: (reason: string, cmdId?: string) => void): () => void {
    return this.errorEv.on(cb);
  }
  onDiceRoll(cb: (dieId: ObjectId, keyframes: number[]) => void): () => void {
    return this.diceEv.on(cb);
  }
  onRemoteDrag(cb: (objId: ObjectId, pos: Vec3, seat: SeatId) => void): () => void {
    return this.dragEv.on(cb);
  }
  /** failed のときは原因の候補（R28）が2つ目に入る。 */
  onStatus(cb: (status: GuestStatus, reason?: ConnectionFailure) => void): () => void {
    return this.statusEv.on(cb);
  }

  // ---- 参照 ----
  getView(): View | null {
    return this.view;
  }
  getSeat(): SeatId | null {
    return this.seat;
  }
  getSeats(): SeatInfo[] {
    return this.seats;
  }
  isAssignmentPending(): boolean {
    return this.assignmentPending;
  }
  getStatus(): GuestStatus {
    return this.status;
  }

  // ---- 操作 ----
  async join(name: string): Promise<void> {
    this.name = name;
    this.terminated = false;
    this.attempts = 0;
    this.setStatus('connecting');
    await this.connect();
  }

  sit(seat: SeatId): void {
    this.send({ type: 'sit', seat });
  }

  /** 操作を送る。席はホストが埋める。返り値の cmdId でエラーと対応づけられる。 */
  submit(body: CommandBody): string {
    const cmdId = `g-${randomId(this.rng, 16)}`;
    // 落とした・離した物の、送信待ちのドラッグ位置は取りやめる（離した後に古い位置が届かないように）。
    if (body.type === 'release' || body.type === 'move' || body.type === 'stack' || body.type === 'delete') this.drags.cancel(body.objId);
    else if (body.type === 'toHand') this.drags.cancel(body.cardId);
    this.send({ type: 'command', cmd: { ...body, cmdId } });
    return cmdId;
  }

  /** ドラッグ中の位置。約20Hz に間引き、最後の位置は必ず送る（KTD10）。 */
  drag(objId: ObjectId, pos: Vec3): void {
    this.drags.push(objId, pos);
  }

  chat(text: string): void {
    const t = sanitizeChat(text);
    if (t !== null) this.send({ type: 'chat', text: t });
  }

  /** 自分から抜ける。再接続しない。 */
  leave(): void {
    this.terminate('closed');
  }

  // ---- 接続 ----
  private get keyName(): string {
    return `tt-seat-key:${this.opts.roomId}`;
  }

  private async connect(): Promise<void> {
    let conn: Connection;
    try {
      conn = await this.opts.transport.connect();
    } catch (e) {
      if (this.terminated) return;
      if (this.attempts > 0) return this.scheduleReconnect();
      const reason = e instanceof ConnectionError ? e.reason : 'unknown';
      this.terminated = true;
      this.setStatus('failed', reason);
      return;
    }
    if (this.terminated) {
      conn.close();
      return;
    }
    this.conn = conn;
    this.view = null;
    this.resyncPending = false;
    const lost = (): void => {
      if (this.conn !== conn) return;
      this.dropConnection();
      if (!this.terminated) this.scheduleReconnect();
    };
    conn.onMessage((m) => {
      if (this.conn !== conn) return;
      this.heartbeat?.touch();
      if (hasType(m)) this.handle(m as HostToGuest);
    });
    conn.onClose(lost);
    this.heartbeat = new Heartbeat({
      ...(this.opts.clock ? { clock: this.opts.clock } : {}),
      sendPing: () => conn.send({ type: 'ping' } satisfies GuestToHost),
      onTimeout: () => {
        lost();
        conn.close();
      },
    });
    this.heartbeat.start();

    const sessionKey = this.opts.storage.session.getItem(this.keyName);
    const localKey = this.opts.storage.local.getItem(this.keyName);
    this.sentSessionKey = sessionKey !== null;
    const hello: GuestToHost = sessionKey
      ? { type: 'hello', name: this.name, seatKey: sessionKey }
      : localKey
        ? { type: 'hello', name: this.name, seatKey: localKey, fromLocal: true }
        : { type: 'hello', name: this.name };
    conn.send(hello);
  }

  private scheduleReconnect(): void {
    const delays = this.opts.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS;
    if (this.attempts >= delays.length) {
      this.terminated = true;
      this.setStatus('failed', 'unknown');
      return;
    }
    this.setStatus('reconnecting');
    const delay = delays[this.attempts++]!;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.terminated) void this.connect();
    }, delay);
  }

  private dropConnection(): void {
    this.heartbeat?.stop();
    this.heartbeat = null;
    this.conn = null;
  }

  private terminate(status: GuestStatus): void {
    this.terminated = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.drags.dispose();
    const conn = this.conn;
    this.dropConnection();
    conn?.close();
    this.setStatus(status);
  }

  private send(msg: GuestToHost): void {
    this.conn?.send(msg);
  }

  private setStatus(s: GuestStatus, reason?: ConnectionFailure): void {
    this.status = s;
    this.statusEv.emit(s, reason);
  }

  private saveKey(key: string): void {
    this.opts.storage.session.setItem(this.keyName, key);
    this.opts.storage.local.setItem(this.keyName, key);
  }

  private clearSessionKey(): void {
    const old = this.opts.storage.session.getItem(this.keyName);
    this.opts.storage.session.removeItem(this.keyName);
    if (old !== null && this.opts.storage.local.getItem(this.keyName) === old) this.opts.storage.local.removeItem(this.keyName);
  }

  private handle(msg: HostToGuest): void {
    if (isAssetMessage(msg)) {
      const done = this.receiver.handle(msg);
      if (done) this.opts.assets.put(done);
      return;
    }
    switch (msg.type) {
      case 'welcome': {
        this.attempts = 0;
        this.seat = msg.you.seat;
        if (msg.you.seat !== null) {
          // localStorage の鍵で戻れたら、このタブの鍵として持つ。
          const key = this.opts.storage.session.getItem(this.keyName) ?? this.opts.storage.local.getItem(this.keyName);
          if (key) this.saveKey(key);
        } else if (this.sentSessionKey) {
          this.clearSessionKey();
        }
        this.setSeats(msg.seats, msg.assignmentPending);
        this.setStatus('connected');
        return;
      }
      case 'seated':
        this.seat = msg.seat;
        if (msg.seatKey) this.saveKey(msg.seatKey);
        else this.clearSessionKey();
        this.seatsEv.emit(this.seats, this.assignmentPending);
        return;
      case 'seats':
        return this.setSeats(msg.seats, msg.assignmentPending);
      case 'snapshot':
        this.view = msg.view;
        this.resyncPending = false;
        this.viewEv.emit(msg.view);
        return;
      case 'patch':
        if (this.resyncPending) return;
        if (!this.view || msg.baseRev !== this.view.rev) {
          // 抜けを検知した。全体を取り直す（KTD2）。
          this.resyncPending = true;
          this.send({ type: 'resync' });
          return;
        }
        this.view = applyPatch(this.view, msg.patch);
        this.viewEv.emit(this.view);
        return;
      case 'log':
        return this.logEv.emit(msg.text);
      case 'chat':
        return this.chatEv.emit(msg.from, msg.text);
      case 'drag':
        return this.dragEv.emit(msg.objId, msg.pos, msg.seat);
      case 'diceRoll':
        return this.diceEv.emit(msg.dieId, msg.keyframes);
      case 'error':
        if (msg.reason === 'replaced') return this.terminate('closed');
        return this.errorEv.emit(msg.reason, msg.cmdId);
      case 'roomFull':
        return this.terminate('full');
      case 'roomClosed':
        return this.terminate('closed');
      case 'ping':
        return;
    }
  }

  private setSeats(seats: SeatInfo[], pending: boolean): void {
    this.seats = seats;
    this.assignmentPending = pending;
    this.seatsEv.emit(seats, pending);
  }
}
