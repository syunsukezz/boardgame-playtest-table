// ホスト側のセッション。卓の完全な状態を持ち、参加者ごとに切り出して送る（KTD2, KTD3, KTD4）。
import { apply } from '../core/apply';
import type { Command, CommandBody, LogEvent, RollOutcome } from '../core/commands';
import { diffViews, isEmptyPatch } from '../core/diff';
import { formatLog, type SeatName } from '../core/log';
import { project, type View, type Viewer } from '../core/project';
import { cryptoRng, randomId, randomInt, type Rng } from '../core/rng';
import { emptyState, seatLabel, type ObjectId, type SeatId, type TableState, type Vec3 } from '../core/state';
import { parseVec3, validateCommandBody } from '../core/validate-command';
import type { AssetStore } from '../assets/store';
import { AssetSendTracker, chunkAsset, neededAssetHashes } from '../assets/transfer';
import { sanitizeChat } from './chat';
import { DragThrottle } from './drag-throttle';
import { Heartbeat, realClock, type Clock } from './heartbeat';
import { Emitter, hasType, type GuestCommand, type GuestToHost, type HostToGuest } from './protocol';
import { HOST_SEAT, SeatManager, type SeatInfo } from './seats';
import type { Connection, HostTransport } from './transport';

export { DRAG_INTERVAL_MS } from './drag-throttle';
/** つかんだまま無通信でつかみを解くまで（KTD10）。 */
export const GRAB_TIMEOUT_MS = 5000;
/** roomFull などを送ってから接続を閉じるまでの猶予（送信前に閉じないように）。 */
const CLOSE_DELAY_MS = 500;
const NAME_MAX = 40;

export interface HostSessionOptions {
  transport: HostTransport;
  assets: AssetStore;
  rng?: Rng;
  /** ホスト（席0）の表示名。既定の seatName が使う。省くと「ホスト」。 */
  hostName?: string;
  seatName?: SeatName;
  rollDice?: (dieId: string) => RollOutcome;
  clock?: Clock;
}

export interface Participant {
  connId: string;
  name: string;
  seat: SeatId | null;
}

interface PeerState {
  conn: Connection;
  name: string;
  joined: boolean;
  lastView: View | null;
  heartbeat: Heartbeat;
}

/** 中継待ちのドラッグ位置。from は送り主の接続 ID（ホスト自身は 'host'）。 */
interface PendingDrag {
  pos: Vec3;
  seat: SeatId;
  from: string;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

export class HostSession {
  private state: TableState = emptyState();
  private readonly seats = new SeatManager();
  private readonly peers = new Map<string, PeerState>();
  private readonly tracker = new AssetSendTracker();
  private readonly rng: Rng;
  private readonly clock: Clock;
  private readonly seatName: SeatName;
  private readonly rollDice: (dieId: string) => RollOutcome;
  private activeSeat: SeatId = HOST_SEAT;
  private readonly grabTouched = new Map<ObjectId, number>();
  private readonly drags = new DragThrottle<PendingDrag>(
    (objId, d) => this.emitDrag(objId, d.pos, d.seat, d.from),
    () => this.clock.now(),
  );
  private readonly grabTimer: unknown;
  private readonly unsubAssets: () => void;
  private closed = false;

  private readonly viewEv = new Emitter<[View, SeatId]>();
  private readonly logEv = new Emitter<[string]>();
  private readonly chatEv = new Emitter<[string, string]>();
  private readonly seatsEv = new Emitter<[SeatInfo[], boolean]>();
  private readonly noticeEv = new Emitter<[string]>();
  private readonly dragEv = new Emitter<[ObjectId, Vec3, SeatId]>();
  private readonly diceEv = new Emitter<[ObjectId, number[]]>();
  private readonly cmdErrorEv = new Emitter<[string]>();

  constructor(private readonly opts: HostSessionOptions) {
    this.rng = opts.rng ?? cryptoRng();
    this.clock = opts.clock ?? realClock;
    this.seatName =
      opts.seatName ??
      ((seat) => (seat === HOST_SEAT ? (opts.hostName ?? 'ホスト') : (this.seats.nameOf(seat) ?? seatLabel(seat))));
    this.rollDice = opts.rollDice ?? (() => ({ value: 1 + randomInt(this.rng, 6) }));
    opts.transport.onConnection((c) => this.handleConnection(c));
    this.unsubAssets = opts.assets.onAdded(() => {
      for (const p of this.joinedPeers()) this.sendAssets(p);
    });
    this.grabTimer = this.clock.setInterval(() => this.checkGrabs(), 1000);
  }

  // ---- イベント ----
  onView(cb: (view: View, viewerSeat: SeatId) => void): () => void {
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
  onNotice(cb: (text: string) => void): () => void {
    return this.noticeEv.on(cb);
  }
  onDiceRoll(cb: (dieId: ObjectId, keyframes: number[]) => void): () => void {
    return this.diceEv.on(cb);
  }
  onRemoteDrag(cb: (objId: ObjectId, pos: Vec3, seat: SeatId) => void): () => void {
    return this.dragEv.on(cb);
  }
  onCommandError(cb: (reason: string) => void): () => void {
    return this.cmdErrorEv.on(cb);
  }

  // ---- 参照 ----
  getState(): TableState {
    return this.state;
  }
  getSeats(): SeatInfo[] {
    return this.seats.list();
  }
  getActiveSeat(): SeatId {
    return this.activeSeat;
  }
  isAssignmentPending(): boolean {
    return this.seats.assignmentPending;
  }
  /** 接続中の参加者（割り当て UI 用）。 */
  getParticipants(): Participant[] {
    return [...this.joinedPeers()].map((p) => ({ connId: p.conn.id, name: p.name, seat: this.seats.seatOf(p.conn.id) }));
  }

  // ---- ホストの操作 ----
  /** ホストの操作。既定では操作中の席（自席か兼任中の席）として行う（R14）。 */
  submit(body: CommandBody, asSeat?: SeatId): SubmitResult {
    const seat = asSeat ?? this.activeSeat;
    if (!this.hostControls(seat)) {
      this.cmdErrorEv.emit('not-your-seat');
      return { ok: false, error: 'not-your-seat' };
    }
    const r = this.applyCommand({ ...body, seat, cmdId: this.hostCmdId() } as Command);
    if (!r.ok) {
      this.cmdErrorEv.emit(r.error);
      return r;
    }
    return { ok: true };
  }

  /** ホスト自身のドラッグ位置を参加者へ中継する（KTD10）。ログにも rev にも入らない。 */
  drag(objId: ObjectId, pos: Vec3): void {
    this.relayDrag(objId, pos, this.activeSeat, 'host');
  }

  /** ホストの視点を切り替える。自席か兼任中の席だけ。 */
  setActiveSeat(seat: SeatId): boolean {
    if (!this.hostControls(seat)) return false;
    this.activeSeat = seat;
    this.emitHostView();
    return true;
  }

  hostSeat(seat: SeatId): boolean {
    if (!this.seats.hostSeat(seat)) return false;
    this.broadcastSeats();
    return true;
  }

  unhostSeat(seat: SeatId): boolean {
    if (!this.seats.unhostSeat(seat)) return false;
    this.revertActiveSeatIf(seat, `${this.seatName(seat)}の兼任を外しました`);
    this.broadcastSeats();
    return true;
  }

  /** 切断中・着席中の席を空席に戻す。手札は残る（R20）。 */
  freeSeat(seat: SeatId): boolean {
    const wasOccupied = this.seats.status(seat) === 'occupied';
    const r = this.seats.freeSeat(seat);
    if (!r.ok) return false;
    if (wasOccupied) this.releaseGrabs(seat);
    const peer = r.connId !== undefined ? this.peers.get(r.connId) : undefined;
    if (peer) {
      this.send(peer, { type: 'seated', seat: null, seatKey: null });
      this.sendView(peer);
      this.sendAssets(peer);
    }
    this.broadcastSeats();
    return true;
  }

  /** ホストが参加者を席に割り当てる（読み込み後など, R21）。新しい席の鍵を発行する。 */
  assign(connId: string, seat: SeatId): boolean {
    const peer = this.peers.get(connId);
    if (!peer?.joined) return false;
    const wasHosted = this.seats.status(seat) === 'hosted';
    const key = this.seats.assign(connId, seat, peer.name);
    if (key === null) return false;
    if (wasHosted) this.onHostedSeatTaken(seat, peer.name);
    this.seatPeer(peer, seat, key);
    return true;
  }

  finishAssignment(): void {
    this.seats.finishAssignment();
    this.broadcastSeats();
  }

  /** 保存の読み込み。全員を未着席に戻し、割り当て待ちにする（R21）。 */
  loadState(state: TableState): void {
    this.state = structuredClone(state);
    this.seats.resetForLoad();
    this.activeSeat = HOST_SEAT;
    this.grabTouched.clear();
    this.syncGrabTimes();
    for (const p of this.joinedPeers()) {
      this.send(p, { type: 'seated', seat: null, seatKey: null });
      p.lastView = null;
      this.sendView(p);
      this.sendAssets(p);
    }
    this.broadcastSeats();
    this.emitHostView();
  }

  chat(text: string): void {
    const t = sanitizeChat(text);
    if (t === null) return;
    this.broadcastChat(this.seatName(HOST_SEAT), t);
  }

  /** 部屋を閉じる（R12: ホストが抜けると部屋は終わる）。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of [...this.peers.values()]) {
      this.send(p, { type: 'roomClosed' });
      p.heartbeat.stop();
      p.conn.close();
    }
    this.peers.clear();
    this.drags.dispose();
    this.clock.clearInterval(this.grabTimer);
    this.unsubAssets();
    this.opts.transport.close();
  }

  // ---- 接続 ----
  private handleConnection(conn: Connection): void {
    if (this.closed) {
      conn.close();
      return;
    }
    const peer: PeerState = {
      conn,
      name: '参加者',
      joined: false,
      lastView: null,
      heartbeat: new Heartbeat({
        clock: this.clock,
        sendPing: () => conn.send({ type: 'ping' } satisfies HostToGuest),
        onTimeout: () => {
          this.handleClose(conn.id);
          conn.close();
        },
      }),
    };
    this.peers.set(conn.id, peer);
    conn.onMessage((m) => {
      if (this.peers.get(conn.id) !== peer) return;
      peer.heartbeat.touch();
      if (!hasType(m)) return;
      // 1つの壊れたメッセージで PeerJS の受信処理ごと止まらないよう、ここで受け止める。
      try {
        this.handleMessage(peer, m as GuestToHost);
      } catch (e) {
        console.error('参加者のメッセージの処理に失敗しました', e);
        if (this.peers.get(conn.id) === peer) this.send(peer, { type: 'error', reason: 'invalid-args' });
      }
    });
    conn.onClose(() => this.handleClose(conn.id));
    peer.heartbeat.start();
  }

  private handleClose(connId: string): void {
    const peer = this.peers.get(connId);
    if (!peer) return;
    this.removePeer(peer);
    const seat = this.seats.markDisconnected(connId);
    if (seat !== null) {
      this.releaseGrabs(seat);
      this.broadcastSeats();
    }
  }

  private removePeer(peer: PeerState): void {
    this.peers.delete(peer.conn.id);
    peer.heartbeat.stop();
    this.tracker.forget(peer.conn.id);
  }

  /** 何かを送ってから少し待って閉じる。以後このピアには送らない。 */
  private dismiss(peer: PeerState, msg: HostToGuest): void {
    this.send(peer, msg);
    this.removePeer(peer);
    setTimeout(() => peer.conn.close(), CLOSE_DELAY_MS);
  }

  private handleMessage(peer: PeerState, msg: GuestToHost): void {
    if (msg.type === 'hello') return this.handleHello(peer, msg);
    if (!peer.joined) return;
    const seat = this.seats.seatOf(peer.conn.id);
    switch (msg.type) {
      case 'sit':
        return this.handleSit(peer, msg.seat);
      case 'command':
        return this.handleCommand(peer, seat, msg.cmd);
      case 'drag': {
        const pos = parseVec3(msg.pos);
        if (seat === null || typeof msg.objId !== 'string' || !pos || this.state.heldBy[msg.objId] !== seat) return;
        this.grabTouched.set(msg.objId, this.clock.now());
        return this.relayDrag(msg.objId, pos, seat, peer.conn.id);
      }
      case 'chat': {
        const t = sanitizeChat(msg.text);
        if (t !== null) this.broadcastChat(peer.name, t);
        return;
      }
      case 'resync':
        peer.lastView = null;
        this.sendView(peer);
        return;
      case 'ping':
        return;
    }
  }

  private handleHello(peer: PeerState, msg: Extract<GuestToHost, { type: 'hello' }>): void {
    if (peer.joined) return;
    peer.name = cleanName(msg.name);
    let seat: SeatId | null = null;
    if (typeof msg.seatKey === 'string') {
      const r = this.seats.rejoin(peer.conn.id, msg.seatKey, { fromLocal: msg.fromLocal === true });
      if (r) {
        seat = r.seat;
        peer.name = this.seats.nameOf(seat) ?? peer.name;
        const old = r.replacedConnId !== undefined ? this.peers.get(r.replacedConnId) : undefined;
        if (old) this.dismiss(old, { type: 'error', reason: 'replaced' });
      }
    }
    if (seat === null) {
      const unseated = [...this.joinedPeers()].filter((p) => this.seats.seatOf(p.conn.id) === null).length;
      if (unseated >= this.seats.freeCount()) {
        this.dismiss(peer, { type: 'roomFull' });
        return;
      }
    }
    peer.joined = true;
    this.send(peer, {
      type: 'welcome',
      seats: this.seats.list(),
      you: { seat },
      assignmentPending: this.seats.assignmentPending,
    });
    this.sendView(peer);
    this.sendAssets(peer);
    this.broadcastSeats();
  }

  private handleSit(peer: PeerState, seat: SeatId): void {
    const wasHosted = this.seats.status(seat) === 'hosted';
    const r = this.seats.sit(peer.conn.id, seat, peer.name);
    if (!r.ok) {
      this.send(peer, { type: 'error', reason: r.reason });
      return;
    }
    if (wasHosted) this.onHostedSeatTaken(seat, peer.name);
    this.seatPeer(peer, seat, r.seatKey);
  }

  private seatPeer(peer: PeerState, seat: SeatId, seatKey: string): void {
    this.send(peer, { type: 'seated', seat, seatKey });
    this.sendView(peer);
    this.sendAssets(peer);
    this.broadcastSeats();
  }

  /** 兼任中の席に参加者が座った（AE9）。ホストの操作中の席を自席に戻して知らせる。 */
  private onHostedSeatTaken(seat: SeatId, name: string): void {
    const text = `${name}が${this.seatName(seat)}に座ったため、兼任を外しました`;
    if (!this.revertActiveSeatIf(seat, text)) this.noticeEv.emit(text);
  }

  private revertActiveSeatIf(seat: SeatId, notice: string): boolean {
    if (this.activeSeat !== seat) return false;
    this.activeSeat = HOST_SEAT;
    this.noticeEv.emit(notice);
    this.emitHostView();
    return true;
  }

  private handleCommand(peer: PeerState, seat: SeatId | null, raw: GuestCommand): void {
    const cmdId = typeof raw?.cmdId === 'string' ? raw.cmdId : undefined;
    if (seat === null) {
      this.send(peer, { type: 'error', ...(cmdId !== undefined ? { cmdId } : {}), reason: 'not-seated' });
      return;
    }
    const body = validateCommandBody(raw);
    if (!body || cmdId === undefined) {
      this.send(peer, { type: 'error', ...(cmdId !== undefined ? { cmdId } : {}), reason: 'invalid-args' });
      return;
    }
    for (const id of referencedIds(body)) if (this.state.heldBy[id] === seat) this.grabTouched.set(id, this.clock.now());
    // 席は接続から埋める。参加者が送った seat は使わない。
    const r = this.applyCommand({ ...body, seat, cmdId } as Command);
    if (!r.ok) this.send(peer, { type: 'error', cmdId, reason: r.error });
  }

  // ---- 適用と配信 ----
  private applyCommand(cmd: Command): SubmitResult {
    if (cmd.type === 'roll') {
      // 出目はホストが決める（KTD7）。参加者の値は捨てる。
      cmd = { ...cmd, outcome: this.rollDice(cmd.dieId) };
    }
    const r = apply(this.state, cmd, this.rng);
    if (!r.ok) return r;
    const prevHeld = this.state.heldBy;
    this.state = r.state;
    this.syncGrabTimes();
    // つかみが解けた・持ち主が変わった物の、中継待ちのドラッグを取りやめる。
    for (const [id, s] of Object.entries(prevHeld)) if (this.state.heldBy[id] !== s) this.drags.cancel(id);
    // 転がる動きを先に送り、出目の反映（View）が後から届くようにする。
    const keyframes = cmd.type === 'roll' ? cmd.outcome?.keyframes : undefined;
    if (cmd.type === 'roll' && keyframes) {
      for (const p of this.joinedPeers()) this.send(p, { type: 'diceRoll', dieId: cmd.dieId, keyframes });
      this.diceEv.emit(cmd.dieId, keyframes);
    }
    this.broadcast(r.log);
    return { ok: true };
  }

  private broadcast(log: LogEvent[]): void {
    for (const p of this.joinedPeers()) {
      const view = this.sendView(p);
      for (const ev of log) this.send(p, { type: 'log', text: formatLog(ev, view, this.seatName) });
      this.sendAssets(p);
    }
    const hostView = this.emitHostView();
    for (const ev of log) this.logEv.emit(formatLog(ev, hostView, this.seatName));
  }

  /** そのピアの切り出しを送る。前回送った View があれば差分、無ければ全体。 */
  private sendView(peer: PeerState): View {
    const view = project(this.state, this.viewerOf(peer));
    const prev = peer.lastView;
    if (!prev) {
      this.send(peer, { type: 'snapshot', view });
      peer.lastView = view;
      return view;
    }
    const patch = diffViews(prev, view);
    // 変化が無ければ送らず、前回の View を基準のまま残す（baseRev がずれないように）。
    if (isEmptyPatch(patch, prev)) return view;
    this.send(peer, { type: 'patch', patch, baseRev: prev.rev });
    peer.lastView = view;
    return view;
  }

  /** 見えるようになった画像のうち、まだ送っていないものを送る（KTD4）。 */
  private sendAssets(peer: PeerState): void {
    if (!peer.lastView) return;
    const id = peer.conn.id;
    for (const hash of this.tracker.missing(id, neededAssetHashes(peer.lastView))) {
      const asset = this.opts.assets.get(hash);
      if (!asset) continue;
      for (const m of chunkAsset(asset)) this.send(peer, m);
      this.tracker.markSent(id, hash);
    }
  }

  private viewerOf(peer: PeerState): Viewer {
    const seat = this.seats.seatOf(peer.conn.id);
    return seat === null ? { kind: 'spectator' } : { kind: 'seat', seat };
  }

  private emitHostView(): View {
    const view = project(this.state, { kind: 'seat', seat: this.activeSeat });
    this.viewEv.emit(view, this.activeSeat);
    return view;
  }

  private broadcastSeats(): void {
    const seats = this.seats.list();
    const pending = this.seats.assignmentPending;
    for (const p of this.joinedPeers()) this.send(p, { type: 'seats', seats, assignmentPending: pending });
    this.seatsEv.emit(seats, pending);
  }

  private broadcastChat(from: string, text: string): void {
    for (const p of this.joinedPeers()) this.send(p, { type: 'chat', from, text });
    this.chatEv.emit(from, text);
  }

  /** 参加済み（hello を受け付けた）のピア。peers をその場でたどる。 */
  private *joinedPeers(): Generator<PeerState> {
    for (const p of this.peers.values()) if (p.joined) yield p;
  }

  private send(peer: PeerState, msg: HostToGuest): void {
    peer.conn.send(msg);
  }

  private hostControls(seat: SeatId): boolean {
    return seat === HOST_SEAT || this.seats.status(seat) === 'hosted';
  }

  // ---- ドラッグとつかみ（KTD10） ----
  private relayDrag(objId: ObjectId, pos: Vec3, seat: SeatId, from: string): void {
    this.drags.push(objId, { pos, seat, from });
  }

  private emitDrag(objId: ObjectId, pos: Vec3, seat: SeatId, from: string): void {
    // 離した後に後縁の中継が出ると、ほかの画面で物が浮いたまま残る。つかんでいる席の分だけ送る。
    if (this.state.heldBy[objId] !== seat) return;
    for (const p of this.joinedPeers()) if (p.conn.id !== from) this.send(p, { type: 'drag', objId, pos, seat });
    // ホスト自身のドラッグはホストの画面へ返さない。
    if (from !== 'host') this.dragEv.emit(objId, pos, seat);
  }

  /** heldBy と最終操作時刻の表を合わせる。 */
  private syncGrabTimes(): void {
    const now = this.clock.now();
    for (const id of Object.keys(this.state.heldBy)) if (!this.grabTouched.has(id)) this.grabTouched.set(id, now);
    for (const id of [...this.grabTouched.keys()]) if (this.state.heldBy[id] === undefined) this.grabTouched.delete(id);
  }

  /** 参加者のつかみで5秒操作が無いものを解く。ホストが操作する席のつかみは対象外。 */
  private checkGrabs(): void {
    const now = this.clock.now();
    for (const [id, t] of [...this.grabTouched]) {
      const seat = this.state.heldBy[id];
      if (seat === undefined || this.hostControls(seat)) continue;
      if (now - t >= GRAB_TIMEOUT_MS) this.releaseAs(id, seat);
    }
  }

  private releaseGrabs(seat: SeatId): void {
    for (const [id, s] of Object.entries(this.state.heldBy)) if (s === seat) this.releaseAs(id, seat);
  }

  private releaseAs(objId: ObjectId, seat: SeatId): void {
    this.applyCommand({ type: 'release', objId, seat, cmdId: this.hostCmdId() });
  }

  /** ホストが出す操作の ID。 */
  private hostCmdId(): string {
    return `h-${randomId(this.rng)}`;
  }
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') return '参加者';
  const t = [...name.trim()].slice(0, NAME_MAX).join('');
  return t || '参加者';
}

/** 操作が触れる物の ID（つかみの最終操作時刻の更新用）。 */
function referencedIds(cmd: CommandBody): string[] {
  const ids: string[] = [];
  for (const k of ['objId', 'cardId', 'stackId', 'dieId', 'targetId']) {
    const v = (cmd as Record<string, unknown>)[k];
    if (typeof v === 'string') ids.push(v);
  }
  return ids;
}
