// テスト用のメモリ上の通信路。非同期に届け、structuredClone で直列化をまねる。
import { ConnectionError, type Connection, type GuestTransport, type HostTransport } from './transport';

class MemoryEnd implements Connection {
  peer!: MemoryEnd;
  private msgCbs: ((m: unknown) => void)[] = [];
  private closeCbs: (() => void)[] = [];
  closed = false;
  /** true の間は送ったものが消える（無言の切断）。 */
  stalled = false;
  /** この端が受け取ったメッセージの記録（テストで中身を調べる）。 */
  readonly received: unknown[] = [];

  constructor(readonly id: string) {}

  send(msg: unknown): void {
    if (this.closed || this.stalled) return;
    const copy = structuredClone(msg);
    const to = this.peer;
    queueMicrotask(() => {
      if (to.closed || this.stalled) return;
      to.received.push(copy);
      for (const cb of to.msgCbs) cb(copy);
    });
  }

  onMessage(cb: (msg: unknown) => void): void {
    this.msgCbs.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fireClose();
    const p = this.peer;
    queueMicrotask(() => {
      if (p.closed) return;
      p.closed = true;
      p.fireClose();
    });
  }

  private fireClose(): void {
    for (const cb of this.closeCbs) cb();
  }
}

export interface MemoryLink {
  hostSide: Connection & { received: unknown[] };
  guestSide: Connection & { received: unknown[] };
  /** 接続が切れる（両側に close が届く）。 */
  drop(): void;
  /** 何も届かなくなるが close は届かない（生存確認の確認用）。 */
  stall(): void;
}

export interface MemoryNetwork {
  host: HostTransport;
  /** 新しい参加者の通信路。connect のたびに links に1本増える。 */
  guestTransport(): GuestTransport;
  links: MemoryLink[];
}

export function createMemoryNetwork(): MemoryNetwork {
  let onConn: ((c: Connection) => void) | null = null;
  let hostClosed = false;
  let n = 0;
  const links: MemoryLink[] = [];

  const host: HostTransport = {
    onConnection(cb) {
      onConn = cb;
    },
    close() {
      hostClosed = true;
      for (const l of links) l.hostSide.close();
    },
  };

  function guestTransport(): GuestTransport {
    return {
      connect() {
        if (hostClosed || !onConn) return Promise.reject(new ConnectionError('room-not-found'));
        const id = `mem-${++n}`;
        const h = new MemoryEnd(id);
        const g = new MemoryEnd(id);
        h.peer = g;
        g.peer = h;
        links.push({
          hostSide: h,
          guestSide: g,
          drop: () => g.close(),
          stall: () => {
            h.stalled = true;
            g.stalled = true;
          },
        });
        const cb = onConn;
        return new Promise((resolve) => {
          queueMicrotask(() => {
            cb(h);
            resolve(g);
          });
        });
      },
    };
  }

  return { host, guestTransport, links };
}
