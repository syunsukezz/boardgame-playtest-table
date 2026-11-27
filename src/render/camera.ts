// 視点。右ボタンで回転、中ボタンで平行移動。左ボタンはドラッグ操作に使うので外す。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { seatAnchor, seatLocalToWorld } from './seats-layout';

/** 席ごとの視点プリセット。席の後ろ上方から卓の中央寄りを見る */
export function seatCameraPreset(seat: number): { position: THREE.Vector3; target: THREE.Vector3 } {
  const p = seatLocalToWorld(seat, 0, 6.5, 3.2);
  const a = seatAnchor(seat).pos;
  return {
    position: new THREE.Vector3(p.x, p.y, p.z),
    target: new THREE.Vector3(a.x * 0.3, 0, a.z * 0.3),
  };
}

export class CameraRig {
  readonly controls: OrbitControls;
  private anim:
    | { t: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3 }
    | undefined;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 30;
    this.controls.screenSpacePanning = false;
  }

  /** 席の視点へ移る。animate=false ならすぐに */
  goToSeat(seat: number, animate: boolean): void {
    const to = seatCameraPreset(seat);
    if (!animate) {
      this.anim = undefined;
      this.camera.position.copy(to.position);
      this.controls.target.copy(to.target);
      this.controls.update();
      return;
    }
    this.anim = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: to.position,
      toTarget: to.target,
    };
  }

  update(dt: number): void {
    const a = this.anim;
    if (a) {
      a.t = Math.min(1, a.t + dt / 0.6);
      const k = a.t * a.t * (3 - 2 * a.t);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      if (a.t >= 1) this.anim = undefined;
    }
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
