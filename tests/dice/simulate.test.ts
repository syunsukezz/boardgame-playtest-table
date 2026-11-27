import { beforeAll, describe, expect, it } from 'vitest';
import { samplePose } from '../../src/dice/playback';
import { initDicePhysics, simulateRoll, topFace } from '../../src/dice/simulate';
import { seededRng } from '../../src/core/rng';

const STRIDE = 8;

function lastQuat(kf: number[]) {
  const i = kf.length - STRIDE;
  return { x: kf[i + 4]!, y: kf[i + 5]!, z: kf[i + 6]!, w: kf[i + 7]! };
}

describe('simulateRoll', () => {
  beforeAll(async () => {
    await initDicePhysics();
  });

  it('同じ初期値・同じ位置なら出目も記録も同じ', () => {
    const a = simulateRoll(seededRng(42), { x: 1, z: -0.5 });
    const b = simulateRoll(seededRng(42), { x: 1, z: -0.5 });
    expect(a.value).toBe(b.value);
    expect(a.keyframes).toEqual(b.keyframes);
  });

  it('出目は1〜6の整数で、記録は8個区切り・30Hz・4秒程度に収まる', () => {
    for (let s = 0; s < 20; s++) {
      const r = simulateRoll(seededRng(s), { x: 0, z: 0 });
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(1);
      expect(r.value).toBeLessThanOrEqual(6);
      expect(r.keyframes.length % STRIDE).toBe(0);
      expect(r.keyframes[0]).toBe(0);
      // 4秒+押し直し分の上限内
      expect(r.keyframes.length / STRIDE).toBeLessThanOrEqual(30 * 6 + 2);
    }
  }, 30_000); // 物理演算を繰り返すので、負荷が高いと時間がかかる

  it('最初の記録はスタート位置の真上から始まる', () => {
    const r = simulateRoll(seededRng(7), { x: 2, z: 1 });
    expect(r.keyframes[1]).toBeCloseTo(2, 5);
    expect(r.keyframes[3]).toBeCloseTo(1, 5);
  });

  it('記録の最後の姿勢から求めた目が出目と一致する', () => {
    for (let s = 100; s < 160; s++) {
      const r = simulateRoll(seededRng(s), { x: 0, z: 0 });
      expect(topFace(lastQuat(r.keyframes))).toBe(r.value);
    }
  });

  it('1000回振っても各目の回数が 100〜240 に収まる', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const t0 = performance.now();
    for (let s = 0; s < 1000; s++) {
      const r = simulateRoll(seededRng(s * 7919 + 1), { x: 0, z: 0 });
      counts[r.value - 1]!++;
    }
    console.log('counts', counts, 'ms', Math.round(performance.now() - t0));
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(100);
      expect(c).toBeLessThanOrEqual(240);
    }
  }, 60_000);
});

describe('topFace', () => {
  it('回転なしなら +y 面の 1', () => {
    expect(topFace({ x: 0, y: 0, z: 0, w: 1 })).toBe(1);
  });
  it('X軸まわり180°なら 6', () => {
    expect(topFace({ x: 1, y: 0, z: 0, w: 0 })).toBe(6);
  });
  it('Z軸まわり+90°なら +x 面の 3（card-mesh の dieRotationFor(3) と同じ）', () => {
    const h = Math.SQRT1_2;
    expect(topFace({ x: 0, y: 0, z: h, w: h })).toBe(3);
  });
  it('X軸まわり-90°なら +z 面の 2', () => {
    const h = Math.SQRT1_2;
    expect(topFace({ x: -h, y: 0, z: 0, w: h })).toBe(2);
  });
});

describe('samplePose', () => {
  // 2サンプル: t=0 原点・回転なし, t=0.5 (1,2,3)・Z軸90°
  const h = Math.SQRT1_2;
  const kf = [0, 0, 0, 0, 0, 0, 0, 1, 0.5, 1, 2, 3, 0, 0, h, h];

  it('t=0 で最初のサンプル', () => {
    const p = samplePose(kf, 0);
    expect(p.pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.quat.w).toBeCloseTo(1, 6);
    expect(p.done).toBe(false);
  });

  it('終わりを過ぎたら最後のサンプルで done', () => {
    const p = samplePose(kf, 3);
    expect(p.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(p.quat.z).toBeCloseTo(h, 6);
    expect(p.quat.w).toBeCloseTo(h, 6);
    expect(p.done).toBe(true);
  });

  it('途中は位置を線形に補間し、回転は正規化されている', () => {
    const p = samplePose(kf, 0.25);
    expect(p.pos.x).toBeCloseTo(0.5, 6);
    expect(p.pos.y).toBeCloseTo(1, 6);
    expect(p.pos.z).toBeCloseTo(1.5, 6);
    const q = p.quat;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
    expect(q.z).toBeCloseTo(Math.sin(Math.PI / 8), 4);
    expect(p.done).toBe(false);
  });
});
