import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/apply';
import type { Command, CommandBody } from '../../src/core/commands';
import { seededRng } from '../../src/core/rng';
import { emptyState, type Stack, type TableState } from '../../src/core/state';

let cmdCounter = 0;
function cmd(seat: number, body: CommandBody): Command {
  return { ...body, seat, cmdId: `c${cmdCounter++}` } as Command;
}

function run(state: TableState, seat: number, body: CommandBody, seed = 1) {
  const r = apply(state, cmd(seat, body), seededRng(seed));
  if (!r.ok) throw new Error(`apply failed: ${r.error}`);
  return r;
}

const origin = { pos: { x: 0, y: 0, z: 0 }, rot: 0 };

/** n 枚の山札を1つ置いた状態と、その山札の ID を返す。 */
function withDeck(n: number): { state: TableState; stackId: string } {
  const cards = Array.from({ length: n }, (_, i) => ({ faceHash: `face${i}`, backHash: 'back', name: `カード${i}` }));
  const r = run(emptyState(), 0, { type: 'spawnDeck', cards, placement: origin });
  const stackId = Object.values(r.state.objects).find((o) => o.kind === 'stack')!.id;
  return { state: r.state, stackId };
}

function stackOf(state: TableState, id: string): Stack {
  return state.objects[id] as Stack;
}

function faces(state: TableState, ids: string[]): string[] {
  return ids.map((id) => state.cards[id]!.faceHash);
}

describe('シャッフル', () => {
  it('同じ乱数の初期値なら同じ順番になり、カードの集合は変わらない', () => {
    const { state, stackId } = withDeck(10);
    const a = run(state, 0, { type: 'shuffle', stackId }, 42).state;
    const b = run(state, 0, { type: 'shuffle', stackId }, 42).state;
    const fa = faces(a, stackOf(a, stackId).cardIds);
    expect(fa).toEqual(faces(b, stackOf(b, stackId).cardIds));
    expect([...fa].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `face${i}`).sort());
    expect(fa).not.toEqual(Array.from({ length: 10 }, (_, i) => `face${i}`));
  });

  it('シャッフルするとカード ID が振り直される', () => {
    const { state, stackId } = withDeck(5);
    const before = new Set(stackOf(state, stackId).cardIds);
    const after = run(state, 0, { type: 'shuffle', stackId }).state;
    for (const id of stackOf(after, stackId).cardIds) expect(before.has(id)).toBe(false);
  });

  it('Covers AE7. 表向きのカードを重ねた山札をシャッフルすると、全カードが山札の中（誰にも見えない）になる', () => {
    let { state, stackId } = withDeck(3);
    state = run(state, 0, { type: 'drawToTable', stackId, pos: { x: 1, y: 0, z: 0 } }).state;
    const tableCard = Object.values(state.cards).find((c) => c.loc.type === 'table')!;
    state = run(state, 0, { type: 'flip', cardId: tableCard.id }).state;
    state = run(state, 0, { type: 'stack', objId: tableCard.id, targetId: stackId }).state;
    state = run(state, 0, { type: 'shuffle', stackId }).state;
    const cards = Object.values(state.cards);
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c.loc).toEqual({ type: 'stack', stackId });
  });

  it('シャッフルはログの出来事を返す', () => {
    const { state, stackId } = withDeck(4);
    const r = run(state, 2, { type: 'shuffle', stackId });
    expect(r.log).toEqual([{ type: 'shuffle', seat: 2, stackId, count: 4 }]);
  });
});

describe('配る', () => {
  it('「配り先以外」で席2に2枚配ると、席2の手札に入り、見える人は席2以外の全席になる', () => {
    const { state, stackId } = withDeck(10);
    const r = run(state, 0, { type: 'deal', stackId, count: 2, seats: [2], visibility: 'others' });
    const hand = r.state.hands[2]!;
    expect(hand).toHaveLength(2);
    for (const id of hand) {
      expect(r.state.cards[id]!.loc).toEqual({
        type: 'hand',
        seat: 2,
        visibility: { kind: 'seats', seats: [0, 1, 3, 4, 5, 6, 7] },
      });
    }
    expect(stackOf(r.state, stackId).cardIds).toHaveLength(8);
  });

  it('「配り先だけ」「誰にも」「全員」の見える人になる', () => {
    const { state, stackId } = withDeck(10);
    const vis = (v: 'recipient' | 'none' | 'all') => {
      const r = run(state, 0, { type: 'deal', stackId, count: 1, seats: [3], visibility: v });
      const card = r.state.cards[r.state.hands[3]![0]!]!;
      return card.loc.type === 'hand' ? card.loc.visibility : null;
    };
    expect(vis('recipient')).toEqual({ kind: 'seats', seats: [3] });
    expect(vis('none')).toEqual({ kind: 'none' });
    expect(vis('all')).toEqual({ kind: 'all' });
  });

  it('複数の席には1枚ずつ順番に配る', () => {
    const { state, stackId } = withDeck(10);
    const top = [...stackOf(state, stackId).cardIds].reverse();
    const r = run(state, 0, { type: 'deal', stackId, count: 2, seats: [1, 2], visibility: 'recipient' });
    expect(r.state.hands[1]).toEqual([top[0], top[2]]);
    expect(r.state.hands[2]).toEqual([top[1], top[3]]);
  });

  it('Covers AE8. 残り5枚の山札で3席に2枚ずつ配ると、5枚配られ、不足1枚の出来事が返る', () => {
    const { state, stackId } = withDeck(5);
    const r = run(state, 0, { type: 'deal', stackId, count: 2, seats: [0, 1, 2], visibility: 'recipient' });
    const dealt = [0, 1, 2].reduce((n, s) => n + r.state.hands[s]!.length, 0);
    expect(dealt).toBe(5);
    expect(r.log).toEqual([{ type: 'deal', seat: 0, count: 5, seats: [0, 1, 2], shortfall: 1 }]);
  });
});

describe('場所を移るときの見える人（R19）', () => {
  it('山から取ると、取った席だけに見える手札になる', () => {
    const { state, stackId } = withDeck(3);
    const r = run(state, 4, { type: 'draw', stackId, count: 1 });
    const id = r.state.hands[4]![0]!;
    expect(r.state.cards[id]!.loc).toEqual({ type: 'hand', seat: 4, visibility: { kind: 'seats', seats: [4] } });
    expect(r.log).toEqual([{ type: 'draw', seat: 4, count: 1 }]);
  });

  it('手札から裏向きで卓に出すと裏向き、向きを省くと表向きになる', () => {
    const { state, stackId } = withDeck(3);
    const s1 = run(state, 1, { type: 'draw', stackId, count: 2 }).state;
    const [a, b] = s1.hands[1]!;
    const s2 = run(s1, 1, { type: 'play', cardId: a!, pos: { x: 1, y: 0, z: 1 }, faceUp: false }).state;
    const s3 = run(s2, 1, { type: 'play', cardId: b!, pos: { x: 2, y: 0, z: 1 } }).state;
    expect(s3.cards[a!]!.loc).toMatchObject({ type: 'table', faceUp: false });
    expect(s3.cards[b!]!.loc).toMatchObject({ type: 'table', faceUp: true });
    expect(s3.hands[1]).toEqual([]);
  });

  it('卓上のカードを山に重ねると、山札の中（裏向き）になる', () => {
    const { state, stackId } = withDeck(2);
    const s1 = run(state, 0, { type: 'drawToTable', stackId, pos: { x: 1, y: 0, z: 0 } }).state;
    const card = Object.values(s1.cards).find((c) => c.loc.type === 'table')!;
    const s2 = run(s1, 0, { type: 'flip', cardId: card.id }).state;
    const s3 = run(s2, 0, { type: 'stack', objId: card.id, targetId: stackId }).state;
    expect(s3.cards[card.id]!.loc).toEqual({ type: 'stack', stackId });
    expect(stackOf(s3, stackId).cardIds.at(-1)).toBe(card.id);
  });

  it('卓上のカードを手札に戻すと、その席だけに見える', () => {
    const { state, stackId } = withDeck(2);
    const s1 = run(state, 0, { type: 'drawToTable', stackId, pos: { x: 1, y: 0, z: 0 } }).state;
    const card = Object.values(s1.cards).find((c) => c.loc.type === 'table')!;
    const s2 = run(s1, 5, { type: 'toHand', cardId: card.id }).state;
    expect(s2.cards[card.id]!.loc).toEqual({ type: 'hand', seat: 5, visibility: { kind: 'seats', seats: [5] } });
  });

  it('卓上のカード同士を重ねると、新しい山札になる', () => {
    const { state, stackId } = withDeck(3);
    let s = run(state, 0, { type: 'drawToTable', stackId, pos: { x: 1, y: 0, z: 0 } }).state;
    s = run(s, 0, { type: 'drawToTable', stackId, pos: { x: 2, y: 0, z: 0 } }).state;
    const [c1, c2] = Object.values(s.cards).filter((c) => c.loc.type === 'table');
    s = run(s, 0, { type: 'stack', objId: c1!.id, targetId: c2!.id }).state;
    const stacks = Object.values(s.objects).filter((o): o is Stack => o.kind === 'stack' && o.id !== stackId);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.cardIds).toEqual([c2!.id, c1!.id]);
  });

  it('見える人を変えると、手札のカードの見える人が変わりログの出来事を返す', () => {
    const { state, stackId } = withDeck(2);
    const s1 = run(state, 1, { type: 'draw', stackId, count: 1 }).state;
    const id = s1.hands[1]![0]!;
    const r = run(s1, 1, { type: 'setVisibility', cardId: id, visibility: { kind: 'seats', seats: [2, 3] } });
    expect(r.state.cards[id]!.loc).toMatchObject({ visibility: { kind: 'seats', seats: [2, 3] } });
    expect(r.log).toEqual([{ type: 'setVisibility', seat: 1, cardId: id }]);
  });

  it('山札が空になったら山札は卓から消える', () => {
    const { state, stackId } = withDeck(1);
    const s = run(state, 0, { type: 'draw', stackId, count: 1 }).state;
    expect(s.objects[stackId]).toBeUndefined();
  });
});

describe('つかみと失敗', () => {
  it('他の席がつかんでいるカードを動かそうとすると失敗する', () => {
    const { state, stackId } = withDeck(2);
    const s1 = run(state, 1, { type: 'grab', objId: stackId }).state;
    const r = apply(s1, cmd(2, { type: 'move', objId: stackId, pos: { x: 3, y: 0, z: 3 } }), seededRng(1));
    expect(r).toMatchObject({ ok: false, error: 'held-by-other' });
  });

  it('つかんだ席は動かせ、離すと他の席も動かせる', () => {
    const { state, stackId } = withDeck(2);
    let s = run(state, 1, { type: 'grab', objId: stackId }).state;
    s = run(s, 1, { type: 'move', objId: stackId, pos: { x: 3, y: 0, z: 3 } }).state;
    s = run(s, 1, { type: 'release', objId: stackId }).state;
    s = run(s, 2, { type: 'move', objId: stackId, pos: { x: 4, y: 0, z: 4 } }).state;
    expect(stackOf(s, stackId).placement.pos).toEqual({ x: 4, y: 0, z: 4 });
  });

  it('消したカードを動かそうとすると「存在しない」で失敗する', () => {
    const { state, stackId } = withDeck(2);
    const s = run(state, 0, { type: 'delete', objId: stackId }).state;
    expect(Object.keys(s.cards)).toHaveLength(0);
    const r = apply(s, cmd(0, { type: 'move', objId: stackId, pos: origin.pos }), seededRng(1));
    expect(r).toMatchObject({ ok: false, error: 'not-found' });
  });

  it('同じ cmdId の操作を2回送っても1回分しか適用されない', () => {
    const { state, stackId } = withDeck(5);
    const c = cmd(0, { type: 'draw', stackId, count: 1 });
    const r1 = apply(state, c, seededRng(1));
    if (!r1.ok) throw new Error();
    const r2 = apply(r1.state, c, seededRng(1));
    expect(r2).toMatchObject({ ok: false, error: 'duplicate' });
    expect(r1.state.hands[0]).toHaveLength(1);
  });

  it('成功するたびに rev が1つ進み、元の状態は変わらない', () => {
    const { state, stackId } = withDeck(3);
    const r = run(state, 0, { type: 'draw', stackId, count: 1 });
    expect(r.state.rev).toBe(state.rev + 1);
    expect(state.hands[0]).toEqual([]);
  });
});

describe('ログに流す出来事', () => {
  it('単なる移動・回転・重ねるはログの出来事を返さない', () => {
    const { state, stackId } = withDeck(3);
    expect(run(state, 0, { type: 'move', objId: stackId, pos: { x: 1, y: 0, z: 1 } }).log).toEqual([]);
    expect(run(state, 0, { type: 'rotate', objId: stackId, rot: 1 }).log).toEqual([]);
  });

  it('サイコロはホストが決めた出目で振られ、出目つきの出来事を返す', () => {
    const s = run(emptyState(), 0, { type: 'spawnDie', placement: origin }).state;
    const dieId = Object.keys(s.objects)[0]!;
    const r = run(s, 3, { type: 'roll', dieId, outcome: { value: 5 } });
    expect(r.state.objects[dieId]).toMatchObject({ value: 5 });
    expect(r.log).toEqual([{ type: 'roll', seat: 3, dieId, value: 5 }]);
  });

  it('サイコロは止まった位置と向きが渡されれば、そこへ移る', () => {
    const s = run(emptyState(), 0, { type: 'spawnDie', placement: origin }).state;
    const dieId = Object.keys(s.objects)[0]!;
    const rest = { pos: { x: 2, y: 0, z: -1 }, rot: 0.5 };
    const r = run(s, 0, { type: 'roll', dieId, outcome: { value: 3, rest } });
    expect(r.state.objects[dieId]).toMatchObject({ value: 3, placement: rest });
  });

  it('手札から卓に出すとログの出来事を返す', () => {
    const { state, stackId } = withDeck(2);
    const s1 = run(state, 1, { type: 'draw', stackId, count: 1 }).state;
    const id = s1.hands[1]![0]!;
    const r = run(s1, 1, { type: 'play', cardId: id, pos: origin.pos });
    expect(r.log).toEqual([{ type: 'play', seat: 1, cardId: id, faceUp: true }]);
  });
});
