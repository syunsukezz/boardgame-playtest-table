import { describe, expect, it } from 'vitest';
import { fitLongEdge, sheetRects } from '../../src/assets/sheet';

describe('シートの切り分け', () => {
  it('3行×4列の400×300は、同じ大きさ100×100の12枚になる（行優先）', () => {
    const rects = sheetRects(400, 300, 3, 4);
    expect(rects).toHaveLength(12);
    for (const r of rects) expect([r.width, r.height]).toEqual([100, 100]);
    expect(rects[0]).toMatchObject({ x: 0, y: 0 });
    expect(rects[4]).toMatchObject({ x: 0, y: 100 });
  });

  it('行数・列数が1未満なら例外', () => {
    expect(() => sheetRects(400, 300, 0, 4)).toThrow();
    expect(() => sheetRects(400, 300, 3, 0)).toThrow();
  });
});

describe('長辺の縮小', () => {
  it('長辺2000pxは1024pxに縮み、縦横比は保たれる', () => {
    const r = fitLongEdge(2000, 1400, 1024);
    expect(r.width).toBe(1024);
    expect(r.height).toBe(Math.round((1400 * 1024) / 2000));
  });

  it('小さい画像は拡大しない', () => {
    expect(fitLongEdge(500, 300, 1024)).toEqual({ width: 500, height: 300 });
  });
});
