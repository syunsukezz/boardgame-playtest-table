// 卓の物のメッシュを作る。カードは1枚1メッシュで、表裏の材質を切り替える（KTD1）。
import * as THREE from 'three';
import type { PieceShape } from '../core/state';
import { DIE_FACE_VALUES, DIE_SIZE } from '../dice/faces';
import { CARD_H, CARD_T, CARD_W } from './hand-rack';

// 共有するジオメトリ（作り直さない。dispose はレンダラーの終了時だけ）
const cardGeo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H);
/** 高さ1の箱。山札は y 方向に拡大して厚みを出す */
const stackGeo = new THREE.BoxGeometry(CARD_W, 1, CARD_H);
const boardGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export { DIE_FACE_VALUES, DIE_SIZE };
const dieGeo = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
const pieceGeos: Record<PieceShape, THREE.BufferGeometry[]> = {
  pawn: [
    new THREE.CylinderGeometry(0.12, 0.18, 0.3, 24).translate(0, 0.15, 0),
    new THREE.SphereGeometry(0.12, 20, 14).translate(0, 0.38, 0),
  ],
  cube: [new THREE.BoxGeometry(0.32, 0.32, 0.32).translate(0, 0.16, 0)],
  disc: [new THREE.CylinderGeometry(0.25, 0.25, 0.08, 32).translate(0, 0.04, 0)],
  cone: [new THREE.ConeGeometry(0.2, 0.45, 24).translate(0, 0.225, 0)],
};

/** カードの縁（共有） */
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.8 });

export function disposeSharedGeometry(): void {
  cardGeo.dispose();
  stackGeo.dispose();
  boardGeo.dispose();
  dieGeo.dispose();
  for (const gs of Object.values(pieceGeos)) for (const g of gs) g.dispose();
  edgeMat.dispose();
}

function faceMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
}

/** カード。上面（+y）と下面（-y）の材質を持つ。BoxGeometry の面順は px,nx,py,ny,pz,nz */
export interface CardParts {
  mesh: THREE.Mesh;
  top: THREE.MeshStandardMaterial;
  bottom: THREE.MeshStandardMaterial;
}

export function createCardMesh(): CardParts {
  const top = faceMat();
  const bottom = faceMat();
  const mesh = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, top, bottom, edgeMat, edgeMat]);
  mesh.castShadow = true;
  return { mesh, top, bottom };
}

export interface StackParts {
  mesh: THREE.Mesh;
  top: THREE.MeshStandardMaterial;
  side: THREE.MeshStandardMaterial;
}

export function createStackMesh(): StackParts {
  const top = faceMat();
  const side = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.9 });
  const mesh = new THREE.Mesh(stackGeo, [side, side, top, side, side, side]);
  mesh.castShadow = true;
  return { mesh, top, side };
}

/** 山札の厚み（枚数に比例。空でも薄く見せる） */
export function stackHeight(count: number): number {
  return Math.max(count, 1) * CARD_T;
}

export function createBoardMesh(): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const mesh = new THREE.Mesh(boardGeo, mat);
  mesh.receiveShadow = true;
  return { mesh, mat };
}

export function createPieceMesh(
  shape: PieceShape,
  color: string,
): { group: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.45 });
  const group = new THREE.Group();
  for (const g of pieceGeos[shape]) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    group.add(m);
  }
  return { group, mat };
}

export function createDieMesh(pipMats: THREE.Material[]): THREE.Mesh {
  const mesh = new THREE.Mesh(dieGeo, pipMats);
  mesh.castShadow = true;
  mesh.position.y = DIE_SIZE / 2;
  return mesh;
}

/** 目 value を上に向ける回転 */
export function dieRotationFor(value: number): THREE.Euler {
  switch (value) {
    case 6:
      return new THREE.Euler(Math.PI, 0, 0);
    case 3:
      return new THREE.Euler(0, 0, Math.PI / 2);
    case 4:
      return new THREE.Euler(0, 0, -Math.PI / 2);
    case 2:
      return new THREE.Euler(-Math.PI / 2, 0, 0);
    case 5:
      return new THREE.Euler(Math.PI / 2, 0, 0);
    default:
      return new THREE.Euler(0, 0, 0);
  }
}
