// 全状態から、ある席（または未着席の参加者）に送ってよい部分だけを切り出す（KTD3）。
// 参加者へ状態を渡す道はこの関数だけにする。スナップショットにも差分にも同じ結果を使う。
import type { Board, Card, Die, ObjectId, Piece, Placement, SeatId, TableState } from './state';

/** 誰の目で見るか。spectator は席に座っていない接続中の参加者。 */
export type Viewer = { kind: 'seat'; seat: SeatId } | { kind: 'spectator' };

export type ViewCardLoc =
  | { type: 'table'; placement: Placement; faceUp: boolean }
  | { type: 'hand'; seat: SeatId };

export interface ViewCard {
  id: ObjectId;
  backHash: string;
  loc: ViewCardLoc;
  /** 見えるときだけ入る。見えないカードには中身も画像のハッシュも入れない。 */
  face?: { faceHash: string; name: string };
}

/** 山札は枚数と裏面だけ。中のカードは送らない。 */
export interface ViewStack {
  id: ObjectId;
  kind: 'stack';
  placement: Placement;
  count: number;
  backHash: string;
}

export type ViewObject = ViewStack | Piece | Die | Board;

export interface View {
  rev: number;
  cards: Record<ObjectId, ViewCard>;
  objects: Record<ObjectId, ViewObject>;
  hands: Record<SeatId, ObjectId[]>;
  heldBy: Record<ObjectId, SeatId>;
}

/** カードがこの視点から見えるか（R5）。 */
export function canSeeCard(card: Card, viewer: Viewer): boolean {
  const loc = card.loc;
  switch (loc.type) {
    case 'stack':
      return false;
    case 'table':
      return loc.faceUp;
    case 'hand':
      if (loc.visibility.kind === 'all') return true;
      if (loc.visibility.kind === 'none') return false;
      return viewer.kind === 'seat' && loc.visibility.seats.includes(viewer.seat);
  }
}

export function project(state: TableState, viewer: Viewer): View {
  const cards: Record<ObjectId, ViewCard> = {};
  for (const card of Object.values(state.cards)) {
    if (card.loc.type === 'stack') continue;
    const loc: ViewCardLoc =
      card.loc.type === 'table'
        ? { type: 'table', placement: structuredClone(card.loc.placement), faceUp: card.loc.faceUp }
        : { type: 'hand', seat: card.loc.seat };
    const vc: ViewCard = { id: card.id, backHash: card.backHash, loc };
    if (canSeeCard(card, viewer)) vc.face = { faceHash: card.faceHash, name: card.name };
    cards[card.id] = vc;
  }

  const objects: Record<ObjectId, ViewObject> = {};
  for (const obj of Object.values(state.objects)) {
    if (obj.kind === 'stack') {
      objects[obj.id] = {
        id: obj.id,
        kind: 'stack',
        placement: structuredClone(obj.placement),
        count: obj.cardIds.length,
        backHash: obj.backHash,
      };
    } else {
      objects[obj.id] = structuredClone(obj);
    }
  }

  return {
    rev: state.rev,
    cards,
    objects,
    hands: structuredClone(state.hands),
    heldBy: { ...state.heldBy },
  };
}
