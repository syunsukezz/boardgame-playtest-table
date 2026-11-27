// 通信路の共通の型。PeerJS 版とテスト用のメモリ版を差し替えられるようにする。

/** 順序と再送が保証された1本の接続（KTD5）。 */
export interface Connection {
  id: string;
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** 仲介サーバー（シグナリング）とのつながり。lost の間は新しい参加者・再接続が入れない。 */
export type SignalingStatus = 'ok' | 'lost';

export interface HostTransport {
  onConnection(cb: (c: Connection) => void): void;
  /** 仲介サーバーとのつながりの変化。対応しない通信路（テスト用など）は省いてよい。購読解除の関数を返す。 */
  onSignalingStatus?(cb: (s: SignalingStatus) => void): () => void;
  close(): void;
}

export interface GuestTransport {
  connect(): Promise<Connection>;
}

/** 部屋につながらないときの原因の候補（R28）。 */
export type ConnectionFailure =
  | 'room-not-found'
  | 'signaling-unavailable'
  | 'network-blocked'
  | 'unsupported-browser'
  | 'unknown';

export class ConnectionError extends Error {
  constructor(readonly reason: ConnectionFailure, message: string = reason) {
    super(message);
  }
}
