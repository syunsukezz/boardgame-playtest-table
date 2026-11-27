// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredAsset } from '../../src/assets/store';

/** importImage の結果を、テストが好きなときに返せるようにする。 */
const pending: ((a: StoredAsset) => void)[] = [];
vi.mock('../../src/assets/import', () => ({
  CARD_MAX_EDGE: 1024,
  BOARD_MAX_EDGE: 4096,
  importImage: vi.fn(() => new Promise<StoredAsset>((resolve) => pending.push(resolve))),
  importSheet: vi.fn(),
}));

const { openImportDialog } = await import('../../src/ui/import-dialog');

function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function tick(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function asset(hash: string): StoredAsset {
  return { hash, mime: 'image/png', bytes: new Uint8Array([1]) };
}

function open() {
  const put = vi.fn();
  const submit = vi.fn();
  openImportDialog({
    assets: { put } as never,
    maxTextureSize: 4096,
    placement: () => ({ pos: { x: 0, y: 0, z: 0 }, rot: 0 }),
    submit,
  });
  const modal = document.querySelector('.modal') as HTMLElement;
  const fileInputs = [...modal.querySelectorAll('input[type=file]')] as HTMLInputElement[];
  // 並び: 表の画像（複数）, シート, 裏面, 盤面
  const [faces, , back] = fileInputs;
  const buttons = [...modal.querySelectorAll('button')] as HTMLButtonElement[];
  const ok = buttons.find((b) => b.textContent === '取り込む')!;
  const cancel = buttons.find((b) => b.textContent === 'キャンセル')!;
  return { put, submit, faces: faces!, back: back!, ok, cancel };
}

afterEach(() => {
  document.body.innerHTML = '';
  pending.length = 0;
});

describe('取り込みダイアログ', () => {
  it('取り込み中は OK を押せず、入力を変えても押せるようにならない', async () => {
    const d = open();
    setFiles(d.faces, [new File(['a'], 'a.png')]);
    setFiles(d.back, [new File(['b'], 'b.png')]);
    expect(d.ok.disabled).toBe(false);
    d.ok.click();
    await tick();
    expect(d.ok.disabled).toBe(true);
    setFiles(d.faces, [new File(['c'], 'c.png')]);
    expect(d.ok.disabled).toBe(true);
    // 始めたときに選んでいたファイルで最後まで取り込む
    pending.shift()!(asset('back'));
    await tick();
    pending.shift()!(asset('face-a'));
    await tick();
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.submit.mock.calls[0]![0]).toMatchObject({ type: 'spawnDeck', cards: [{ faceHash: 'face-a', name: 'a' }] });
  });

  it('取り込み中にキャンセルしたら、画像も山札も追加しない', async () => {
    const d = open();
    setFiles(d.faces, [new File(['a'], 'a.png')]);
    setFiles(d.back, [new File(['b'], 'b.png')]);
    d.ok.click();
    await tick();
    d.cancel.click();
    pending.shift()!(asset('back'));
    await tick();
    for (const r of pending.splice(0)) r(asset('face-a'));
    await tick();
    expect(d.put).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });
});
