// 離した場所・クリックから送る操作を決める。three.js を参照しない純粋な関数（KTD10）。
import type { CommandBody } from '../core/commands';
import type { Vec3 } from '../core/state';

export type PickTarget =
  | { kind: 'card'; id: string; where: 'table' | 'hand'; handSeat?: number }
  | { kind: 'stack' | 'piece' | 'die' | 'board'; id: string };

/** 重ねられる先か（山札か卓上のカード） */
function isStackTarget(t: PickTarget | null, selfId: string): t is PickTarget {
  if (!t || t.id === selfId) return false;
  return t.kind === 'stack' || (t.kind === 'card' && t.where === 'table');
}

export function resolveDrop(args: {
  dragged: PickTarget;
  dropOn: PickTarget | null;
  overOwnRack: boolean;
  pos: Vec3;
}): CommandBody[] {
  const { dragged, dropOn, overOwnRack, pos } = args;
  const id = dragged.id;

  // 手札のカード: つかみは使わない
  if (dragged.kind === 'card' && dragged.where === 'hand') {
    if (overOwnRack) return [];
    if (isStackTarget(dropOn, id)) return [{ type: 'stack', objId: id, targetId: dropOn.id }];
    return [{ type: 'play', cardId: id, pos: { ...pos } }];
  }

  const out: CommandBody[] = [];
  const stackable = dragged.kind === 'card' || dragged.kind === 'stack';
  if (stackable && isStackTarget(dropOn, id)) {
    out.push({ type: 'stack', objId: id, targetId: dropOn.id });
  } else if (dragged.kind === 'card' && overOwnRack) {
    out.push({ type: 'toHand', cardId: id });
  } else {
    out.push({ type: 'move', objId: id, pos: { ...pos } });
  }
  out.push({ type: 'release', objId: id });
  return out;
}

/** ドラッグせずにクリックしたとき */
export function resolveClick(target: PickTarget): CommandBody[] {
  if (target.kind === 'stack') return [{ type: 'draw', stackId: target.id, count: 1 }];
  return [];
}
