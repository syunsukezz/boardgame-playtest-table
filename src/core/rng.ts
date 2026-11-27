// 乱数。ホストは crypto から、テストは初期値を固定した擬似乱数から作る。

export interface Rng {
  /** [0, 1) の一様乱数。 */
  next(): number;
}

/** 初期値から決まる擬似乱数（mulberry32）。テストで結果を固定するために使う。 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** ホスト用。crypto.getRandomValues を使う。 */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(1);
  return {
    next() {
      crypto.getRandomValues(buf);
      return buf[0]! / 4294967296;
    },
  };
}

export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng.next() * maxExclusive);
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 中身を表さないランダムな ID（KTD3）。 */
export function randomId(rng: Rng, length = 12): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ID_CHARS[randomInt(rng, ID_CHARS.length)];
  return s;
}

/** Fisher–Yates。配列をその場で並べ替える。 */
export function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}
