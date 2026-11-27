import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/apply';
import type { Command, CommandBody } from '../../src/core/commands';
import { applyPatch, diffViews } from '../../src/core/diff';
import { formatLog } from '../../src/core/log';
import { project, type View } from '../../src/core/project';
import { seededRng } from '../../src/core/rng';
import { emptyState, type TableState } from '../../src/core/state';

let n = 0;
function run(state: TableState, seat: number, body: CommandBody, seed = 7) {
  const r = apply(state, { ...body, seat, cmdId: `p${n++}` } as Command, seededRng(seed));
  if (!r.ok) throw new Error(r.error);
  return r;
}

const origin = { pos: { x: 0, y: 0, z: 0 }, rot: 0 };

function withDeck(count: number) {
  const cards = Array.from({ length: count }, (_, i) => ({ faceHash: `FACE-${i}-X`, backHash: 'BACK', name: `NAME-${i}-X` }));
  const state = run(emptyState(), 0, { type: 'spawnDeck', cards, placement: origin }).state;
  const stackId = Object.keys(state.objects)[0]!;
  return { state, stackId };
}

function seesFace(view: View, cardId: string): boolean {
  return view.cards[cardId]?.face !== undefined;
}

describe('席ごとの切り出し', () => {
  it('Covers AE1. 「配り先以外」で席2に配った2枚は、席2には中身もハッシュも届かず、席1と席3には届く', () => {
    const { state, stackId } = withDeck(10);
    const s = run(state, 1, { type: 'deal', stackId, count: 2, seats: [2], visibility: 'others' }).state;
    const dealt = s.hands[2]!;
    const v2 = project(s, { kind: 'seat', seat: 2 });
    for (const id of dealt) {
      const face = s.cards[id]!.faceHash;
      expect(seesFace(v2, id)).toBe(false);
      expect(JSON.stringify(v2)).not.toContain(face);
      expect(seesFace(project(s, { kind: 'seat', seat: 1 }), id)).toBe(true);
      expect(seesFace(project(s, { kind: 'seat', seat: 3 }), id)).toBe(true);
    }
    expect(v2.hands[2]).toEqual(dealt);
  });

  it('Covers AE6. 席2だけに見える手札を裏向きで卓に出すと誰にも見えず、表に裏返すと全員に見える', () => {
    const { state, stackId } = withDeck(3);
    const s1 = run(state, 2, { type: 'draw', stackId, count: 1 }).state;
    const id = s1.hands[2]![0]!;
    const s2 = run(s1, 2, { type: 'play', cardId: id, pos: origin.pos, faceUp: false }).state;
    for (let seat = 0; seat < 8; seat++) expect(seesFace(project(s2, { kind: 'seat', seat }), id)).toBe(false);
    const s3 = run(s2, 0, { type: 'flip', cardId: id }).state;
    for (let seat = 0; seat < 8; seat++) expect(seesFace(project(s3, { kind: 'seat', seat }), id)).toBe(true);
  });

  it('Covers AE7. 山札の中のカードは、どの席にも1枚ずつ送られず、枚数だけが届く', () => {
    const { state, stackId } = withDeck(5);
    const s = run(state, 0, { type: 'shuffle', stackId }).state;
    for (let seat = 0; seat < 8; seat++) {
      const v = project(s, { kind: 'seat', seat });
      expect(Object.keys(v.cards)).toHaveLength(0);
      expect(v.objects[stackId]).toMatchObject({ kind: 'stack', count: 5, backHash: 'BACK' });
      const json = JSON.stringify(v);
      for (const id of (s.objects[stackId] as { cardIds: string[] }).cardIds) expect(json).not.toContain(id);
      for (let i = 0; i < 5; i++) expect(json).not.toContain(`FACE-${i}-X`);
    }
  });

  it('Covers AE2. ホストが兼任する席2で切り出すと、席2に見えるカードだけ中身が入る', () => {
    const { state, stackId } = withDeck(6);
    let s = run(state, 0, { type: 'deal', stackId, count: 1, seats: [0, 2], visibility: 'recipient' }).state;
    const own0 = s.hands[0]![0]!;
    const own2 = s.hands[2]![0]!;
    s = run(s, 0, { type: 'setVisibility', cardId: own0, visibility: { kind: 'seats', seats: [0] } }).state;
    const v = project(s, { kind: 'seat', seat: 2 });
    expect(seesFace(v, own2)).toBe(true);
    expect(seesFace(v, own0)).toBe(false);
  });

  it('未着席の参加者には、全員に見えるカード以外の中身が届かない', () => {
    const { state, stackId } = withDeck(6);
    let s = run(state, 0, { type: 'deal', stackId, count: 1, seats: [0, 1], visibility: 'recipient' }).state;
    s = run(s, 0, { type: 'setVisibility', cardId: s.hands[1]![0]!, visibility: { kind: 'all' } }).state;
    const v = project(s, { kind: 'spectator' });
    expect(seesFace(v, s.hands[0]![0]!)).toBe(false);
    expect(seesFace(v, s.hands[1]![0]!)).toBe(true);
  });
});

describe('漏れがないこと', () => {
  it('ランダムな操作列のどの時点でも、見えないカードの中身・名前が切り出しに現れない', () => {
    for (let trial = 0; trial < 100; trial++) {
      const rng = seededRng(1000 + trial);
      const pick = <T,>(arr: T[]): T => arr[Math.floor(rng.next() * arr.length)]!;
      let { state } = withDeck(12);
      for (let step = 0; step < 30; step++) {
        const seat = Math.floor(rng.next() * 8);
        const stacks = Object.values(state.objects).filter((o) => o.kind === 'stack').map((o) => o.id);
        const tableCards = Object.values(state.cards).filter((c) => c.loc.type === 'table').map((c) => c.id);
        const handCards = Object.values(state.cards).filter((c) => c.loc.type === 'hand').map((c) => c.id);
        const options: CommandBody[] = [];
        if (stacks.length) {
          const st = pick(stacks);
          options.push(
            { type: 'shuffle', stackId: st },
            { type: 'draw', stackId: st, count: 1 },
            { type: 'drawToTable', stackId: st, pos: origin.pos },
            {
              type: 'deal',
              stackId: st,
              count: 1,
              seats: [Math.floor(rng.next() * 8)],
              visibility: pick(['recipient', 'others', 'none', 'all'] as const),
            },
          );
          // 山札ごと消すと残りの操作が減るので、たまにだけ
          if (rng.next() < 0.2) options.push({ type: 'delete', objId: st });
        }
        if (tableCards.length) {
          const c = pick(tableCards);
          options.push({ type: 'flip', cardId: c }, { type: 'toHand', cardId: c }, { type: 'delete', objId: c });
          if (stacks.length) options.push({ type: 'stack', objId: c, targetId: pick(stacks) });
        }
        if (handCards.length) {
          const c = pick(handCards);
          options.push(
            { type: 'play', cardId: c, pos: origin.pos, faceUp: rng.next() < 0.5 },
            { type: 'setVisibility', cardId: c, visibility: { kind: 'seats', seats: [Math.floor(rng.next() * 8)] } },
            { type: 'delete', objId: c },
          );
        }
        if (!options.length) break;
        const r = apply(state, { ...pick(options), seat, cmdId: `r${trial}-${step}` } as Command, rng);
        if (!r.ok) continue;
        state = r.state;
        for (let viewer = 0; viewer < 8; viewer++) {
          const json = JSON.stringify(project(state, { kind: 'seat', seat: viewer }));
          for (const card of Object.values(state.cards)) {
            if (canSee(card.loc, viewer)) continue;
            expect(json).not.toContain(card.faceHash);
            expect(json).not.toContain(card.name);
          }
        }
      }
    }
  }, 60_000); // 重い総当たりなので、負荷の高い環境でも時間切れにならないよう上限を延ばす
});

/** テスト側で独立に書いた「見えてよい」の定義（R5）。 */
function canSee(loc: TableState['cards'][string]['loc'], seat: number): boolean {
  if (loc.type === 'stack') return false;
  if (loc.type === 'table') return loc.faceUp;
  if (loc.visibility.kind === 'all') return true;
  if (loc.visibility.kind === 'none') return false;
  return loc.visibility.seats.includes(seat);
}

describe('差分', () => {
  it('スナップショットに差分を順に当てた結果が、最新のスナップショットと一致する', () => {
    let { state, stackId } = withDeck(8);
    const viewer = { kind: 'seat', seat: 1 } as const;
    let view = project(state, viewer);
    const steps: CommandBody[] = [
      { type: 'shuffle', stackId },
      { type: 'deal', stackId, count: 2, seats: [1, 2], visibility: 'recipient' },
      { type: 'drawToTable', stackId, pos: { x: 1, y: 0, z: 1 } },
      { type: 'move', objId: stackId, pos: { x: 2, y: 0, z: 0 } },
    ];
    for (const body of steps) {
      const prevProjected = project(state, viewer);
      state = run(state, 0, body).state;
      const next = project(state, viewer);
      view = applyPatch(view, diffViews(prevProjected, next));
      expect(view).toEqual(next);
    }
    const handCard = state.hands[1]![0]!;
    const prevProjected = project(state, viewer);
    state = run(state, 1, { type: 'play', cardId: handCard, pos: origin.pos }).state;
    view = applyPatch(view, diffViews(prevProjected, project(state, viewer)));
    expect(view).toEqual(project(state, viewer));
  });
});

describe('ログの文面', () => {
  const name = (s: number) => `席${s + 1}`;

  it('見えないカードの名前を入れない', () => {
    const { state, stackId } = withDeck(3);
    const s1 = run(state, 1, { type: 'draw', stackId, count: 1 }).state;
    const id = s1.hands[1]![0]!;
    const r = run(s1, 1, { type: 'play', cardId: id, pos: origin.pos, faceUp: false });
    const card = r.state.cards[id]!;
    for (let viewer = 0; viewer < 8; viewer++) {
      const text = formatLog(r.log[0]!, project(r.state, { kind: 'seat', seat: viewer }), name);
      expect(text).not.toContain(card.name);
    }
  });

  it('表で出したカードは名前を出し、サイコロは出目を出す', () => {
    const { state, stackId } = withDeck(3);
    const s1 = run(state, 1, { type: 'draw', stackId, count: 1 }).state;
    const id = s1.hands[1]![0]!;
    const r = run(s1, 1, { type: 'play', cardId: id, pos: origin.pos });
    const view = project(r.state, { kind: 'seat', seat: 4 });
    expect(formatLog(r.log[0]!, view, name)).toContain(r.state.cards[id]!.name);

    const sd = run(emptyState(), 0, { type: 'spawnDie', placement: origin }).state;
    const dieId = Object.keys(sd.objects)[0]!;
    const rr = run(sd, 3, { type: 'roll', dieId, outcome: { value: 4 } });
    expect(formatLog(rr.log[0]!, project(rr.state, { kind: 'spectator' }), name)).toBe('席4がサイコロを振った: 4');
  });

  it('配るログは枚数と席だけを出し、不足があれば知らせる', () => {
    const { state, stackId } = withDeck(5);
    const r = run(state, 0, { type: 'deal', stackId, count: 2, seats: [0, 1, 2], visibility: 'recipient' });
    const text = formatLog(r.log[0]!, project(r.state, { kind: 'seat', seat: 0 }), name);
    expect(text).toBe('席1が席1・席2・席3に計5枚配った（1枚足りなかった）');
  });
});
