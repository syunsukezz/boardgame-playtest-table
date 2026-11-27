// 生存確認（KTD6）。2秒ごとに ping を送り、10秒何も受け取らなければ切断とみなす。

export const PING_INTERVAL_MS = 2000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;

/** テストで差し替えられる時計とタイマー。 */
export interface Clock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface HeartbeatOptions {
  sendPing: () => void;
  onTimeout: () => void;
  clock?: Clock;
  intervalMs?: number;
  timeoutMs?: number;
}

export class Heartbeat {
  private last: number;
  private handle: unknown = null;
  private readonly clock: Clock;

  constructor(private readonly opts: HeartbeatOptions) {
    this.clock = opts.clock ?? realClock;
    this.last = this.clock.now();
  }

  /** 相手から何か受け取ったら呼ぶ。 */
  touch(): void {
    this.last = this.clock.now();
  }

  start(): void {
    if (this.handle !== null) return;
    this.last = this.clock.now();
    this.handle = this.clock.setInterval(() => {
      if (this.clock.now() - this.last >= (this.opts.timeoutMs ?? HEARTBEAT_TIMEOUT_MS)) {
        this.stop();
        this.opts.onTimeout();
        return;
      }
      this.opts.sendPing();
    }, this.opts.intervalMs ?? PING_INTERVAL_MS);
  }

  stop(): void {
    if (this.handle === null) return;
    this.clock.clearInterval(this.handle);
    this.handle = null;
  }
}
