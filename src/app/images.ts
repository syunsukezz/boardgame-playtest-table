// 画像のハッシュ → 表示用の画像。AssetStore のバイト列を一度だけデコードして持つ。
import type { AssetStore } from '../assets/store';
import type { ImageSource } from '../render/textures';

export class ImageCache {
  private readonly decoded = new Map<string, ImageBitmap>();
  private readonly pending = new Set<string>();
  private refreshQueued = false;
  private readonly unsub: () => void;

  constructor(
    private readonly assets: AssetStore,
    /** デコードが終わったら呼ぶ（描画側に貼り直させる） */
    private readonly onReady: () => void,
  ) {
    // 参加者は画像が後から届くので、届いたらすぐデコードする
    this.unsub = assets.onAdded((a) => this.decode(a.hash));
  }

  get = (hash: string): ImageSource | undefined => {
    const img = this.decoded.get(hash);
    if (img) return img;
    this.decode(hash);
    return undefined;
  };

  private decode(hash: string): void {
    if (this.decoded.has(hash) || this.pending.has(hash)) return;
    const a = this.assets.get(hash);
    if (!a) return;
    this.pending.add(hash);
    createImageBitmap(new Blob([a.bytes as Uint8Array<ArrayBuffer>], { type: a.mime }))
      .then((bmp) => {
        this.decoded.set(hash, bmp);
        this.queueRefresh();
      })
      .catch((e: unknown) => console.error('画像をデコードできません', hash, e))
      .finally(() => this.pending.delete(hash));
  }

  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.onReady();
    });
  }

  dispose(): void {
    this.unsub();
    for (const b of this.decoded.values()) b.close();
    this.decoded.clear();
  }
}
