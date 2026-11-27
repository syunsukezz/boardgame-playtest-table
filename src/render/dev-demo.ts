// 3D の卓の単独デモ（開発用）。import すると document.body に卓を出す。
// 操作はその場で apply して、操作中の席の視点で切り出し直す。数字キー 1〜8 で席を切り替える。
import { apply } from '../core/apply';
import type { CommandBody, NewCardSpec } from '../core/commands';
import { project } from '../core/project';
import { seededRng } from '../core/rng';
import { emptyState, type TableState } from '../core/state';
import { createTableRenderer } from './scene';

const images = new Map<string, HTMLCanvasElement>();

function paint(hash: string, w: number, h: number, bg: string, text: string): void {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(w / 5)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  ctx.font = `bold ${Math.round(w / 10)}px sans-serif`;
  ctx.fillText('▲', w / 2, h * 0.12);
  images.set(hash, c);
}

paint('demo-back', 256, 358, '#3949ab', '◆');
const specs: NewCardSpec[] = [];
for (let i = 1; i <= 30; i++) {
  const hash = `demo-face-${i}`;
  paint(hash, 256, 358, `hsl(${(i * 37) % 360} 55% 42%)`, String(i));
  specs.push({ faceHash: hash, backHash: 'demo-back', name: `カード${i}` });
}
paint('demo-board', 1024, 768, '#8d6e63', 'BOARD');

const rng = seededRng(42);
let state: TableState = emptyState();
let seat = 0;
let n = 0;

function run(body: CommandBody, as = seat): boolean {
  const r = apply(state, { ...body, seat: as, cmdId: `demo-${++n}` }, rng);
  if (!r.ok) {
    console.warn('[dev-demo] apply 失敗', body, r.error);
    return false;
  }
  state = r.state;
  return true;
}

run({ type: 'spawnDeck', cards: specs, placement: { pos: { x: -1.5, y: 0, z: 0 }, rot: 0 } });
const deckId = Object.keys(state.objects)[0]!;
run({ type: 'shuffle', stackId: deckId });
run({ type: 'deal', stackId: deckId, count: 5, seats: [0, 1], visibility: 'recipient' });
run({ type: 'deal', stackId: deckId, count: 3, seats: [2], visibility: 'others' });
run({ type: 'drawToTable', stackId: deckId, pos: { x: 0, y: 0, z: 1 } });
run({ type: 'spawnBoard', imageHash: 'demo-board', width: 4, depth: 3, placement: { pos: { x: 2.8, y: 0, z: -1 }, rot: 0 } });
run({ type: 'spawnPiece', shape: 'pawn', color: '#e53935', placement: { pos: { x: 2, y: 0, z: -0.5 }, rot: 0 } });
run({ type: 'spawnPiece', shape: 'cube', color: '#1e88e5', placement: { pos: { x: 2.6, y: 0, z: -0.5 }, rot: 0 } });
run({ type: 'spawnPiece', shape: 'disc', color: '#fdd835', placement: { pos: { x: 3.2, y: 0, z: -0.5 }, rot: 0 } });
run({ type: 'spawnPiece', shape: 'cone', color: '#43a047', placement: { pos: { x: 3.8, y: 0, z: -0.5 }, rot: 0 } });
run({ type: 'spawnDie', placement: { pos: { x: -3, y: 0, z: 1 }, rot: 0.3 } });
// 席1がつかんでいる見た目の確認用
const pawnId = Object.values(state.objects).find((o) => o.kind === 'piece')!.id;
run({ type: 'grab', objId: pawnId }, 1);

const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;';
document.body.style.margin = '0';
document.body.appendChild(host);

const badge = document.createElement('div');
badge.style.cssText =
  'position:fixed;left:12px;top:12px;padding:6px 10px;background:#000a;color:#fff;font:14px sans-serif;border-radius:6px;pointer-events:none;';
document.body.appendChild(badge);

const renderer = createTableRenderer(host, {
  onCommand(body) {
    if (run(body)) refresh();
  },
  onDragMove() {},
  onContextMenu(target, screen) {
    console.log('[dev-demo] 右クリック', target, screen);
  },
  getImage: (hash) => images.get(hash),
});

function refresh(): void {
  renderer.setView(project(state, { kind: 'seat', seat }));
  badge.textContent = `席${seat + 1}として操作中（数字キー 1〜8 で切り替え）`;
}
refresh();

window.addEventListener('keydown', (ev) => {
  const k = Number(ev.key);
  if (Number.isInteger(k) && k >= 1 && k <= 8) {
    seat = k - 1;
    renderer.setActiveSeat(seat);
    refresh();
  }
});
