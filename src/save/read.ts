// 保存ファイル（zip）を読み込む（R18, R21, KTD8）。
// 版・画像のハッシュ・大きさを確かめ、問題があれば理由つきの SaveError を投げる。
import { strFromU8, unzipSync } from 'fflate';
import { sha256Hex } from '../assets/hash';
import type { StoredAsset } from '../assets/store';
import type { TableState } from '../core/state';
import { MAX_ASSET_BYTES, MAX_SAVE_BYTES, SaveError, validateState } from './validate';
import { FORMAT_VERSION, referencedHashes } from './write';

export { SaveError };

const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

export interface LoadedSave {
  state: TableState;
  assets: StoredAsset[];
}

export async function readSave(bytes: Uint8Array): Promise<LoadedSave> {
  if (bytes.length > MAX_SAVE_BYTES) throw new SaveError('ファイルが大きすぎます');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SaveError('保存ファイルとして読めません（zip ではありません）');
  }

  const manifest = parseJson(files['manifest.json'], '保存ファイルの情報（manifest.json）がありません');
  const version = (manifest as { formatVersion?: unknown }).formatVersion;
  if (typeof version !== 'number') throw new SaveError('保存ファイルの版が分かりません');
  if (version > FORMAT_VERSION) throw new SaveError('このファイルは新しい版のアプリで保存されています。アプリを更新してください');

  const state = validateState(parseJson(files['state.json'], '卓の状態（state.json）がありません'));
  state.heldBy = {};
  state.recentCmdIds = [];

  const assets: StoredAsset[] = [];
  for (const [path, data] of Object.entries(files)) {
    const m = /^assets\/([0-9a-f]{64})\.(webp|png|jpg)$/.exec(path);
    if (!m) continue;
    if (data.length > MAX_ASSET_BYTES) throw new SaveError('大きすぎる画像が含まれています');
    const hash = m[1]!;
    if ((await sha256Hex(data)) !== hash) throw new SaveError('画像が壊れています（ハッシュが一致しません）');
    assets.push({ hash, mime: MIME[m[2]!]!, bytes: data });
  }

  const have = new Set(assets.map((a) => a.hash));
  for (const h of referencedHashes(state)) {
    if (!have.has(h)) throw new SaveError('卓で使っている画像が保存ファイルに入っていません');
  }
  return { state, assets };
}

function parseJson(data: Uint8Array | undefined, missing: string): unknown {
  if (!data) throw new SaveError(missing);
  try {
    return JSON.parse(strFromU8(data));
  } catch {
    throw new SaveError('保存ファイルの中身が壊れています');
  }
}
