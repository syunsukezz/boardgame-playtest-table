// 画像の分割送信と受信、視点ごとに必要な画像の算出（KTD4）。
import type { View } from '../core/project';
import type { StoredAsset } from './store';

export const CHUNK_SIZE = 64 * 1024;

export type AssetMessage =
  | { type: 'asset-begin'; hash: string; mime: string; size: number; chunks: number }
  | { type: 'asset-chunk'; hash: string; index: number; data: Uint8Array }
  | { type: 'asset-end'; hash: string };

export function chunkAsset(asset: StoredAsset, chunkSize: number = CHUNK_SIZE): AssetMessage[] {
  const chunks = Math.ceil(asset.bytes.length / chunkSize);
  const msgs: AssetMessage[] = [
    { type: 'asset-begin', hash: asset.hash, mime: asset.mime, size: asset.bytes.length, chunks },
  ];
  for (let i = 0; i < chunks; i++) {
    msgs.push({ type: 'asset-chunk', hash: asset.hash, index: i, data: asset.bytes.slice(i * chunkSize, (i + 1) * chunkSize) });
  }
  msgs.push({ type: 'asset-end', hash: asset.hash });
  return msgs;
}

interface PartialAsset {
  mime: string;
  size: number;
  parts: Uint8Array[];
}

/** 順序保証のある接続前提（KTD5）。壊れ検知や再受信はしない。 */
export class AssetReceiver {
  private partials = new Map<string, PartialAsset>();

  /** asset-end で完成した画像を返す。それ以外は null。 */
  handle(msg: AssetMessage): StoredAsset | null {
    if (msg.type === 'asset-begin') {
      this.partials.set(msg.hash, { mime: msg.mime, size: msg.size, parts: [] });
      return null;
    }
    const p = this.partials.get(msg.hash);
    if (!p) return null;
    if (msg.type === 'asset-chunk') {
      // PeerJS のバイナリ送信は Uint8Array を ArrayBuffer にして届けるので、ここでそろえる。
      const data: unknown = msg.data;
      p.parts[msg.index] = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      return null;
    }
    this.partials.delete(msg.hash);
    const bytes = new Uint8Array(p.size);
    let off = 0;
    for (const part of p.parts) {
      bytes.set(part, off);
      off += part.length;
    }
    return { hash: msg.hash, mime: p.mime, bytes };
  }
}

/** この視点に必要な画像のハッシュ。見えない表は含めない。 */
export function neededAssetHashes(view: View): Set<string> {
  const set = new Set<string>();
  for (const c of Object.values(view.cards)) {
    set.add(c.backHash);
    if (c.face) set.add(c.face.faceHash);
  }
  for (const o of Object.values(view.objects)) {
    if (o.kind === 'stack') set.add(o.backHash);
    else if (o.kind === 'board') set.add(o.imageHash);
  }
  return set;
}

/** 相手ごとに送信済みのハッシュを覚え、二重送信を防ぐ。 */
export class AssetSendTracker {
  private sent = new Map<string, Set<string>>();

  missing(peerKey: string, needed: Set<string>): string[] {
    const s = this.sent.get(peerKey);
    return [...needed].filter((h) => !s?.has(h));
  }

  markSent(peerKey: string, hash: string): void {
    let s = this.sent.get(peerKey);
    if (!s) this.sent.set(peerKey, (s = new Set()));
    s.add(hash);
  }

  forget(peerKey: string): void {
    this.sent.delete(peerKey);
  }
}
