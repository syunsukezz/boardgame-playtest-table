// サイコロの動きの記録を再生する（KTD7）。描画には依存しない。
// 記録は [t, px, py, pz, qx, qy, qz, qw, ...] の平らな配列。

export const KEYFRAME_STRIDE = 8;

export interface Pose {
  pos: { x: number; y: number; z: number };
  quat: { x: number; y: number; z: number; w: number };
  /** 記録の終わりに達したか */
  done: boolean;
}

function poseAt(kf: number[], i: number, done: boolean): Pose {
  const o = i * KEYFRAME_STRIDE;
  return {
    pos: { x: kf[o + 1]!, y: kf[o + 2]!, z: kf[o + 3]! },
    quat: { x: kf[o + 4]!, y: kf[o + 5]!, z: kf[o + 6]!, w: kf[o + 7]! },
    done,
  };
}

/** 時刻 t の姿勢。位置は線形補間、回転は nlerp（短い側を通る）。終わりで止まる。 */
export function samplePose(keyframes: number[], t: number): Pose {
  const n = Math.floor(keyframes.length / KEYFRAME_STRIDE);
  if (n === 0) throw new Error('keyframes is empty');
  if (n === 1 || t <= keyframes[0]!) return poseAt(keyframes, 0, n === 1);
  const last = n - 1;
  if (t >= keyframes[last * KEYFRAME_STRIDE]!) return poseAt(keyframes, last, true);

  // t を挟む区間を二分探索
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid * KEYFRAME_STRIDE]! <= t) lo = mid;
    else hi = mid;
  }
  const a = lo * KEYFRAME_STRIDE;
  const b = hi * KEYFRAME_STRIDE;
  const ta = keyframes[a]!;
  const tb = keyframes[b]!;
  const u = tb > ta ? (t - ta) / (tb - ta) : 0;
  const lerp = (k: number) => keyframes[a + k]! + (keyframes[b + k]! - keyframes[a + k]!) * u;

  // 内積が負なら反対側の符号を使い、遠回りを避ける
  let dot = 0;
  for (let k = 4; k < 8; k++) dot += keyframes[a + k]! * keyframes[b + k]!;
  const s = dot < 0 ? -1 : 1;
  const q = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const qa = keyframes[a + 4 + k]!;
    q[k] = qa + (s * keyframes[b + 4 + k]! - qa) * u;
  }
  const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
  return {
    pos: { x: lerp(1), y: lerp(2), z: lerp(3) },
    quat: { x: q[0]! / len, y: q[1]! / len, z: q[2]! / len, w: q[3]! / len },
    done: false,
  };
}
