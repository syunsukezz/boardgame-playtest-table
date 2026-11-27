// 3D の卓（U6）。View（席ごとに切り出した状態）をそのまま描く。状態は持たず、操作は onCommand で送る。
import * as THREE from 'three';
import type { CommandBody } from '../core/commands';
import type { View } from '../core/project';
import { MAX_SEATS, type Vec3 } from '../core/state';
import { samplePose } from '../dice/playback';
import { CameraRig } from './camera';
import {
  DIE_FACE_VALUES,
  DIE_SIZE,
  createBoardMesh,
  createCardMesh,
  createDieMesh,
  createPieceMesh,
  createStackMesh,
  dieRotationFor,
  disposeSharedGeometry,
  stackHeight,
  type CardParts,
  type StackParts,
} from './card-mesh';
import { resolveClick, resolveDrop, type PickTarget } from './drag';
import { CARD_T, RACK_WIDTH, handLayout, isOverRack } from './hand-rack';
import { TABLE_HALF_D, TABLE_HALF_W, seatAnchor } from './seats-layout';
import { TextureStore, type ImageSource } from './textures';

export type { PickTarget } from './drag';

export interface TableRendererOptions {
  /** 名前のある操作を送る */
  onCommand(body: CommandBody): void;
  /** ドラッグ中の位置（約20Hzに間引いて呼ぶ） */
  onDragMove(objId: string, pos: Vec3): void;
  /** 右クリック。U8 がメニューを出す */
  onContextMenu(target: PickTarget, screen: { x: number; y: number }): void;
  /** 画像のハッシュから表示用の画像を返す。まだ無ければ undefined（読み込み中の見た目にする） */
  getImage(hash: string): ImageSource | undefined;
}

export interface TableRenderer {
  setView(view: View): void;
  setActiveSeat(seat: number): void;
  setSeatColors(colors: Record<number, string>): void;
  setRemoteDrag(objId: string, pos: Vec3): void;
  refreshImages(): void;
  /**
   * サイコロの動きの記録（U7: 卓の世界座標、位置は箱の中心）を実時間で再生する。
   * 再生中は View の値で上書きしない。止まった姿勢のまま、View の配置が追いつくのを待ってから通常の表示に戻す。
   */
  playDiceRoll(dieId: string, keyframes: number[]): void;
  /** この端末で使えるテクスチャの最大の辺（盤面の取り込みの上限に使う） */
  readonly maxTextureSize: number;
  dispose(): void;
}

/** 再生が終わってから、View の配置が止まった位置に追いつくのを待つ上限 */
const ROLL_SETTLE_MS = 1500;

/**
 * 記録の最後の姿勢を、卓の配置（位置・上向き軸の回転）と出目に直す。
 * 描画では root.rotation.y = rot、サイコロ本体に dieRotationFor(value) をかけるので、
 * 最後の回転 q ≈ R_y(rot)·C(value) となる rot を求める。
 */
export function dieRestPose(keyframes: number[]): { pos: Vec3; rot: number; value: number } {
  const n = keyframes.length - 8;
  const q = new THREE.Quaternion(keyframes[n + 4], keyframes[n + 5], keyframes[n + 6], keyframes[n + 7]).normalize();
  const value = topFaceOf(q);
  const c = new THREE.Quaternion().setFromEuler(dieRotationFor(value));
  const m = q.clone().multiply(c.invert());
  const v = new THREE.Vector3(1, 0, 0).applyQuaternion(m);
  return { pos: { x: keyframes[n + 1]!, y: 0, z: keyframes[n + 3]! }, rot: Math.atan2(-v.z, v.x), value };
}

// card-mesh.ts の DIE_FACE_VALUES と同じ並び（+x, -x, +y, -y, +z, -z）
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

/** 回転 q で上を向く面の目 */
function topFaceOf(q: THREE.Quaternion): number {
  let best = 0;
  let bestY = -Infinity;
  FACE_NORMALS.forEach((nv, i) => {
    const y = nv.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = i;
    }
  });
  return DIE_FACE_VALUES[best]!;
}

const DEFAULT_SEAT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#6d4c41'];
const DRAG_LIFT = 0.25;
const DRAG_SEND_MS = 50;
const CLICK_SLOP_PX = 4;

/** 描いている物1つ分 */
interface Entry {
  pick: PickTarget;
  root: THREE.Group;
  /** 補間で近づける位置と回転 */
  target: THREE.Vector3;
  targetRotY: number;
  targetTilt: number;
  /** root の子で、傾き（手札）をかける部分 */
  tiltNode: THREE.Object3D;
  /** 自分の材質（dispose 対象） */
  mats: THREE.MeshStandardMaterial[];
  card?: CardParts;
  stack?: StackParts;
  board?: THREE.MeshStandardMaterial;
  pieceKey?: string;
  die?: THREE.Mesh;
  label?: THREE.Sprite;
  /** テクスチャを貼り直すための情報 */
  tex: { top?: string; bottom?: string };
  visualH: number;
  /** サイコロの動きを再生中 */
  roll?: { kf: number[]; start: number; rest: { pos: Vec3; rot: number; value: number }; endedAt?: number };
}

export function createTableRenderer(container: HTMLElement, opts: TableRendererOptions): TableRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b2f36);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const rig = new CameraRig(camera, renderer.domElement);
  const textures = new TextureStore(opts.getImage, renderer.capabilities.getMaxAnisotropy());
  const pipMats = DIE_FACE_VALUES.map((n) => new THREE.MeshStandardMaterial({ map: textures.pip(n), roughness: 0.5 }));

  // 光
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 12, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  // 卓面と手札ラック
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x2e6b46, roughness: 0.95 });
  const tableGeo = new THREE.BoxGeometry(TABLE_HALF_W * 2 + 2, 0.3, TABLE_HALF_D * 2 + 2);
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.position.y = -0.15;
  table.receiveShadow = true;
  scene.add(table);
  const rackGeo = new THREE.BoxGeometry(RACK_WIDTH, 0.06, 0.35);
  const rackMats: THREE.MeshStandardMaterial[] = [];
  for (let s = 0; s < MAX_SEATS; s++) {
    const m = new THREE.MeshStandardMaterial({ color: 0x5d4632, roughness: 0.8 });
    rackMats.push(m);
    const rack = new THREE.Mesh(rackGeo, m);
    const a = seatAnchor(s);
    rack.position.set(a.pos.x, 0.03, a.pos.z);
    rack.rotation.y = a.facing;
    rack.receiveShadow = true;
    scene.add(rack);
  }

  const entries = new Map<string, Entry>();
  let view: View | undefined;
  let activeSeat = 0;
  const seatColors: Record<number, string> = {};
  DEFAULT_SEAT_COLORS.forEach((c, i) => (seatColors[i] = c));
  rig.goToSeat(activeSeat, false);

  // ---- 物の作成・更新 ----

  function newEntry(pick: PickTarget, content: THREE.Object3D, mats: THREE.MeshStandardMaterial[]): Entry {
    const root = new THREE.Group();
    const tiltNode = new THREE.Group();
    tiltNode.add(content);
    root.add(tiltNode);
    root.userData.entryId = pick.id;
    scene.add(root);
    return { pick, root, tiltNode, target: new THREE.Vector3(), targetRotY: 0, targetTilt: 0, mats, tex: {}, visualH: 0 };
  }

  function disposeEntry(e: Entry): void {
    scene.remove(e.root);
    for (const m of e.mats) m.dispose();
    if (e.label) e.label.material.dispose();
  }

  function applyTextures(e: Entry): void {
    if (e.card) {
      e.card.top.map = e.tex.top ? textures.get(e.tex.top) : null;
      e.card.bottom.map = e.tex.bottom ? textures.getTurned(e.tex.bottom) : null;
      e.card.top.needsUpdate = true;
      e.card.bottom.needsUpdate = true;
    }
    if (e.stack) {
      e.stack.top.map = e.tex.top ? textures.get(e.tex.top) : null;
      e.stack.top.needsUpdate = true;
    }
    if (e.board) {
      e.board.map = e.tex.top ? textures.get(e.tex.top) : null;
      e.board.needsUpdate = true;
    }
  }

  function setTex(e: Entry, top: string | undefined, bottom: string | undefined): void {
    if (e.tex.top === top && e.tex.bottom === bottom) return;
    e.tex = { top, bottom };
    applyTextures(e);
  }

  /** 新しく作った物はその場に置き、既にある物は補間で動かす */
  function place(e: Entry, isNew: boolean, pos: THREE.Vector3, rotY: number, tilt: number): void {
    if (dragging?.entry === e) return; // 自分が動かしている物は触らない
    e.target.copy(pos);
    e.targetRotY = rotY;
    e.targetTilt = tilt;
    if (isNew) {
      e.root.position.copy(pos);
      e.root.rotation.y = rotY;
      e.tiltNode.rotation.x = tilt;
    }
  }

  function setView(v: View): void {
    view = v;
    const seen = new Set<string>();

    // 手札の位置（並び順だけから計算）
    const handSlot = new Map<string, { seat: number; i: number; n: number }>();
    for (const [seatStr, ids] of Object.entries(v.hands)) {
      ids.forEach((id, i) => handSlot.set(id, { seat: Number(seatStr), i, n: ids.length }));
    }
    const layouts = new Map<number, ReturnType<typeof handLayout>>();

    for (const c of Object.values(v.cards)) {
      seen.add(c.id);
      const where = c.loc.type === 'hand' ? 'hand' : 'table';
      let e = entries.get(c.id);
      const isNew = !e || !e.card;
      if (isNew) {
        if (e) disposeEntry(e);
        const parts = createCardMesh();
        parts.mesh.position.y = CARD_T / 2;
        e = newEntry({ kind: 'card', id: c.id, where }, parts.mesh, [parts.top, parts.bottom]);
        e.card = parts;
        e.visualH = CARD_T;
        entries.set(c.id, e);
      }
      const ent = e!;
      if (c.loc.type === 'hand') {
        ent.pick = { kind: 'card', id: c.id, where: 'hand', handSeat: c.loc.seat };
        // 手札は両面とも、見えるなら表、見えないなら裏（見える人には表が見える R6）
        const h = c.face ? c.face.faceHash : c.backHash;
        setTex(ent, h, h);
        const slot = handSlot.get(c.id);
        const seat = slot?.seat ?? c.loc.seat;
        let lay = layouts.get(seat);
        if (!lay) {
          lay = handLayout(seat, v.hands[seat]?.length ?? 0);
          layouts.set(seat, lay);
        }
        const s = lay[slot?.i ?? 0];
        if (s) place(ent, isNew, new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z), s.rotY, s.tilt);
        // 立てたカードは中心の高さに置いているので、傾きの軸を中心にする
        ent.card!.mesh.position.y = 0;
      } else {
        ent.pick = { kind: 'card', id: c.id, where: 'table' };
        setTex(ent, c.face ? c.face.faceHash : c.backHash, c.backHash);
        const p = c.loc.placement;
        ent.card!.mesh.position.y = CARD_T / 2 + 0.002;
        place(ent, isNew, new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), p.rot, 0);
      }
    }

    for (const o of Object.values(v.objects)) {
      seen.add(o.id);
      let e = entries.get(o.id);
      let isNew = !e || e.pick.kind !== o.kind;
      if (o.kind === 'piece' && e && e.pieceKey !== `${o.shape}|${o.color}`) isNew = true;
      if (isNew) {
        if (e) disposeEntry(e);
        switch (o.kind) {
          case 'stack': {
            const parts = createStackMesh();
            e = newEntry({ kind: 'stack', id: o.id }, parts.mesh, [parts.top, parts.side]);
            e.stack = parts;
            break;
          }
          case 'board': {
            const b = createBoardMesh();
            b.mesh.position.y = 0.001;
            e = newEntry({ kind: 'board', id: o.id }, b.mesh, [b.mat]);
            e.board = b.mat;
            break;
          }
          case 'piece': {
            const p = createPieceMesh(o.shape, o.color);
            e = newEntry({ kind: 'piece', id: o.id }, p.group, [p.mat]);
            e.pieceKey = `${o.shape}|${o.color}`;
            e.visualH = 0.45;
            break;
          }
          case 'die': {
            const d = createDieMesh(pipMats);
            e = newEntry({ kind: 'die', id: o.id }, d, []);
            e.die = d;
            e.visualH = 0.4;
            break;
          }
        }
        entries.set(o.id, e!);
      }
      const ent = e!;
      switch (o.kind) {
        case 'stack': {
          const h = stackHeight(o.count);
          ent.stack!.mesh.scale.y = h;
          ent.stack!.mesh.position.y = h / 2 + 0.002;
          ent.visualH = h;
          setTex(ent, o.backHash, undefined);
          break;
        }
        case 'board': {
          ent.board!.color.set(0xffffff);
          ent.tiltNode.scale.set(o.width, 1, o.depth);
          setTex(ent, o.imageHash, undefined);
          break;
        }
        case 'die':
          // 再生中は出目の向きで上書きしない（止まったあとに合わせる）
          if (!ent.roll) ent.die!.rotation.copy(dieRotationFor(o.value));
          break;
        case 'piece':
          break;
      }
      const p = o.placement;
      place(ent, isNew, new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), p.rot, 0);
    }

    for (const [id, e] of entries) {
      if (!seen.has(id)) {
        if (dragging?.entry === e) dragging = undefined;
        disposeEntry(e);
        entries.delete(id);
      }
    }
    updateHeld();
  }

  /** つかまれている物に、つかんだ席の色と名札をつける */
  function updateHeld(): void {
    for (const [id, e] of entries) {
      const seat = view?.heldBy[id];
      const color = seat === undefined ? undefined : (seatColors[seat] ?? '#ffffff');
      for (const m of e.mats) {
        if (color) {
          m.emissive.set(color);
          m.emissiveIntensity = 0.35;
        } else m.emissive.set(0x000000);
      }
      if (seat !== undefined && color) {
        const tex = textures.label(`席${seat + 1}`, color);
        if (!e.label) {
          e.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
          e.label.scale.set(0.6, 0.225, 1);
          e.label.renderOrder = 10;
          e.root.add(e.label);
        } else if (e.label.material.map !== tex) {
          e.label.material.map = tex;
          e.label.material.needsUpdate = true;
        }
        e.label.position.y = e.visualH + 0.35;
      } else if (e.label) {
        e.root.remove(e.label);
        e.label.material.dispose();
        e.label = undefined;
      }
    }
  }

  // ---- 選択とドラッグ ----

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function setRay(ev: PointerEvent | MouseEvent): void {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function pickAt(ev: PointerEvent | MouseEvent, exclude?: Entry): Entry | undefined {
    setRay(ev);
    const roots = [...entries.values()].filter((e) => e !== exclude).map((e) => e.root);
    for (const hit of raycaster.intersectObjects(roots, true)) {
      if (hit.object instanceof THREE.Sprite) continue;
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.entryId === undefined) o = o.parent;
      const e = o ? entries.get(o.userData.entryId as string) : undefined;
      if (e) return e;
    }
    return undefined;
  }

  function planePoint(ev: PointerEvent): THREE.Vector3 | undefined {
    setRay(ev);
    return raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3()) ?? undefined;
  }

  function isDraggable(e: Entry): boolean {
    const p = e.pick;
    if (p.kind === 'card' && p.where === 'hand') return p.handSeat === activeSeat;
    return true;
  }

  let pressed:
    | { entry: Entry | undefined; x: number; y: number; button: number; pointerId: number }
    | undefined;
  let dragging:
    | { entry: Entry; offset: THREE.Vector3; baseY: number; lastSent: number; isHand: boolean }
    | undefined;

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0 && ev.button !== 2) return;
    pressed = { entry: ev.button === 0 ? pickAt(ev) : undefined, x: ev.clientX, y: ev.clientY, button: ev.button, pointerId: ev.pointerId };
  }

  function startDrag(ev: PointerEvent, e: Entry): void {
    const isHand = e.pick.kind === 'card' && e.pick.where === 'hand';
    const hit = planePoint(ev) ?? e.root.position.clone();
    const offset = isHand ? new THREE.Vector3() : e.root.position.clone().sub(hit).setY(0);
    const baseY = isHand ? 0 : e.target.y;
    e.roll = undefined;
    dragging = { entry: e, offset, baseY, lastSent: 0, isHand };
    renderer.domElement.setPointerCapture(ev.pointerId);
    if (!isHand) opts.onCommand({ type: 'grab', objId: e.pick.id });
    if (isHand) {
      // 卓に出す見た目にする（寝かせる）
      e.tiltNode.rotation.x = 0;
      e.card!.mesh.position.y = CARD_T / 2 + 0.002;
    }
  }

  function onPointerMove(ev: PointerEvent): void {
    if (pressed && pressed.button === 0 && !dragging && pressed.entry && isDraggable(pressed.entry)) {
      if (Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y) > CLICK_SLOP_PX) startDrag(ev, pressed.entry);
    }
    if (!dragging) return;
    const hit = planePoint(ev);
    if (!hit) return;
    const d = dragging;
    const pos = hit.add(d.offset);
    d.entry.root.position.set(pos.x, d.baseY + DRAG_LIFT, pos.z);
    d.entry.target.copy(d.entry.root.position);
    const now = performance.now();
    if (!d.isHand && now - d.lastSent >= DRAG_SEND_MS) {
      d.lastSent = now;
      opts.onDragMove(d.entry.pick.id, { x: pos.x, y: d.baseY, z: pos.z });
    }
  }

  function onPointerUp(ev: PointerEvent): void {
    const pr = pressed;
    pressed = undefined;
    if (dragging) {
      const d = dragging;
      dragging = undefined;
      if (renderer.domElement.hasPointerCapture(ev.pointerId)) renderer.domElement.releasePointerCapture(ev.pointerId);
      const pos: Vec3 = { x: d.entry.root.position.x, y: d.baseY, z: d.entry.root.position.z };
      d.entry.root.position.y = d.baseY;
      d.entry.target.set(pos.x, pos.y, pos.z);
      const over = pickAt(ev, d.entry);
      const cmds = resolveDrop({
        dragged: d.entry.pick,
        dropOn: over ? over.pick : null,
        overOwnRack: isOverRack(activeSeat, pos),
        pos,
      });
      if (d.isHand && cmds.length === 0 && view) setView(view); // ラックに戻したら元の位置へ
      for (const c of cmds) opts.onCommand(c);
      return;
    }
    if (!pr || pr.pointerId !== ev.pointerId) return;
    const moved = Math.hypot(ev.clientX - pr.x, ev.clientY - pr.y);
    if (moved > CLICK_SLOP_PX) return; // 視点の操作
    if (pr.button === 0 && pr.entry) {
      for (const c of resolveClick(pr.entry.pick)) opts.onCommand(c);
    } else if (pr.button === 2) {
      const e = pickAt(ev);
      if (e) opts.onContextMenu(e.pick, { x: ev.clientX, y: ev.clientY });
    }
  }

  function onDblClick(ev: MouseEvent): void {
    const e = pickAt(ev);
    if (e && e.pick.kind === 'card' && e.pick.where === 'table') opts.onCommand({ type: 'flip', cardId: e.pick.id });
  }

  function onContextMenu(ev: MouseEvent): void {
    ev.preventDefault();
  }

  const el = renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('dblclick', onDblClick);
  el.addEventListener('contextmenu', onContextMenu);

  // ---- 大きさと描画ループ ----

  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  /** 再生中のサイコロを1コマ進める。まだ再生（または待機）中なら true */
  function stepRoll(e: Entry, now: number): boolean {
    const r = e.roll!;
    if (r.endedAt === undefined) {
      const pose = samplePose(r.kf, (now - r.start) / 1000);
      e.root.position.set(pose.pos.x, pose.pos.y - DIE_SIZE / 2, pose.pos.z);
      e.root.rotation.y = 0;
      e.tiltNode.rotation.x = 0;
      e.die!.quaternion.set(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);
      if (!pose.done) return true;
      // 止まった: 同じ見た目のまま「配置の回転＋出目の向き」の形に置き換える
      r.endedAt = now;
      e.root.position.set(r.rest.pos.x, 0, r.rest.pos.z);
      e.root.rotation.y = r.rest.rot;
      e.die!.rotation.copy(dieRotationFor(r.rest.value));
    }
    // View の配置が止まった位置に追いつくまで（または上限まで）その場で待つ
    const o = view?.objects[e.pick.id];
    const caught = o !== undefined && Math.hypot(o.placement.pos.x - r.rest.pos.x, o.placement.pos.z - r.rest.pos.z) < 0.01;
    if (!caught && now - r.endedAt < ROLL_SETTLE_MS) return true;
    e.roll = undefined;
    if (o && o.kind === 'die') e.die!.rotation.copy(dieRotationFor(o.value));
    return false;
  }

  let last = performance.now();
  let raf = 0;
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 14);
    for (const e of entries.values()) {
      if (dragging?.entry === e) continue;
      if (e.roll && stepRoll(e, now)) continue;
      e.root.position.lerp(e.target, k);
      e.root.rotation.y += angleDelta(e.root.rotation.y, e.targetRotY) * k;
      e.tiltNode.rotation.x += (e.targetTilt - e.tiltNode.rotation.x) * k;
    }
    rig.update(dt);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    setView,
    setActiveSeat(seat) {
      if (seat === activeSeat) return;
      activeSeat = seat;
      rig.goToSeat(seat, true);
    },
    setSeatColors(colors) {
      for (const [k, c] of Object.entries(colors)) seatColors[Number(k)] = c;
      updateHeld();
    },
    setRemoteDrag(objId, pos) {
      const e = entries.get(objId);
      if (!e || dragging?.entry === e) return;
      e.target.set(pos.x, pos.y + DRAG_LIFT, pos.z);
    },
    refreshImages() {
      for (const e of entries.values()) applyTextures(e);
    },
    playDiceRoll(dieId, keyframes) {
      const e = entries.get(dieId);
      if (!e || !e.die || keyframes.length < 8) return;
      if (dragging?.entry === e) return;
      e.roll = { kf: keyframes, start: performance.now(), rest: dieRestPose(keyframes) };
    },
    maxTextureSize: renderer.capabilities.maxTextureSize,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('contextmenu', onContextMenu);
      for (const e of entries.values()) disposeEntry(e);
      entries.clear();
      for (const m of pipMats) m.dispose();
      for (const m of rackMats) m.dispose();
      rackGeo.dispose();
      tableGeo.dispose();
      tableMat.dispose();
      textures.dispose();
      disposeSharedGeometry();
      rig.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}

/** a から b へ回る最短の角度差 */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
