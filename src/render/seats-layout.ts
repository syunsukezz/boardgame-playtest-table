// 8席を長方形の卓のまわりに置く。three.js を参照しない純粋な計算。
import { MAX_SEATS, TABLE_HALF_D, TABLE_HALF_W, type Vec3 } from '../core/state';

/** 卓面の半分の幅（x）と奥行き（z）。卓面は y=0。 */
export { TABLE_HALF_D, TABLE_HALF_W };

/** 8席の色（つかんでいる名札・席のパネル・帯で使う）。 */
export const SEAT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#6d4c41'] as const;
/** 手札ラックを卓の縁からどれだけ外に置くか */
const RACK_OUTSET = 0.45;

// 席ごとの縁の位置。0と1が向かい合い、2と3が短辺、残りは長辺の端
const EDGE: { side: 'near' | 'far' | 'left' | 'right'; t: number }[] = [
  { side: 'near', t: 0 },
  { side: 'far', t: 0 },
  { side: 'left', t: 0 },
  { side: 'right', t: 0 },
  { side: 'near', t: -3.6 },
  { side: 'far', t: 3.6 },
  { side: 'near', t: 3.6 },
  { side: 'far', t: -3.6 },
];

/**
 * 席の手札ラックの位置と向き。
 * facing は上向き軸まわりの回転（three.js の rotation.y）。ローカルの -z が卓の中央側を向き、
 * ローカルの x がラックの並び方向になる。縁に垂直に中央側を向く。
 */
export function seatAnchor(seat: number): { pos: Vec3; facing: number } {
  const e = EDGE[((seat % MAX_SEATS) + MAX_SEATS) % MAX_SEATS]!;
  switch (e.side) {
    case 'near':
      return { pos: { x: e.t, y: 0, z: TABLE_HALF_D + RACK_OUTSET }, facing: 0 };
    case 'far':
      return { pos: { x: e.t, y: 0, z: -TABLE_HALF_D - RACK_OUTSET }, facing: Math.PI };
    case 'left':
      return { pos: { x: -TABLE_HALF_W - RACK_OUTSET, y: 0, z: e.t }, facing: -Math.PI / 2 };
    case 'right':
      return { pos: { x: TABLE_HALF_W + RACK_OUTSET, y: 0, z: e.t }, facing: Math.PI / 2 };
  }
}

/** ローカル座標（x: ラック方向, z: 席の側が +）を世界座標へ */
export function seatLocalToWorld(seat: number, lx: number, ly: number, lz: number): Vec3 {
  const { pos, facing } = seatAnchor(seat);
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: pos.x + lx * c + lz * s, y: pos.y + ly, z: pos.z - lx * s + lz * c };
}

/** 世界座標をその席のローカル座標へ（seatLocalToWorld の逆） */
export function worldToSeatLocal(seat: number, p: Vec3): { x: number; z: number } {
  const { pos, facing } = seatAnchor(seat);
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  const dx = p.x - pos.x;
  const dz = p.z - pos.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
