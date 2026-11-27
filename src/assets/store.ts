// 取り込み済み・受信済みの画像をメモリに持つ。
export interface StoredAsset {
  hash: string;
  mime: string;
  bytes: Uint8Array;
}

export class AssetStore {
  private map = new Map<string, StoredAsset>();
  private listeners = new Set<(a: StoredAsset) => void>();

  /** 既にあるハッシュは何もしない（再通知もしない）。 */
  put(a: StoredAsset): void {
    if (this.map.has(a.hash)) return;
    this.map.set(a.hash, a);
    for (const cb of this.listeners) cb(a);
  }

  get(hash: string): StoredAsset | undefined {
    return this.map.get(hash);
  }

  has(hash: string): boolean {
    return this.map.has(hash);
  }

  all(): StoredAsset[] {
    return [...this.map.values()];
  }

  onAdded(cb: (a: StoredAsset) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
