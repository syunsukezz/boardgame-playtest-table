import { describe, expect, it } from 'vitest';
import { MAX_SPAWN_CARDS, validateCommandBody } from '../../src/core/validate-command';

const placement = { pos: { x: 0, y: 0, z: 0 }, rot: 0 };
const card = { faceHash: 'f', backHash: 'b', name: 'n' };

describe('参加者の操作の形の検証', () => {
  it.each([
    ['オブジェクトでない', 'move'],
    ['null', null],
    ['知らない種類', { type: 'explode' }],
    ['ID が文字列でない', { type: 'grab', objId: 1 }],
    ['位置が無い', { type: 'move', objId: 'a' }],
    ['位置が数値でない', { type: 'move', objId: 'a', pos: { x: '1', y: 0, z: 0 } }],
    ['位置が NaN', { type: 'move', objId: 'a', pos: { x: NaN, y: 0, z: 0 } }],
    ['回転が無限大', { type: 'rotate', objId: 'a', rot: Infinity }],
    ['枚数が 0', { type: 'draw', stackId: 's', count: 0 }],
    ['枚数が小数', { type: 'draw', stackId: 's', count: 1.5 }],
    ['席が配列でない', { type: 'deal', stackId: 's', count: 1, seats: 1, visibility: 'all' }],
    ['席が範囲外', { type: 'deal', stackId: 's', count: 1, seats: [8], visibility: 'all' }],
    ['配る見える人が不明', { type: 'deal', stackId: 's', count: 1, seats: [1], visibility: 'bogus' }],
    ['見える人の種類が不明', { type: 'setVisibility', cardId: 'c', visibility: { kind: 'x' } }],
    ['見える人の席が無い', { type: 'setVisibility', cardId: 'c', visibility: { kind: 'seats' } }],
    ['表向きが真偽値でない', { type: 'play', cardId: 'c', pos: placement.pos, faceUp: 'yes' }],
    ['カードが空', { type: 'spawnDeck', cards: [], placement }],
    ['カードの形が違う', { type: 'spawnDeck', cards: [{ faceHash: 1 }], placement }],
    ['カードの名前が長すぎる', { type: 'spawnDeck', cards: [{ ...card, name: 'あ'.repeat(101) }], placement }],
    ['カードが多すぎる', { type: 'spawnDeck', cards: Array(MAX_SPAWN_CARDS + 1).fill(card), placement }],
    ['置き場所の形が違う', { type: 'spawnDie', placement: { pos: { x: 0, y: 0 }, rot: 0 } }],
    ['駒の形が不明', { type: 'spawnPiece', shape: 'star', color: '#fff', placement }],
    ['色が長すぎる', { type: 'spawnPiece', shape: 'cube', color: 'x'.repeat(33), placement }],
    ['盤面の大きさが 0', { type: 'spawnBoard', imageHash: 'h', width: 0, depth: 1, placement }],
  ])('%s なら null', (_label, body) => {
    expect(validateCommandBody(body)).toBeNull();
  });

  it('正しい操作は、余計なプロパティを落として作り直す', () => {
    expect(validateCommandBody({ type: 'move', objId: 'a', pos: { x: 1, y: 2, z: 3, w: 9 }, seat: 5, extra: 1 })).toEqual({
      type: 'move',
      objId: 'a',
      pos: { x: 1, y: 2, z: 3 },
    });
    expect(validateCommandBody({ type: 'spawnDeck', cards: [{ ...card, x: 1 }], placement })).toEqual({
      type: 'spawnDeck',
      cards: [card],
      placement,
    });
    expect(validateCommandBody({ type: 'deal', stackId: 's', count: 2, seats: [1, 2], visibility: 'others' })).toEqual({
      type: 'deal',
      stackId: 's',
      count: 2,
      seats: [1, 2],
      visibility: 'others',
    });
  });

  it('参加者が送ったサイコロの出目は捨てる', () => {
    expect(validateCommandBody({ type: 'roll', dieId: 'd', outcome: { value: 6 } })).toEqual({ type: 'roll', dieId: 'd' });
  });
});
