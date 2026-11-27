// 画像の取り込み（ブラウザ専用）。縮小して WebP にし、使えなければ PNG にする（KTD9）。
import { sha256Hex } from './hash';
import { fitLongEdge, sheetRects } from './sheet';
import type { StoredAsset } from './store';

export const CARD_MAX_EDGE = 1024;
export const BOARD_MAX_EDGE = 4096;

async function encode(canvas: OffscreenCanvas): Promise<StoredAsset> {
  let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  // WebP を作れないブラウザは PNG になる（透過を保つため JPEG にはしない）
  if (blob.type !== 'image/webp') blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { hash: await sha256Hex(bytes), mime: blob.type, bytes };
}

async function drawScaled(
  bmp: ImageBitmap,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  maxLongEdge: number,
): Promise<StoredAsset> {
  const { width, height } = fitLongEdge(sw, sh, maxLongEdge);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D コンテキストを作れません');
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, width, height);
  return encode(canvas);
}

/** 1枚の画像を取り込む。盤面は maxTextureSize で更に頭打ちにできる。 */
export async function importImage(file: Blob, maxLongEdge: number, maxTextureSize?: number): Promise<StoredAsset> {
  const bmp = await createImageBitmap(file);
  try {
    const limit = maxTextureSize ? Math.min(maxLongEdge, maxTextureSize) : maxLongEdge;
    return await drawScaled(bmp, 0, 0, bmp.width, bmp.height, limit);
  } finally {
    bmp.close();
  }
}

/** シートを rows×cols に切り分け、1枚ずつ取り込む（行優先）。 */
export async function importSheet(file: Blob, rows: number, cols: number, maxLongEdge: number): Promise<StoredAsset[]> {
  const bmp = await createImageBitmap(file);
  try {
    const out: StoredAsset[] = [];
    for (const r of sheetRects(bmp.width, bmp.height, rows, cols)) {
      out.push(await drawScaled(bmp, r.x, r.y, r.width, r.height, maxLongEdge));
    }
    return out;
  } finally {
    bmp.close();
  }
}
