// ホスト側でサイコロを物理演算し、出目と約30Hzの動きの記録を作る（KTD7）。
// 参加者は playback.ts で記録を再生するだけ。
import RAPIER from '@dimforge/rapier3d-compat';
import type { Rng } from '../core/rng';
import { TABLE_HALF_D, TABLE_HALF_W } from '../core/state';
import { DIE_SIZE, topFace, topFaceInfo, type Quat } from './faces';
import { KEYFRAME_STRIDE } from './playback';

export { topFace };

export interface DiceRoll {
  value: number;
  /** [t, px, py, pz, qx, qy, qz, qw, ...]。t は秒。位置は箱の中心（静止時 y≈DIE_SIZE/2）。 */
  keyframes: number[];
}

const STEP = 1 / 60;
const SAMPLE_EVERY = 2; // 60Hz の2ステップごと = 30Hz
const MAX_STEPS = 4 * 60; // 最初の計算は約4秒まで
const NUDGE_STEPS = 60; // 押し直し1回あたりの追加計算
const MAX_NUDGES = 3;
const FLAT_DOT = 0.95;
const H = DIE_SIZE / 2;

let initPromise: Promise<void> | null = null;

/** Rapier を初期化する（何度呼んでも1回だけ）。失敗したら覚えず、次の呼び出しでやり直す。 */
export function initDicePhysics(): Promise<void> {
  initPromise ??= RAPIER.init().catch((e: unknown) => {
    initPromise = null;
    throw e;
  });
  return initPromise;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** 一様にランダムな回転（Shoemake）。 */
function randomQuat(rng: Rng): Quat {
  const u1 = rng.next();
  const u2 = rng.next() * 2 * Math.PI;
  const u3 = rng.next() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) };
}

/** start の上からサイコロを投げ、止まるまで計算する。initDicePhysics の後に呼ぶ。 */
export function simulateRoll(rng: Rng, start: { x: number; z: number }): DiceRoll {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  try {
    // 机の天板（上面 y=0）と4辺の見えない壁
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const tableCol = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.6).setRestitution(0.3),
        fixed,
      );
    const W = TABLE_HALF_W;
    const D = TABLE_HALF_D;
    tableCol(W + 1, 0.5, D + 1, 0, -0.5, 0);
    tableCol(0.5, 2, D + 1, W + 0.5, 2, 0);
    tableCol(0.5, 2, D + 1, -W - 0.5, 2, 0);
    tableCol(W + 1, 2, 0.5, 0, 2, D + 0.5);
    tableCol(W + 1, 2, 0.5, 0, 2, -D - 0.5);

    // 壁の内側に収める
    const sx = Math.max(-W + H, Math.min(W - H, start.x));
    const sz = Math.max(-D + H, Math.min(D - H, start.z));
    const rot = randomQuat(rng);
    const dir = rng.next() * 2 * Math.PI;
    const speed = 1.5 + rng.next() * 2;
    const spin = () => (rng.next() * 2 - 1) * 20;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(sx, 0.8 + rng.next() * 0.4, sz)
        .setRotation(rot)
        .setLinvel(Math.cos(dir) * speed, 1 + rng.next() * 2, Math.sin(dir) * speed)
        .setAngvel({ x: spin(), y: spin(), z: spin() })
        .setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(H, H, H).setDensity(1).setFriction(0.5).setRestitution(0.4),
      body,
    );

    const keyframes: number[] = [];
    let step = 0;
    const push = () => {
      const p = body.translation();
      const q = body.rotation();
      keyframes.push(round(step * STEP), round(p.x), round(p.y), round(p.z), round(q.x), round(q.y), round(q.z), round(q.w));
    };
    push();

    const run = (maxSteps: number) => {
      for (let i = 0; i < maxSteps; i++) {
        world.step();
        step++;
        if (body.isSleeping()) break;
        if (step % SAMPLE_EVERY === 0) push();
      }
    };

    run(MAX_STEPS);
    for (let n = 0; n < MAX_NUDGES && topFaceInfo(body.rotation()).dot < FLAT_DOT; n++) {
      // 斜めに止まったら軽く押して計算し直す
      body.applyImpulse({ x: 0, y: 0.1 * body.mass() * 9.81 * 0.3, z: 0 }, true);
      body.applyTorqueImpulse({ x: (rng.next() * 2 - 1) * 0.002, y: 0, z: (rng.next() * 2 - 1) * 0.002 }, true);
      run(NUDGE_STEPS);
    }

    // 最後の姿勢を必ず記録し、その（丸めた）回転から出目を決める
    if (keyframes[keyframes.length - KEYFRAME_STRIDE] !== round(step * STEP)) push();
    const n = keyframes.length - KEYFRAME_STRIDE;
    const value = topFace({ x: keyframes[n + 4]!, y: keyframes[n + 5]!, z: keyframes[n + 6]!, w: keyframes[n + 7]! });
    return { value, keyframes };
  } finally {
    world.free();
  }
}
