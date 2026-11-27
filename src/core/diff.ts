// 切り出し結果（View）同士の差分。席ごとに project した結果どうしで作るので、
// 差分にも見えない情報は入らない（KTD3）。
import type { ObjectId, SeatId } from './state';
import type { View, ViewCard, ViewObject } from './project';

export interface ViewPatch {
  rev: number;
  setCards: Record<ObjectId, ViewCard>;
  removeCards: ObjectId[];
  setObjects: Record<ObjectId, ViewObject>;
  removeObjects: ObjectId[];
  /** 変わった席の手札の並び順だけ。 */
  hands: Record<SeatId, ObjectId[]>;
  heldBy: Record<ObjectId, SeatId>;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffViews(prev: View, next: View): ViewPatch {
  const patch: ViewPatch = {
    rev: next.rev,
    setCards: {},
    removeCards: [],
    setObjects: {},
    removeObjects: [],
    hands: {},
    heldBy: { ...next.heldBy },
  };
  for (const [id, card] of Object.entries(next.cards)) if (!same(prev.cards[id], card)) patch.setCards[id] = card;
  for (const id of Object.keys(prev.cards)) if (!next.cards[id]) patch.removeCards.push(id);
  for (const [id, obj] of Object.entries(next.objects)) if (!same(prev.objects[id], obj)) patch.setObjects[id] = obj;
  for (const id of Object.keys(prev.objects)) if (!next.objects[id]) patch.removeObjects.push(id);
  for (const [seat, ids] of Object.entries(next.hands)) {
    if (!same(prev.hands[Number(seat)], ids)) patch.hands[Number(seat)] = [...ids];
  }
  return patch;
}

export function applyPatch(view: View, patch: ViewPatch): View {
  const next: View = structuredClone(view);
  next.rev = patch.rev;
  for (const id of patch.removeCards) delete next.cards[id];
  for (const [id, card] of Object.entries(patch.setCards)) next.cards[id] = structuredClone(card);
  for (const id of patch.removeObjects) delete next.objects[id];
  for (const [id, obj] of Object.entries(patch.setObjects)) next.objects[id] = structuredClone(obj);
  for (const [seat, ids] of Object.entries(patch.hands)) next.hands[Number(seat)] = [...ids];
  next.heldBy = { ...patch.heldBy };
  return next;
}

export function isEmptyPatch(p: ViewPatch, prev: View): boolean {
  return (
    Object.keys(p.setCards).length === 0 &&
    p.removeCards.length === 0 &&
    Object.keys(p.setObjects).length === 0 &&
    p.removeObjects.length === 0 &&
    Object.keys(p.hands).length === 0 &&
    same(p.heldBy, prev.heldBy)
  );
}
