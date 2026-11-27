// 通信路の共通の型。PeerJS 版とテスト用のメモリ版を差し替えられるようにする。

/** 順序と再送が保証された1本の接続（KTD5）。 */
export interface Connection {
  id: string;
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface HostTransport {
  onConnection(cb: (c: Connection) => void): void;
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
