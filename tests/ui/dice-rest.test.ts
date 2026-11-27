import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dieRotationFor } from '../../src/render/card-mesh';
import { dieRestPose } from '../../src/render/scene';

describe('サイコロの止まった姿勢 → 卓の配置と出目', () => {
  it.each([1, 2, 3, 4, 5, 6])('出目 %i: 回転 R_y(rot)·C(出目) から rot と出目を取り出せる', (value) => {
    const rot = 0.7;
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      .multiply(new THREE.Quaternion().setFromEuler(dieRotationFor(value)));
    const kf = [0, 0, 1, 0, 0, 0, 0, 1, 1.5, 2, 0.2, -1, q.x, q.y, q.z, q.w];
    const r = dieRestPose(kf);
    expect(r.value).toBe(value);
    expect(r.rot).toBeCloseTo(rot, 5);
    expect(r.pos).toEqual({ x: 2, y: 0, z: -1 });
  });
});
