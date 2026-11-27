import { describe, expect, it } from 'vitest';
import { resolveClick, resolveDrop } from '../../src/render/drag';

const pos = { x: 1, y: 0, z: 2 };

describe('resolveDrop', () => {
  it('山札の上で離すと重ねる＋離す', () => {
    expect(
      resolveDrop({
        dragged: { kind: 'card', id: 'c1', where: 'table' },
        dropOn: { kind: 'stack', id: 's1' },
        overOwnRack: false,
        pos,
      }),
    ).toEqual([
      { type: 'stack', objId: 'c1', targetId: 's1' },
      { type: 'release', objId: 'c1' },
    ]);
  });

  it('卓上の別のカードの上で離しても重ねる', () => {
    expect(
      resolveDrop({
        dragged: { kind: 'card', id: 'c1', where: 'table' },
        dropOn: { kind: 'card', id: 'c2', where: 'table' },
        overOwnRack: false,
        pos,
      }),
    ).toEqual([
      { type: 'stack', objId: 'c1', targetId: 'c2' },
      { type: 'release', objId: 'c1' },
    ]);
  });

  it('卓上のカードを自席のラック上で離すと手札に戻す＋離す', () => {
    expect(
      resolveDrop({
        dragged: { kind: 'card', id: 'c1', where: 'table' },
        dropOn: null,
        overOwnRack: true,
        pos,
      }),
    ).toEqual([
      { type: 'toHand', cardId: 'c1' },
      { type: 'release', objId: 'c1' },
    ]);
  });

  it('手札のカードを卓に出すと play だけ（release なし）', () => {
    expect(
      resolveDrop({
        dragged: { kind: 'card', id: 'h1', where: 'hand', handSeat: 0 },
        dropOn: null,
        overOwnRack: false,
        pos,
      }),
    ).toEqual([{ type: 'play', cardId: 'h1', pos }]);
  });

  it('それ以外の卓上の物は移動＋離す', () => {
    expect(
      resolveDrop({ dragged: { kind: 'piece', id: 'p1' }, dropOn: null, overOwnRack: false, pos }),
    ).toEqual([
      { type: 'move', objId: 'p1', pos },
      { type: 'release', objId: 'p1' },
    ]);
  });
});

describe('resolveClick', () => {
  it('山札のクリックで1枚取る', () => {
    expect(resolveClick({ kind: 'stack', id: 's1' })).toEqual([
      { type: 'draw', stackId: 's1', count: 1 },
    ]);
  });
});
