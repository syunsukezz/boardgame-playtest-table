// ドラッグ位置の間引き（KTD10）。ホストの中継と参加者の送信で同じ仕組みを使う。

/** ドラッグ位置を送る・中継する間隔（約20Hz, KTD10）。 */
export const DRAG_INTERVAL_MS = 50;

interface Slot<V> {
  last: number;
  pending: V | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * キー（物の ID）ごとの後縁つき間引き。
 * 間隔が空いていればすぐ送り、間隔内に来たものはまとめて、残りの時間が過ぎたら最後の値を送る。
 */
export class DragThrottle<V> {
  private readonly slots = new Map<string, Slot<V>>();

  constructor(
    private readonly emit: (key: string, value: V) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly intervalMs = DRAG_INTERVAL_MS,
  ) {}

  push(key: string, value: V): void {
    const now = this.now();
    this.sweep(now);
    let d = this.slots.get(key);
    if (!d) this.slots.set(key, (d = { last: -Infinity, pending: null, timer: null }));
    if (!d.timer && now - d.last >= this.intervalMs) {
      d.last = now;
      this.emit(key, value);
      return;
    }
    d.pending = value;
    if (d.timer) return;
    const dd = d;
    dd.timer = setTimeout(() => {
      dd.timer = null;
      const p = dd.pending;
      dd.pending = null;
      if (p === null) return;
      dd.last = this.now();
      this.emit(key, p);
    }, Math.max(0, this.intervalMs - (now - d.last)));
  }

  /** その物の、待っている送信を取りやめる（離した・落とした後に古い位置を送らないように）。 */
  cancel(key: string): void {
    const d = this.slots.get(key);
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    this.slots.delete(key);
  }

  /** 待っている送信をすべて取りやめる。 */
  dispose(): void {
    for (const d of this.slots.values()) if (d.timer) clearTimeout(d.timer);
    this.slots.clear();
  }

  /** タイマーも保留も無く、間隔も過ぎた項目は、無いのと同じなので消す。 */
  private sweep(now: number): void {
    for (const [k, d] of this.slots) {
      if (!d.timer && d.pending === null && now - d.last >= this.intervalMs) this.slots.delete(k);
    }
  }
}
