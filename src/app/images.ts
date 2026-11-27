// 画像のハッシュ → 表示用の画像。AssetStore のバイト列を一度だけデコードして持つ。
// デコードするのは描画側が get() で求めた画像だけ（使わない画像はデコードしない）。
import type { AssetStore } from '../assets/store';
import type { ImageSource } from '../render/textures';

export class ImageCache {
  private readonly decoded = new Map<string, ImageBitmap>();
  private readonly pending = new Set<string>();
  /** get() で求められたが、まだデコードできていない画像 */
  private readonly wanted = new Set<string>();
  /** デコードが終わり、次のフレームで貼り直してもらう画像 */
  private readonly ready = new Set<string>();
  private refreshQueued = false;
  private readonly unsub: () => void;

  constructor(
    private readonly assets: AssetStore,
    /** デコードが終わったら画像ごとに呼ぶ（描画側に貼り直させる） */
    private readonly onReady: (hash: string) => void,
  ) {
    // 参加者は画像が後から届くので、求められていた画像が届いたらすぐデコードする
    this.unsub = assets.onAdded((a) => {
      if (this.wanted.has(a.hash)) this.decode(a.hash);
    });
  }

  get = (hash: string): ImageSource | undefined => {
    const img = this.decoded.get(hash);
    if (img) return img;
    this.wanted.add(hash);
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
        this.wanted.delete(hash);
        this.queueRefresh(hash);
      })
      .catch((e: unknown) => console.error('画像をデコードできません', hash, e))
      .finally(() => this.pending.delete(hash));
  }

  private queueRefresh(hash: string): void {
    this.ready.add(hash);
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      const hashes = [...this.ready];
      this.ready.clear();
      for (const h of hashes) this.onReady(h);
    });
  }

  dispose(): void {
    this.unsub();
    for (const b of this.decoded.values()) b.close();
    this.decoded.clear();
    this.wanted.clear();
    this.ready.clear();
  }
}
