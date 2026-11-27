// シートの切り分けと縮小の幾何。DOM に触れない純粋関数。
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 行優先で、同じ大きさ floor(w/cols) × floor(h/rows) の矩形を返す。 */
export function sheetRects(imageWidth: number, imageHeight: number, rows: number, cols: number): Rect[] {
  if (rows < 1 || cols < 1) throw new Error('rows と cols は1以上にしてください');
  const width = Math.floor(imageWidth / cols);
  const height = Math.floor(imageHeight / rows);
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) rects.push({ x: c * width, y: r * height, width, height });
  }
  return rects;
}

/** 長辺を maxLongEdge に収める。拡大はしない。 */
export function fitLongEdge(width: number, height: number, maxLongEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLongEdge) return { width, height };
  const k = maxLongEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
