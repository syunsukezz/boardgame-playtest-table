// 卓の状態を変える唯一の関数（KTD2）。ホストだけが呼ぶ。
// 元の状態は変えず、新しい状態とログの出来事を返す。
import type { ApplyError, Command, DealVisibility, LogEvent } from './commands';
import { randomId, randomInt, shuffleInPlace, type Rng } from './rng';
import {
  MAX_SEATS,
  isSeatId,
  normalizeSeats,
  type Card,
  type CardLocation,
  type ObjectId,
  type Placement,
  type SeatId,
  type Stack,
  type TableState,
  type Vec3,
  type Visibility,
} from './state';

export type ApplyResult =
  | { ok: true; state: TableState; log: LogEvent[] }
  | { ok: false; error: ApplyError };

const RECENT_CMD_LIMIT = 256;

class ApplyFailure extends Error {
  constructor(readonly code: ApplyError) {
    super(code);
  }
}

function fail(code: ApplyError): never {
  throw new ApplyFailure(code);
}

export function apply(prev: TableState, cmd: Command, rng: Rng): ApplyResult {
  if (prev.recentCmdIds.includes(cmd.cmdId)) return { ok: false, error: 'duplicate' };
  const state = structuredClone(prev);
  const log: LogEvent[] = [];
  try {
    run(state, cmd, rng, log);
  } catch (e) {
    if (e instanceof ApplyFailure) return { ok: false, error: e.code };
    throw e;
  }
  state.rev = prev.rev + 1;
  state.recentCmdIds.push(cmd.cmdId);
  if (state.recentCmdIds.length > RECENT_CMD_LIMIT) state.recentCmdIds.shift();
  return { ok: true, state, log };
}

function run(state: TableState, cmd: Command, rng: Rng, log: LogEvent[]): void {
  const seat = cmd.seat;
  switch (cmd.type) {
    case 'grab': {
      requireMovable(state, cmd.objId);
      ensureNotHeldByOther(state, cmd.objId, seat);
      state.heldBy[cmd.objId] = seat;
      return;
    }
    case 'release': {
      if (state.heldBy[cmd.objId] === seat) delete state.heldBy[cmd.objId];
      return;
    }
    case 'move': {
      ensureNotHeldByOther(state, cmd.objId, seat);
      placementOf(state, cmd.objId).pos = { ...cmd.pos };
      return;
    }
    case 'rotate': {
      ensureNotHeldByOther(state, cmd.objId, seat);
      placementOf(state, cmd.objId).rot = cmd.rot;
      return;
    }
    case 'flip': {
      ensureNotHeldByOther(state, cmd.cardId, seat);
      const card = requireCard(state, cmd.cardId);
      if (card.loc.type !== 'table') fail('invalid-target');
      card.loc.faceUp = !card.loc.faceUp;
      return;
    }
    case 'stack': {
      ensureNotHeldByOther(state, cmd.objId, seat);
      ensureNotHeldByOther(state, cmd.targetId, seat);
      if (cmd.objId === cmd.targetId) fail('invalid-target');
      const source = state.cards[cmd.objId];
      if (source) ensureOwnHand(source, seat);
      const target = resolveStackTarget(state, cmd.targetId, rng);
      const moving = takeForStacking(state, cmd.objId);
      for (const id of moving) {
        state.cards[id]!.loc = { type: 'stack', stackId: target.id };
        target.cardIds.push(id);
      }
      return;
    }
    case 'draw': {
      requirePositiveInt(cmd.count);
      ensureNotHeldByOther(state, cmd.stackId, seat);
      const stack = requireStack(state, cmd.stackId);
      let drawn = 0;
      for (let i = 0; i < cmd.count; i++) {
        const id = popTop(state, stack);
        if (!id) break;
        addToHand(state, id, seat, { kind: 'seats', seats: [seat] });
        drawn++;
      }
      if (drawn === 0) fail('invalid-target');
      log.push({ type: 'draw', seat, count: drawn });
      return;
    }
    case 'toHand': {
      ensureNotHeldByOther(state, cmd.cardId, seat);
      const card = requireCard(state, cmd.cardId);
      if (card.loc.type !== 'table') fail('invalid-target');
      delete state.heldBy[card.id];
      addToHand(state, card.id, seat, { kind: 'seats', seats: [seat] });
      return;
    }
    case 'play': {
      const card = requireCard(state, cmd.cardId);
      if (card.loc.type !== 'hand') fail('invalid-target');
      ensureOwnHand(card, seat);
      removeFromHand(state, card);
      const faceUp = cmd.faceUp ?? true;
      card.loc = tableLoc(cmd.pos, faceUp);
      log.push({ type: 'play', seat, cardId: card.id, faceUp });
      return;
    }
    case 'drawToTable': {
      ensureNotHeldByOther(state, cmd.stackId, seat);
      const stack = requireStack(state, cmd.stackId);
      const id = popTop(state, stack);
      if (!id) fail('invalid-target');
      state.cards[id]!.loc = tableLoc(cmd.pos, false);
      return;
    }
    case 'shuffle': {
      ensureNotHeldByOther(state, cmd.stackId, seat);
      const stack = requireStack(state, cmd.stackId);
      shuffleInPlace(stack.cardIds, rng);
      // 並び順を前の ID と結びつけられないよう、ID を振り直す（KTD3）。
      stack.cardIds = stack.cardIds.map((oldId) => {
        const card = state.cards[oldId]!;
        delete state.cards[oldId];
        const newId = uniqueId(state, rng);
        state.cards[newId] = { ...card, id: newId };
        return newId;
      });
      log.push({ type: 'shuffle', seat, stackId: stack.id, count: stack.cardIds.length });
      return;
    }
    case 'deal': {
      requirePositiveInt(cmd.count);
      if (!Array.isArray(cmd.seats) || cmd.seats.length === 0 || cmd.seats.some((s) => !isSeatId(s))) fail('invalid-args');
      ensureNotHeldByOther(state, cmd.stackId, seat);
      const stack = requireStack(state, cmd.stackId);
      const wanted = cmd.count * cmd.seats.length;
      let dealt = 0;
      outer: for (let round = 0; round < cmd.count; round++) {
        for (const to of cmd.seats) {
          const id = popTop(state, stack);
          if (!id) break outer;
          addToHand(state, id, to, dealVisibility(cmd.visibility, to));
          dealt++;
        }
      }
      log.push({ type: 'deal', seat, count: dealt, seats: [...cmd.seats], shortfall: wanted - dealt });
      return;
    }
    case 'setVisibility': {
      const card = requireCard(state, cmd.cardId);
      if (card.loc.type !== 'hand') fail('invalid-target');
      ensureOwnHand(card, seat);
      card.loc.visibility = normalizeVisibility(cmd.visibility);
      log.push({ type: 'setVisibility', seat, cardId: card.id });
      return;
    }
    case 'roll': {
      ensureNotHeldByOther(state, cmd.dieId, seat);
      const die = state.objects[cmd.dieId];
      if (!die || die.kind !== 'die') fail('not-found');
      const value = cmd.outcome?.value ?? 1 + randomInt(rng, 6);
      if (!Number.isInteger(value) || value < 1 || value > 6) fail('invalid-args');
      die.value = value;
      // 転がって止まった位置と向き。無ければ元の場所のまま。
      if (cmd.outcome?.rest) die.placement = clonePlacement(cmd.outcome.rest);
      log.push({ type: 'roll', seat, dieId: die.id, value });
      return;
    }
    case 'spawnDeck': {
      if (cmd.cards.length === 0) fail('invalid-args');
      const stack: Stack = {
        id: uniqueId(state, rng),
        kind: 'stack',
        placement: clonePlacement(cmd.placement),
        cardIds: [],
        backHash: cmd.cards[0]!.backHash,
      };
      state.objects[stack.id] = stack;
      for (const spec of cmd.cards) {
        const id = uniqueId(state, rng);
        state.cards[id] = { id, ...spec, loc: { type: 'stack', stackId: stack.id } };
        stack.cardIds.push(id);
      }
      return;
    }
    case 'spawnBoard': {
      const id = uniqueId(state, rng);
      state.objects[id] = {
        id,
        kind: 'board',
        imageHash: cmd.imageHash,
        width: cmd.width,
        depth: cmd.depth,
        placement: clonePlacement(cmd.placement),
      };
      return;
    }
    case 'spawnPiece': {
      const id = uniqueId(state, rng);
      state.objects[id] = { id, kind: 'piece', shape: cmd.shape, color: cmd.color, placement: clonePlacement(cmd.placement) };
      return;
    }
    case 'spawnDie': {
      const id = uniqueId(state, rng);
      state.objects[id] = { id, kind: 'die', placement: clonePlacement(cmd.placement), value: 1 };
      return;
    }
    case 'delete': {
      ensureNotHeldByOther(state, cmd.objId, seat);
      const card = state.cards[cmd.objId];
      if (card) {
        ensureOwnHand(card, seat);
        if (card.loc.type === 'hand') removeFromHand(state, card);
        if (card.loc.type === 'stack') removeFromStack(state, card);
        delete state.cards[card.id];
      } else {
        const obj = state.objects[cmd.objId];
        if (!obj) fail('not-found');
        if (obj.kind === 'stack') for (const id of obj.cardIds) delete state.cards[id];
        delete state.objects[obj.id];
      }
      delete state.heldBy[cmd.objId];
      return;
    }
  }
}

/** 枚数などの1以上の整数。違えば invalid-args。 */
function requirePositiveInt(n: number): void {
  if (!Number.isInteger(n) || n < 1) fail('invalid-args');
}

/** 卓上の場所（回転なし）。 */
function tableLoc(pos: Vec3, faceUp: boolean): CardLocation {
  return { type: 'table', placement: { pos: { ...pos }, rot: 0 }, faceUp };
}

function dealVisibility(v: DealVisibility, to: SeatId): Visibility {
  switch (v) {
    case 'recipient':
      return { kind: 'seats', seats: [to] };
    case 'others': {
      const seats: SeatId[] = [];
      for (let s = 0; s < MAX_SEATS; s++) if (s !== to) seats.push(s);
      return { kind: 'seats', seats };
    }
    case 'none':
      return { kind: 'none' };
    case 'all':
      return { kind: 'all' };
    default:
      // 型の外の値（壊れた操作）。ホストの検証をすり抜けても状態を壊さない。
      return fail('invalid-args');
  }
}

function normalizeVisibility(v: Visibility): Visibility {
  if (typeof v !== 'object' || v === null) fail('invalid-args');
  if (v.kind === 'all' || v.kind === 'none') return { kind: v.kind };
  if (v.kind !== 'seats' || !Array.isArray(v.seats)) fail('invalid-args');
  const seats = normalizeSeats(v.seats);
  if (seats.length === 0) return { kind: 'none' };
  return { kind: 'seats', seats };
}

function uniqueId(state: TableState, rng: Rng): ObjectId {
  for (;;) {
    const id = randomId(rng);
    if (!state.cards[id] && !state.objects[id]) return id;
  }
}

function clonePlacement(p: Placement): Placement {
  return { pos: { ...p.pos }, rot: p.rot };
}

function ensureNotHeldByOther(state: TableState, id: ObjectId, seat: SeatId): void {
  const holder = state.heldBy[id];
  if (holder !== undefined && holder !== seat) fail('held-by-other');
}

/** 手札のカードは持ち主の席だけが操作できる（隠れた手札を他の席が覗けないように）。 */
function ensureOwnHand(card: Card, seat: SeatId): void {
  if (card.loc.type === 'hand' && card.loc.seat !== seat) fail('not-your-card');
}

function requireCard(state: TableState, id: ObjectId): Card {
  const card = state.cards[id];
  if (!card) fail('not-found');
  return card;
}

function requireStack(state: TableState, id: ObjectId): Stack {
  const obj = state.objects[id];
  if (!obj) fail('not-found');
  if (obj.kind !== 'stack') fail('invalid-target');
  return obj;
}

/** 卓上で動かせる物（卓上のカードと卓上の物）か。 */
function requireMovable(state: TableState, id: ObjectId): void {
  const card = state.cards[id];
  if (card) {
    if (card.loc.type !== 'table') fail('invalid-target');
    return;
  }
  if (!state.objects[id]) fail('not-found');
}

function placementOf(state: TableState, id: ObjectId): Placement {
  const card = state.cards[id];
  if (card) {
    if (card.loc.type !== 'table') fail('invalid-target');
    return card.loc.placement;
  }
  const obj = state.objects[id];
  if (!obj) fail('not-found');
  return obj.placement;
}

/** 山札の一番上を取り出す。空になった山札は卓から消す。 */
function popTop(state: TableState, stack: Stack): ObjectId | undefined {
  const id = stack.cardIds.pop();
  if (stack.cardIds.length === 0) {
    delete state.objects[stack.id];
    delete state.heldBy[stack.id];
  }
  return id;
}

function addToHand(state: TableState, id: ObjectId, seat: SeatId, visibility: Visibility): void {
  state.cards[id]!.loc = { type: 'hand', seat, visibility };
  state.hands[seat]!.push(id);
}

function removeFromHand(state: TableState, card: Card): void {
  if (card.loc.type !== 'hand') return;
  const hand = state.hands[card.loc.seat]!;
  const i = hand.indexOf(card.id);
  if (i >= 0) hand.splice(i, 1);
}

function removeFromStack(state: TableState, card: Card): void {
  if (card.loc.type !== 'stack') return;
  const stack = state.objects[card.loc.stackId];
  if (!stack || stack.kind !== 'stack') return;
  const i = stack.cardIds.indexOf(card.id);
  if (i >= 0) stack.cardIds.splice(i, 1);
  if (stack.cardIds.length === 0) delete state.objects[stack.id];
}

/** 重ね先。卓上のカードなら、その位置に新しい山札を作ってカードを入れる。 */
function resolveStackTarget(state: TableState, targetId: ObjectId, rng: Rng): Stack {
  const obj = state.objects[targetId];
  if (obj) {
    if (obj.kind !== 'stack') fail('invalid-target');
    return obj;
  }
  const card = state.cards[targetId];
  if (!card) fail('not-found');
  if (card.loc.type !== 'table') fail('invalid-target');
  const stack: Stack = {
    id: uniqueId(state, rng),
    kind: 'stack',
    placement: clonePlacement(card.loc.placement),
    cardIds: [card.id],
    backHash: card.backHash,
  };
  state.objects[stack.id] = stack;
  card.loc = { type: 'stack', stackId: stack.id };
  delete state.heldBy[card.id];
  return stack;
}

/** 重ねるために、卓上のカード・手札のカード・山札から、カードを取り出す（下から順）。 */
function takeForStacking(state: TableState, id: ObjectId): ObjectId[] {
  const card = state.cards[id];
  if (card) {
    if (card.loc.type === 'hand') removeFromHand(state, card);
    else if (card.loc.type !== 'table') fail('invalid-target');
    delete state.heldBy[id];
    return [id];
  }
  const obj = state.objects[id];
  if (!obj) fail('not-found');
  if (obj.kind !== 'stack') fail('invalid-target');
  delete state.objects[id];
  delete state.heldBy[id];
  return obj.cardIds;
}
