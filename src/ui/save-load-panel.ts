// 保存と読み込み（R18, R21）。ホストだけが使う。
import type { AssetStore } from '../assets/store';
import type { TableState } from '../core/state';
import { SaveError, readSave } from '../save/read';
import { referencedHashes, writeSave } from '../save/write';
import { confirmDialog } from './dialog';

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

function fileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `playtest-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** 卓の状態と参照している画像を zip にして書き出す。取り消されたら false。 */
export async function saveTable(state: TableState, assets: AssetStore): Promise<boolean> {
  const used = referencedHashes(state);
  const bytes = writeSave(
    state,
    assets.all().filter((a) => used.has(a.hash)),
  );
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  const w = window as unknown as SaveFilePickerWindow;
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName(),
        types: [{ description: '試遊卓の保存ファイル', accept: { 'application/zip': ['.zip'] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      // ピッカーが使えない場面（iframe など）は、ふつうのダウンロードにする
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** ファイルを選ばせる。選ばれなければ null。 */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

export type LoadOutcome = { ok: true } | { ok: false; error?: string };

/** 確認のあと保存ファイルを読み込み、画像を入れてから load(state) を呼ぶ（R21）。 */
export async function loadTable(assets: AssetStore, load: (state: TableState) => void): Promise<LoadOutcome> {
  const file = await pickFile();
  if (!file) return { ok: false };
  const ok = await confirmDialog(
    '読み込むと、全員の卓が入れ替わります。いまの卓は消え、参加者は全員いったん席を外れます（ホストが割り当て直します）。読み込みますか？',
    '読み込む',
  );
  if (!ok) return { ok: false };
  try {
    const loaded = await readSave(new Uint8Array(await file.arrayBuffer()));
    for (const a of loaded.assets) assets.put(a);
    load(loaded.state);
    return { ok: true };
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: '保存ファイルを読み込めませんでした' };
  }
}
