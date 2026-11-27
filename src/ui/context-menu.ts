// 右クリックメニュー。対象（卓上のカード、手札のカード、山札、駒、盤面、サイコロ）ごとに項目を出す。
// 項目の決定と実行は純粋な関数にして、テストできるようにする。
import type { CommandBody } from '../core/commands';
import type { View } from '../core/project';
import type { SeatId, Vec3 } from '../core/state';
import type { PickTarget } from '../render/drag';
import { seatLocalToWorld } from '../render/seats-layout';
import { h } from './dom';

export type MenuAction =
  | { kind: 'command'; body: CommandBody; /** 送る前に出す確認の文 */ confirm?: string }
  | { kind: 'deal'; stackId: string }
  | { kind: 'visibility'; cardId: string };

export interface MenuItem {
  label: string;
  action: MenuAction;
}

export interface MenuContext {
  /** 操作中の席（ホストは兼任中の席のこともある）。未着席なら null */
  activeSeat: SeatId | null;
  view: View | null;
}

const DELETE_CONFIRM = '卓から消します。元に戻せません。よろしいですか？';

function del(id: string): MenuItem {
  return { label: '消す', action: { kind: 'command', body: { type: 'delete', objId: id }, confirm: DELETE_CONFIRM } };
}

/** 手札から卓に出す位置: 席の手前、卓の内側。 */
export function playPosition(seat: SeatId): Vec3 {
  return seatLocalToWorld(seat, 0, 0, -1.6);
}

/** 山札の横（山から卓に出す位置）。 */
function besideStack(view: View | null, stackId: string): Vec3 {
  const o = view?.objects[stackId];
  const p = o?.placement.pos ?? { x: 0, y: 0, z: 0 };
  return { x: p.x + 0.9, y: 0, z: p.z };
}

export function contextMenuItems(target: PickTarget, ctx: MenuContext): MenuItem[] {
  const id = target.id;
  switch (target.kind) {
    case 'card':
      if (target.where === 'table') {
        return [
          { label: '裏返す', action: { kind: 'command', body: { type: 'flip', cardId: id } } },
          { label: '手札に取る', action: { kind: 'command', body: { type: 'toHand', cardId: id } } },
          del(id),
        ];
      }
      // 手札のカードは、操作中の席の手札だけ
      if (ctx.activeSeat === null || target.handSeat !== ctx.activeSeat) return [];
      return [
        {
          label: '卓に出す（表）',
          action: { kind: 'command', body: { type: 'play', cardId: id, pos: playPosition(ctx.activeSeat), faceUp: true } },
        },
        {
          label: '卓に出す（裏）',
          action: { kind: 'command', body: { type: 'play', cardId: id, pos: playPosition(ctx.activeSeat), faceUp: false } },
        },
        { label: '見える人を変える', action: { kind: 'visibility', cardId: id } },
      ];
    case 'stack':
      return [
        { label: '1枚引く', action: { kind: 'command', body: { type: 'draw', stackId: id, count: 1 } } },
        { label: 'シャッフル', action: { kind: 'command', body: { type: 'shuffle', stackId: id } } },
        { label: '配る', action: { kind: 'deal', stackId: id } },
        {
          label: '裏向きで1枚卓に出す',
          action: { kind: 'command', body: { type: 'drawToTable', stackId: id, pos: besideStack(ctx.view, id) } },
        },
        del(id),
      ];
    case 'die':
      return [{ label: '振る', action: { kind: 'command', body: { type: 'roll', dieId: id } } }, del(id)];
    case 'piece':
    case 'board':
      return [del(id)];
  }
}

export interface MenuDeps {
  confirm(message: string): Promise<boolean> | boolean;
  send(body: CommandBody): void;
  openDeal(stackId: string): void;
  openVisibility(cardId: string): void;
}

/** 項目を実行する。確認つきの操作は、確認で取り消されたら何も送らない（R23）。 */
export async function runMenuAction(action: MenuAction, deps: MenuDeps): Promise<void> {
  switch (action.kind) {
    case 'command':
      if (action.confirm !== undefined && !(await deps.confirm(action.confirm))) return;
      deps.send(action.body);
      return;
    case 'deal':
      deps.openDeal(action.stackId);
      return;
    case 'visibility':
      deps.openVisibility(action.cardId);
      return;
  }
}

let openMenu: HTMLElement | null = null;

export function closeContextMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

/** 画面上の位置にメニューを出す。項目を選ぶと onPick を呼ぶ。 */
export function showContextMenu(items: MenuItem[], screen: { x: number; y: number }, onPick: (item: MenuItem) => void): void {
  closeContextMenu();
  if (items.length === 0) return;
  const menu = h('div', { class: 'context-menu', role: 'menu' });
  for (const it of items) {
    const b = h('button', { type: 'button', role: 'menuitem', class: it.label === '消す' ? 'danger' : '' }, it.label);
    b.addEventListener('click', () => {
      closeContextMenu();
      onPick(it);
    });
    menu.append(b);
  }
  menu.style.left = `${screen.x}px`;
  menu.style.top = `${screen.y}px`;
  document.body.append(menu);
  // 画面からはみ出さないように寄せる
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
  openMenu = menu;
  const dismiss = (ev: Event): void => {
    if (ev instanceof KeyboardEvent && ev.key !== 'Escape') return;
    if (ev.target instanceof Node && menu.contains(ev.target)) return;
    closeContextMenu();
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', dismiss, true);
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
  }, 0);
}
