// 手札ラックの配置計算。並び順だけから決める（同期するのは並び順だけ）。three.js を参照しない。
import type { Vec3 } from '../core/state';
import { seatAnchor, seatLocalToWorld, worldToSeatLocal } from './seats-layout';

/** カードの大きさ（卓の単位） */
export const CARD_W = 0.63;
export const CARD_H = 0.88;
export const CARD_T = 0.006;
/** ラックの幅 */
export const RACK_WIDTH = 3.0;
/** 手札の傾き（卓面から起こす角度） */
export const HAND_TILT = (75 * Math.PI) / 180;

export interface HandSlot {
  pos: Vec3;
  /** 上向き軸まわりの回転（席の facing と同じ） */
  rotY: number;
  /** ローカル x 軸まわりに起こす角度。表が席の側を向く */
  tilt: number;
}

export function handLayout(seat: number, count: number): HandSlot[] {
  if (count <= 0) return [];
  const { facing } = seatAnchor(seat);
  const ideal = CARD_W * 1.05;
  const fit = count > 1 ? (RACK_WIDTH - CARD_W) / (count - 1) : 0;
  const step = Math.min(ideal, fit);
  const start = (-(count - 1) * step) / 2;
  // 立てたカードの中心の高さ。重なっても見えるよう、後ろのカードほど少し席から遠ざける
  const cy = (CARD_H / 2) * Math.sin(HAND_TILT) + 0.02;
  const slots: HandSlot[] = [];
  for (let i = 0; i < count; i++) {
    const lz = -(i * 0.004);
    slots.push({ pos: seatLocalToWorld(seat, start + i * step, cy, lz), rotY: facing, tilt: HAND_TILT });
  }
  return slots;
}

/** 卓面上の位置が、その席のラックの上か */
export function isOverRack(seat: number, p: Vec3): boolean {
  const l = worldToSeatLocal(seat, p);
  return Math.abs(l.x) <= RACK_WIDTH / 2 && l.z >= -0.7 && l.z <= 0.9;
}
