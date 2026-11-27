// サイコロの大きさと面の目。three.js を参照しない（物理演算・描画の両方から使う）。

/** サイコロの一辺。 */
export const DIE_SIZE = 0.4;

/** サイコロの面ごとの目（px,nx,py,ny,pz,nz。向かい合う面の和が7）。BoxGeometry の面順と同じ。 */
export const DIE_FACE_VALUES = [3, 4, 1, 6, 2, 5] as const;

/** 面の法線（ローカル）。DIE_FACE_VALUES と同じ並び（+x, -x, +y, -y, +z, -z）。 */
export const DIE_FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * 回転 q で上（+y）を最もよく向く面の目と、その向きの度合い。
 * 物理演算（simulate.ts）が出目と「平らに止まったか」の判定に使う。
 */
export function topFaceInfo(q: Quat): { value: number; dot: number } {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const [x, y, z] = DIE_FACE_NORMALS[i]!;
    // 回転後ベクトルの y 成分だけを計算する
    const tx = 2 * (q.y * z - q.z * y);
    const tz = 2 * (q.x * y - q.y * x);
    const ry = y + q.w * (q.z * x - q.x * z) + (q.z * tx - q.x * tz);
    if (ry > bestDot) {
      bestDot = ry;
      best = i;
    }
  }
  return { value: DIE_FACE_VALUES[best]!, dot: bestDot };
}

/** 回転 q で上を向く面の目。 */
export function topFace(q: Quat): number {
  return topFaceInfo(q).value;
}
