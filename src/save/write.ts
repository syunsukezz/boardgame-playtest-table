// 卓の全状態と画像を1つの zip に書き出す（R18, KTD8）。
// state.json には隠れた情報もすべて入る。席の鍵は入れない（席は TableState の外にある）。
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { StoredAsset } from '../assets/store';
import type { TableState } from '../core/state';

export const FORMAT_VERSION = 1;

export interface Manifest {
  formatVersion: number;
  createdAt: string;
}

/** 画像の MIME と保存ファイル内の拡張子の対応。read.ts の読み取りもこの表から作る。 */
export const ASSET_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export function assetPath(a: { hash: string; mime: string }): string {
  return `assets/${a.hash}.${ASSET_EXTENSIONS[a.mime] ?? 'bin'}`;
}

export function writeSave(state: TableState, assets: StoredAsset[]): Uint8Array {
  // すぐ JSON にするので複製は要らない（つかみと最近の cmdId だけ空にする）。
  const saved: TableState = { ...state, heldBy: {}, recentCmdIds: [] };
  const manifest: Manifest = { formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString() };
  const files: Zippable = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'state.json': strToU8(JSON.stringify(saved)),
  };
  // 画像はもう圧縮済みなので、zip では圧縮しない。
  for (const a of assets) files[assetPath(a)] = [a.bytes, { level: 0 }];
  return zipSync(files);
}

/** 状態から参照されている画像のハッシュ。 */
export function referencedHashes(state: TableState): Set<string> {
  const set = new Set<string>();
  for (const c of Object.values(state.cards)) {
    set.add(c.faceHash);
    set.add(c.backHash);
  }
  for (const o of Object.values(state.objects)) {
    if (o.kind === 'stack') set.add(o.backHash);
    if (o.kind === 'board') set.add(o.imageHash);
  }
  return set;
}
