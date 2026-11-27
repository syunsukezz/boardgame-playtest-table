// 素材の取り込み（R15, R16, R24）。山札（1枚ずつ／シート、山札ごとの裏面）と盤面。ホストだけが使う。
import { BOARD_MAX_EDGE, CARD_MAX_EDGE, importImage, importSheet } from '../assets/import';
import type { AssetStore, StoredAsset } from '../assets/store';
import type { CommandBody, NewCardSpec } from '../core/commands';
import type { Placement } from '../core/state';
import { openDialog } from './dialog';
import { h } from './dom';

/** 盤面の長い辺の大きさ（卓の単位） */
export const BOARD_LONG_SIDE = 6;
const SHEET_MAX = 20;

/** ファイル名からカードの名前を作る（拡張子を除く）。 */
export function cardNameFromFile(fileName: string, index: number): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || `カード${index + 1}`;
}

/** 画像の縦横比から盤面の大きさを決める（長い辺を BOARD_LONG_SIDE に）。 */
export function boardSize(width: number, height: number, longSide = BOARD_LONG_SIDE): { width: number; depth: number } {
  if (width >= height) return { width: longSide, depth: (longSide * height) / width };
  return { width: (longSide * width) / height, depth: longSide };
}

/** 保存済みの画像の縦横の大きさ。 */
export async function imageSize(a: StoredAsset): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(new Blob([a.bytes as Uint8Array<ArrayBuffer>], { type: a.mime }));
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/** 裏面の画像を選ばなかったときの、無地の裏面。 */
async function defaultBack(): Promise<Blob> {
  const c = new OffscreenCanvas(256, 358);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#37474f';
  ctx.fillRect(0, 0, 256, 358);
  ctx.strokeStyle = '#cfd8dc';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 330);
  ctx.fillStyle = '#cfd8dc';
  ctx.font = 'bold 80px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('◆', 128, 179);
  return c.convertToBlob({ type: 'image/png' });
}

export interface ImportDialogOptions {
  assets: AssetStore;
  maxTextureSize: number;
  /** 新しく出す物の置き場所 */
  placement(): Placement;
  submit(body: CommandBody): void;
}

export function openImportDialog(o: ImportDialogOptions): void {
  const kindDeck = h('input', { type: 'radio', name: 'imp-kind', value: 'deck', checked: true });
  const kindBoard = h('input', { type: 'radio', name: 'imp-kind', value: 'board' });

  // 山札
  const modeSingle = h('input', { type: 'radio', name: 'imp-mode', value: 'single', checked: true });
  const modeSheet = h('input', { type: 'radio', name: 'imp-mode', value: 'sheet' });
  const faceFiles = h('input', { type: 'file', accept: 'image/*', multiple: true });
  const sheetFile = h('input', { type: 'file', accept: 'image/*' });
  const rows = h('input', { type: 'number', min: 1, max: SHEET_MAX, step: 1, value: 3, class: 'num' });
  const cols = h('input', { type: 'number', min: 1, max: SHEET_MAX, step: 1, value: 3, class: 'num' });
  const backFile = h('input', { type: 'file', accept: 'image/*' });
  const singleBox = h('div', { class: 'field' }, h('div', {}, '表の画像（複数選べます。1ファイル＝1枚）'), faceFiles);
  const sheetBox = h(
    'div',
    { class: 'field' },
    h('div', {}, 'シート画像（1枚）'),
    sheetFile,
    h('div', { class: 'row' }, h('label', {}, '行 ', rows), h('label', {}, '列 ', cols)),
  );
  const deckBox = h(
    'div',
    {},
    h('div', { class: 'checks' }, h('label', {}, modeSingle, '1枚ずつのファイル'), h('label', {}, modeSheet, 'シート（行×列で切り分け）')),
    singleBox,
    sheetBox,
    h('div', { class: 'field' }, h('div', {}, 'この山札の裏面（1枚。選ばなければ無地）'), backFile),
  );

  // 盤面
  const boardFile = h('input', { type: 'file', accept: 'image/*' });
  const boardBox = h('div', { class: 'field' }, h('div', {}, '盤面の画像'), boardFile);

  const status = h('p', { class: 'muted', 'aria-live': 'polite' });
  /** 取り込み中は OK を押せないようにし、入力を変えても押せるように戻さない。 */
  let busy = false;
  /** キャンセルされた。取り込み途中なら、以後は画像も山札も追加しない。 */
  let cancelled = false;

  const update = (): void => {
    const deck = kindDeck.checked;
    deckBox.hidden = !deck;
    boardBox.hidden = deck;
    singleBox.hidden = !modeSingle.checked;
    sheetBox.hidden = modeSingle.checked;
    dlg.setOkEnabled(!busy && valid());
  };
  const intIn = (el: HTMLInputElement): number | null => {
    const n = Number(el.value);
    return Number.isInteger(n) && n >= 1 && n <= SHEET_MAX ? n : null;
  };
  const valid = (): boolean => {
    if (kindBoard.checked) return (boardFile.files?.length ?? 0) > 0;
    if (modeSingle.checked) return (faceFiles.files?.length ?? 0) > 0;
    return (sheetFile.files?.length ?? 0) > 0 && intIn(rows) !== null && intIn(cols) !== null;
  };

  const run = async (): Promise<boolean> => {
    if (busy || !valid()) return false;
    busy = true;
    dlg.setOkEnabled(false);
    // 始めた時点の入力で最後まで進める（途中で選び直されても混ざらないように）
    const input = {
      board: kindBoard.checked,
      single: modeSingle.checked,
      boardFile: boardFile.files?.[0],
      faceFiles: [...(faceFiles.files ?? [])],
      sheetFile: sheetFile.files?.[0],
      rows: intIn(rows),
      cols: intIn(cols),
      backFile: backFile.files?.[0],
    };
    /** キャンセル後は何も追加しない。 */
    const put = (a: StoredAsset): boolean => {
      if (cancelled) return false;
      o.assets.put(a);
      return true;
    };
    status.textContent = '取り込み中…（画像を縮めています）';
    try {
      if (input.board) {
        const a = await importImage(input.boardFile!, BOARD_MAX_EDGE, o.maxTextureSize);
        if (!put(a)) return false;
        const { width, height } = await imageSize(a);
        if (cancelled) return false;
        const size = boardSize(width, height);
        o.submit({ type: 'spawnBoard', imageHash: a.hash, width: size.width, depth: size.depth, placement: o.placement() });
        return true;
      }
      const back = await importImage(input.backFile ?? (await defaultBack()), CARD_MAX_EDGE);
      if (!put(back)) return false;
      const cards: NewCardSpec[] = [];
      if (input.single) {
        const files = input.faceFiles;
        for (let i = 0; i < files.length; i++) {
          status.textContent = `取り込み中… ${i + 1}/${files.length}`;
          const a = await importImage(files[i]!, CARD_MAX_EDGE);
          if (!put(a)) return false;
          cards.push({ faceHash: a.hash, backHash: back.hash, name: cardNameFromFile(files[i]!.name, i) });
        }
      } else {
        const list = await importSheet(input.sheetFile!, input.rows!, input.cols!, CARD_MAX_EDGE);
        for (const [i, a] of list.entries()) {
          if (!put(a)) return false;
          cards.push({ faceHash: a.hash, backHash: back.hash, name: `カード${i + 1}` });
        }
      }
      if (cancelled) return false;
      o.submit({ type: 'spawnDeck', cards, placement: o.placement() });
      return true;
    } catch (e) {
      console.error(e);
      if (!cancelled) status.textContent = `取り込めませんでした: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    } finally {
      busy = false;
      // ダイアログが OK を押せる状態に戻した後で、今の入力に合わせ直す
      if (!cancelled) setTimeout(update, 0);
    }
  };

  const dlg = openDialog({
    title: '取り込み',
    body: [
      h('div', { class: 'checks' }, h('label', {}, kindDeck, '山札（カード）'), h('label', {}, kindBoard, '盤面')),
      deckBox,
      boardBox,
      status,
    ],
    okLabel: '取り込む',
    onOk: run,
    onCancel: () => {
      cancelled = true;
    },
  });
  dlg.root.addEventListener('change', update);
  dlg.root.addEventListener('input', update);
  update();
}
