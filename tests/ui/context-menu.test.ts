import { describe, expect, it, vi } from 'vitest';
import type { CommandBody } from '../../src/core/commands';
import type { View } from '../../src/core/project';
import { contextMenuItems, runMenuAction, type MenuDeps } from '../../src/ui/context-menu';
import { seatPanelModel } from '../../src/ui/seat-panel';
import { buildVisibilityCommand } from '../../src/ui/visibility-dialog';
import type { SeatInfo } from '../../src/net/seats';

const view: View = {
  rev: 1,
  cards: {},
  objects: {
    s1: { id: 's1', kind: 'stack', placement: { pos: { x: 1, y: 0, z: 2 }, rot: 0 }, count: 5, backHash: 'b' },
  },
  hands: {},
  heldBy: {},
};
const ctx = { activeSeat: 1, view };
const labels = (items: { label: string }[]) => items.map((i) => i.label);

function deps(confirmResult: boolean): MenuDeps & { sent: CommandBody[] } {
  const sent: CommandBody[] = [];
  return {
    sent,
    confirm: vi.fn(async () => confirmResult),
    send: (b) => void sent.push(b),
    openDeal: vi.fn(),
    openVisibility: vi.fn(),
  };
}

describe('右クリックメニューの項目（対象ごと）', () => {
  it('卓上のカード', () => {
    expect(labels(contextMenuItems({ kind: 'card', id: 'c1', where: 'table' }, ctx))).toEqual(['裏返す', '手札に取る', '消す']);
  });

  it('操作中の席の手札のカード', () => {
    expect(labels(contextMenuItems({ kind: 'card', id: 'c1', where: 'hand', handSeat: 1 }, ctx))).toEqual([
      '卓に出す（表）',
      '卓に出す（裏）',
      '見える人を変える',
    ]);
  });

  it('ほかの席の手札のカードには項目が無い', () => {
    expect(contextMenuItems({ kind: 'card', id: 'c1', where: 'hand', handSeat: 2 }, ctx)).toEqual([]);
  });

  it('山札', () => {
    expect(labels(contextMenuItems({ kind: 'stack', id: 's1' }, ctx))).toEqual([
      '1枚引く',
      'シャッフル',
      '配る',
      '裏向きで1枚卓に出す',
      '消す',
    ]);
  });

  it('駒と盤面は消すだけ、サイコロは振ると消す', () => {
    expect(labels(contextMenuItems({ kind: 'piece', id: 'p' }, ctx))).toEqual(['消す']);
    expect(labels(contextMenuItems({ kind: 'board', id: 'b' }, ctx))).toEqual(['消す']);
    expect(labels(contextMenuItems({ kind: 'die', id: 'd' }, ctx))).toEqual(['振る', '消す']);
  });

  it('手札を表で出す操作と裏で出す操作', () => {
    const items = contextMenuItems({ kind: 'card', id: 'c1', where: 'hand', handSeat: 1 }, ctx);
    const [up, down] = items.map((i) => i.action);
    expect(up).toMatchObject({ kind: 'command', body: { type: 'play', cardId: 'c1', faceUp: true } });
    expect(down).toMatchObject({ kind: 'command', body: { type: 'play', cardId: 'c1', faceUp: false } });
  });
});

describe('メニューの実行', () => {
  const del = () => contextMenuItems({ kind: 'piece', id: 'p' }, ctx).find((i) => i.label === '消す')!.action;

  it('「消す」を確認で取り消すと、操作は送られない（R23）', async () => {
    const d = deps(false);
    await runMenuAction(del(), d);
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.sent).toEqual([]);
  });

  it('「消す」を確認で承諾すると、消す操作が1つ送られる', async () => {
    const d = deps(true);
    await runMenuAction(del(), d);
    expect(d.sent).toEqual([{ type: 'delete', objId: 'p' }]);
  });

  it('確認の要らない操作はそのまま送る', async () => {
    const d = deps(false);
    const shuffle = contextMenuItems({ kind: 'stack', id: 's1' }, ctx).find((i) => i.label === 'シャッフル')!;
    await runMenuAction(shuffle.action, d);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.sent).toEqual([{ type: 'shuffle', stackId: 's1' }]);
  });

  it('「配る」と「見える人を変える」はダイアログを開く', async () => {
    const d = deps(true);
    const deal = contextMenuItems({ kind: 'stack', id: 's1' }, ctx).find((i) => i.label === '配る')!;
    await runMenuAction(deal.action, d);
    expect(d.openDeal).toHaveBeenCalledWith('s1');
    const vis = contextMenuItems({ kind: 'card', id: 'c1', where: 'hand', handSeat: 1 }, ctx).find(
      (i) => i.label === '見える人を変える',
    )!;
    await runMenuAction(vis.action, d);
    expect(d.openVisibility).toHaveBeenCalledWith('c1');
    expect(d.sent).toEqual([]);
  });
});

describe('見える人を変えるダイアログ（R5）', () => {
  it('席2と席3を選ぶと、その2席を見える人にする操作が1つ作られる', () => {
    expect(buildVisibilityCommand('c1', 'seats', [2, 1])).toEqual({
      type: 'setVisibility',
      cardId: 'c1',
      visibility: { kind: 'seats', seats: [1, 2] },
    });
  });

  it('全員・誰にも', () => {
    expect(buildVisibilityCommand('c1', 'all', [])).toEqual({ type: 'setVisibility', cardId: 'c1', visibility: { kind: 'all' } });
    expect(buildVisibilityCommand('c1', 'none', [3])).toEqual({ type: 'setVisibility', cardId: 'c1', visibility: { kind: 'none' } });
  });

  it('席の複数選択で1席も選ばないと作られない', () => {
    expect(buildVisibilityCommand('c1', 'seats', [])).toBeNull();
  });
});

describe('席のパネル（R14, R20, R21）', () => {
  const loadedSeats: SeatInfo[] = [
    { seat: 0, status: 'host' },
    ...[1, 2, 3, 4, 5, 6, 7].map((seat) => ({ seat, status: 'empty' as const })),
  ];
  const actionKinds = (m: ReturnType<typeof seatPanelModel>) => m.rows.flatMap((r) => r.actions.map((a) => a.kind));

  it('読み込み後（割り当て待ち）、参加者には「座る」操作が作られない', () => {
    const m = seatPanelModel({
      role: 'guest',
      seats: loadedSeats,
      assignmentPending: true,
      mySeat: null,
      activeSeat: null,
      participants: [],
    });
    expect(actionKinds(m)).not.toContain('sit');
    expect(m.notice).toBe('ホストが席を割り当てるのを待っています');
  });

  it('割り当て待ちでなければ、未着席の参加者は空席に座れる', () => {
    const m = seatPanelModel({
      role: 'guest',
      seats: loadedSeats,
      assignmentPending: false,
      mySeat: null,
      activeSeat: null,
      participants: [],
    });
    expect(m.rows[0]!.actions).toEqual([]);
    expect(m.rows[1]!.actions.map((a) => a.kind)).toEqual(['sit']);
  });

  it('着席済みの参加者には「座る」が出ない', () => {
    const seats: SeatInfo[] = loadedSeats.map((s) => (s.seat === 1 ? { seat: 1, status: 'occupied', name: 'A' } : s));
    const m = seatPanelModel({ role: 'guest', seats, assignmentPending: false, mySeat: 1, activeSeat: 1, participants: [] });
    expect(actionKinds(m)).toEqual([]);
  });

  it('割り当て待ちのホストには、未着席の参加者の割り当てと「割り当て完了」が出る', () => {
    const m = seatPanelModel({
      role: 'host',
      seats: loadedSeats,
      assignmentPending: true,
      mySeat: 0,
      activeSeat: 0,
      participants: [
        { connId: 'a', name: 'Aさん', seat: null },
        { connId: 'b', name: 'Bさん', seat: 2 },
      ],
    });
    const assigns = m.rows[1]!.actions.filter((a) => a.kind === 'assign');
    expect(assigns).toEqual([{ kind: 'assign', connId: 'a', name: 'Aさん' }]);
    expect(m.canFinishAssignment).toBe(true);
    expect(actionKinds(m)).not.toContain('sit');
  });

  it('ホストの操作: 兼任・兼任をやめる・切り替え・空席に戻す', () => {
    const seats: SeatInfo[] = [
      { seat: 0, status: 'host' },
      { seat: 1, status: 'hosted' },
      { seat: 2, status: 'occupied', name: 'A' },
      { seat: 3, status: 'disconnected', name: 'B' },
      ...[4, 5, 6, 7].map((seat) => ({ seat, status: 'empty' as const })),
    ];
    const m = seatPanelModel({ role: 'host', seats, assignmentPending: false, mySeat: 0, activeSeat: 1, participants: [] });
    expect(m.rows[0]!.actions.map((a) => a.kind)).toEqual(['switch']);
    expect(m.rows[1]!.actions.map((a) => a.kind)).toEqual(['unhost']);
    expect(m.rows[1]!.active).toBe(true);
    expect(m.rows[2]!.actions.map((a) => a.kind)).toEqual(['free']);
    expect(m.rows[3]!.actions.map((a) => a.kind)).toEqual(['free']);
    expect(m.rows[4]!.actions.map((a) => a.kind)).toEqual(['host']);
    expect(m.canFinishAssignment).toBe(false);
  });
});
