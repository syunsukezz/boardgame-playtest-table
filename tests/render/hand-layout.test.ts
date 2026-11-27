import { describe, expect, it } from 'vitest';
import { CARD_W, RACK_WIDTH, handLayout } from '../../src/render/hand-rack';
import { seatAnchor } from '../../src/render/seats-layout';
import { MAX_SEATS } from '../../src/core/state';

// ラックの軸（ローカル x）を世界座標で表した向き
function rackAxis(facing: number) {
  return { x: Math.cos(facing), z: -Math.sin(facing) };
}

describe('handLayout', () => {
  for (let seat = 0; seat < MAX_SEATS; seat++) {
    it(`席${seat}: 5枚が重ならずに席の前に並び、席の方向を向く`, () => {
      const anchor = seatAnchor(seat);
      const slots = handLayout(seat, 5);
      expect(slots).toHaveLength(5);
      const axis = rackAxis(anchor.facing);
      const along = slots.map(
        (s) => (s.pos.x - anchor.pos.x) * axis.x + (s.pos.z - anchor.pos.z) * axis.z,
      );
      const sorted = [...along].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(CARD_W * 0.5);
      }
      for (const s of slots) {
        const d = Math.hypot(s.pos.x - anchor.pos.x, s.pos.z - anchor.pos.z);
        expect(d).toBeLessThanOrEqual(RACK_WIDTH / 2 + 0.5);
        expect(s.rotY).toBeCloseTo(anchor.facing);
        // 立てて並べる（70〜80°）
        expect(s.tilt).toBeGreaterThan((70 * Math.PI) / 180);
        expect(s.tilt).toBeLessThan((80 * Math.PI) / 180);
      }
    });

    it(`席${seat}: 20枚でもラックの幅に収まる`, () => {
      const anchor = seatAnchor(seat);
      const axis = rackAxis(anchor.facing);
      const slots = handLayout(seat, 20);
      expect(slots).toHaveLength(20);
      for (const s of slots) {
        const a = (s.pos.x - anchor.pos.x) * axis.x + (s.pos.z - anchor.pos.z) * axis.z;
        expect(Math.abs(a) + CARD_W / 2).toBeLessThanOrEqual(RACK_WIDTH / 2 + 1e-9);
      }
    });
  }

  it('0枚なら空', () => {
    expect(handLayout(0, 0)).toEqual([]);
  });
});
