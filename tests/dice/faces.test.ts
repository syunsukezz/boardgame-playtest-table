import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DIE_FACE_NORMALS, DIE_FACE_VALUES, topFace } from '../../src/dice/faces';
import { seededRng } from '../../src/core/rng';

/** three.js で回転させて、一番上を向く面の目を求める（テスト側の独立した基準）。 */
function topFaceByThree(q: THREE.Quaternion): number {
  let best = 0;
  let bestY = -Infinity;
  DIE_FACE_NORMALS.forEach(([x, y, z], i) => {
    const ry = new THREE.Vector3(x, y, z).applyQuaternion(q).y;
    if (ry > bestY) {
      bestY = ry;
      best = i;
    }
  });
  return DIE_FACE_VALUES[best]!;
}

describe('サイコロの上の面', () => {
  it('Z軸まわりに90°回すと +x 面（3）が上を向く', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    expect(topFace(q)).toBe(3);
  });

  it('どんな回転でも three.js で回した結果と同じ面になる', () => {
    const rng = seededRng(99);
    for (let i = 0; i < 2000; i++) {
      const q = new THREE.Quaternion(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5).normalize();
      expect(topFace(q)).toBe(topFaceByThree(q));
    }
  });
});
