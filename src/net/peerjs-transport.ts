// PeerJS 1.5.5 による通信路（KTD5）。接続は必ず reliable（順序と再送を保証）にする。
// PeerJS の既定は順序を保証しないので、操作と画像が入れ替わらないよう明示する。
import { Peer, type DataConnection, type PeerError, type PeerOptions } from 'peerjs';
import { randomBase32 } from './random';
import {
  ConnectionError,
  type Connection,
  type ConnectionFailure,
  type GuestTransport,
  type HostTransport,
  type SignalingStatus,
} from './transport';

const CONNECT_OPTIONS = { reliable: true, serialization: 'binary' } as const;
/** 相手につながるまでの上限。超えたら回線の制限を疑う（R28）。 */
const CONNECT_TIMEOUT_MS = 15_000;
/** 部屋を立てるとき、仲介サーバーに登録できるまでの上限。 */
const HOST_OPEN_TIMEOUT_MS = 15_000;
/** 仲介サーバーから切れたときの再接続の間隔。尽きたら最後の値で繰り返す。 */
export const SIGNALING_RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000];

export interface PeerTransportOptions {
  /** STUN/TURN の設定。差し替えられるようにしておく（KTD5）。 */
  iceServers?: RTCIceServer[];
}

/** 部屋 ID: `tt-` + ランダムな base32 8文字。 */
export function createRoomId(): string {
  return `tt-${randomBase32(8)}`;
}

/** PeerJS のエラー種別を、画面に出す原因の候補に変換する（R28）。 */
export function mapPeerError(type: string): ConnectionFailure {
  switch (type) {
    case 'peer-unavailable':
      return 'room-not-found';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'ssl-unavailable':
    case 'unavailable-id':
      return 'signaling-unavailable';
    case 'webrtc':
    case 'negotiation-failed':
      return 'network-blocked';
    case 'browser-incompatible':
      return 'unsupported-browser';
    default:
      return 'unknown';
  }
}

function peerOptions(opts: PeerTransportOptions): PeerOptions {
  return opts.iceServers ? { config: { iceServers: opts.iceServers } } : {};
}

function wrap(dc: DataConnection): Connection {
  return {
    id: dc.connectionId,
    send: (msg) => {
      if (dc.open) void dc.send(msg);
    },
    onMessage: (cb) => {
      dc.on('data', cb);
    },
    onClose: (cb) => {
      dc.on('close', cb);
    },
    close: () => dc.close(),
  };
}

export interface PeerHostTransport extends HostTransport {
  roomId: string;
}

/** 再接続の何回目（0始まり）の待ち時間。 */
export function signalingRetryDelay(attempt: number): number {
  return SIGNALING_RETRY_DELAYS_MS[Math.min(attempt, SIGNALING_RETRY_DELAYS_MS.length - 1)]!;
}

/**
 * 部屋を立てる。シグナリングサーバーに登録できたら resolve する。
 * 登録後に仲介サーバーから切れたら、間隔を空けながら再接続し続ける（部屋の ID はそのまま）。
 * 既に開いている参加者との接続は、仲介サーバーが切れても続く。
 */
export function createPeerHost(opts: PeerTransportOptions = {}, roomId: string = createRoomId()): Promise<PeerHostTransport> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(roomId, peerOptions(opts));
    let cb: ((c: Connection) => void) | null = null;
    let opened = false;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let status: SignalingStatus = 'ok';
    const statusCbs = new Set<(s: SignalingStatus) => void>();
    const setStatus = (s: SignalingStatus): void => {
      if (s === status) return;
      status = s;
      for (const f of statusCbs) f(s);
    };
    const destroy = (): void => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      peer.destroy();
    };
    const openTimer = setTimeout(() => {
      if (opened) return;
      destroy();
      reject(new ConnectionError('signaling-unavailable', 'signaling timeout'));
    }, HOST_OPEN_TIMEOUT_MS);
    const scheduleReconnect = (): void => {
      if (closed || retryTimer || peer.destroyed) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (closed || peer.destroyed || !peer.disconnected) return;
        attempt++;
        try {
          peer.reconnect();
        } catch (e) {
          console.warn('仲介サーバーへの再接続に失敗しました', e);
          scheduleReconnect();
        }
      }, signalingRetryDelay(attempt));
    };

    peer.on('connection', (dc) => {
      // 送っても届かないので、開いてから渡す。
      dc.on('open', () => cb?.(wrap(dc)));
    });
    peer.on('error', (err: PeerError<string>) => {
      if (!opened) {
        clearTimeout(openTimer);
        destroy();
        reject(new ConnectionError(mapPeerError(err.type), err.message));
        return;
      }
      // 再接続の失敗（server-error など）でも切れたままなら、次の再接続を予約する。
      if (peer.disconnected) scheduleReconnect();
    });
    peer.on('disconnected', () => {
      if (!opened || closed || peer.destroyed) return;
      setStatus('lost');
      scheduleReconnect();
    });
    peer.on('open', () => {
      if (opened) {
        // 再接続できた
        attempt = 0;
        setStatus('ok');
        return;
      }
      opened = true;
      clearTimeout(openTimer);
      resolve({
        roomId,
        onConnection: (c) => {
          cb = c;
        },
        onSignalingStatus: (f) => {
          statusCbs.add(f);
          return () => {
            statusCbs.delete(f);
          };
        },
        close: destroy,
      });
    });
  });
}

/** 部屋に入る側。connect のたびに新しい Peer（ID は毎回変わってよい, KTD6）を作る。 */
export function createPeerGuest(roomId: string, opts: PeerTransportOptions = {}): GuestTransport {
  return {
    connect() {
      return new Promise<Connection>((resolve, reject) => {
        const peer = new Peer(peerOptions(opts));
        let settled = false;
        const fail = (reason: ConnectionFailure, message?: string): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          peer.destroy();
          reject(new ConnectionError(reason, message));
        };
        const timer = setTimeout(() => fail('network-blocked', 'connect timeout'), CONNECT_TIMEOUT_MS);
        peer.on('error', (err: PeerError<string>) => fail(mapPeerError(err.type), err.message));
        peer.on('open', () => {
          const dc = peer.connect(roomId, CONNECT_OPTIONS);
          dc.on('iceStateChanged', (s) => {
            if (s === 'failed') fail('network-blocked', 'ice failed');
          });
          dc.on('error', (err) => fail(mapPeerError(err.type), err.message));
          dc.on('open', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const conn = wrap(dc);
            // 接続が閉じたら、この参加者用の Peer も片づける。
            dc.on('close', () => peer.destroy());
            resolve(conn);
          });
        });
      });
    },
  };
}
