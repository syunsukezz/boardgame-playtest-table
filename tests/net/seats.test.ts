import { describe, expect, it } from 'vitest';
import { SeatManager } from '../../src/net/seats';

function sitOk(m: SeatManager, connId: string, seat: number, name = connId): string {
  const r = m.sit(connId, seat, name);
  if (!r.ok) throw new Error(`sit failed: ${r.reason}`);
  return r.seatKey;
}

describe('SeatManager', () => {
  it('席0はホストの席で、ほかの7席は空席から始まる', () => {
    const m = new SeatManager();
    const list = m.list();
    expect(list).toHaveLength(8);
    expect(list[0]!.status).toBe('host');
    expect(list.slice(1).every((s) => s.status === 'empty')).toBe(true);
  });

  it('空席に座ると鍵が発行され、席の一覧には鍵が出ない', () => {
    const m = new SeatManager();
    const key = sitOk(m, 'a', 2, 'Alice');
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(m.list()[2]).toEqual({ seat: 2, status: 'occupied', name: 'Alice' });
    expect(JSON.stringify(m.list())).not.toContain(key);
    expect(m.seatOf('a')).toBe(2);
  });

  it('ホストの席・着席中の席・範囲外には座れない。同じ接続が2席に座ることもできない', () => {
    const m = new SeatManager();
    sitOk(m, 'a', 1);
    expect(m.sit('b', 0, 'b').ok).toBe(false);
    expect(m.sit('b', 1, 'b').ok).toBe(false);
    expect(m.sit('b', 8, 'b').ok).toBe(false);
    expect(m.sit('a', 2, 'a').ok).toBe(false);
  });

  it('兼任中の席には座れ、兼任が外れたことが分かる', () => {
    const m = new SeatManager();
    expect(m.hostSeat(3)).toBe(true);
    expect(m.list()[3]!.status).toBe('hosted');
    const r = m.sit('a', 3, 'a');
    expect(r.ok && r.wasHosted).toBe(true);
    expect(m.list()[3]!.status).toBe('occupied');
  });

  it('兼任を外すと空席に戻る。着席中の席は兼任できない', () => {
    const m = new SeatManager();
    m.hostSeat(3);
    expect(m.unhostSeat(3)).toBe(true);
    expect(m.list()[3]!.status).toBe('empty');
    sitOk(m, 'a', 4);
    expect(m.hostSeat(4)).toBe(false);
    expect(m.hostSeat(0)).toBe(false);
  });

  it('切断中の席に同じ鍵で戻れる。別の鍵では戻れない', () => {
    const m = new SeatManager();
    const key = sitOk(m, 'a', 2);
    expect(m.markDisconnected('a')).toBe(2);
    expect(m.list()[2]!.status).toBe('disconnected');
    expect(m.rejoin('x', 'wrong-key')).toBeNull();
    expect(m.rejoin('b', key)).toEqual({ seat: 2, replacedConnId: undefined });
    expect(m.list()[2]!.status).toBe('occupied');
    expect(m.seatOf('b')).toBe(2);
    expect(m.seatOf('a')).toBeNull();
  });

  it('着席中の席に同じ鍵で入ると古い接続と差し替える（KTD6）', () => {
    const m = new SeatManager();
    const key = sitOk(m, 'a', 2);
    expect(m.rejoin('b', key)).toEqual({ seat: 2, replacedConnId: 'a' });
    expect(m.seatOf('b')).toBe(2);
  });

  it('localStorage から来た鍵は、着席中の席を奪わないが切断中の席には戻れる', () => {
    const m = new SeatManager();
    const key = sitOk(m, 'a', 2);
    expect(m.rejoin('b', key, { fromLocal: true })).toBeNull();
    expect(m.seatOf('a')).toBe(2);
    m.markDisconnected('a');
    expect(m.rejoin('b', key, { fromLocal: true })?.seat).toBe(2);
  });

  it('ホストは切断中・着席中の席を空席に戻せ、古い鍵は使えなくなる', () => {
    const m = new SeatManager();
    const key = sitOk(m, 'a', 2);
    m.markDisconnected('a');
    expect(m.freeSeat(2).ok).toBe(true);
    expect(m.list()[2]!.status).toBe('empty');
    expect(m.rejoin('a', key)).toBeNull();
    expect(m.freeSeat(0).ok).toBe(false);
  });

  it('読み込み後は全席が空席になり、割り当て完了まで自分では座れない。割り当てると新しい鍵が出る', () => {
    const m = new SeatManager();
    const oldKey = sitOk(m, 'a', 2);
    m.hostSeat(5);
    m.resetForLoad();
    expect(m.assignmentPending).toBe(true);
    expect(m.list().slice(1).every((s) => s.status === 'empty')).toBe(true);
    expect(m.list()[0]!.status).toBe('host');
    expect(m.seatOf('a')).toBeNull();
    expect(m.sit('a', 2, 'a').ok).toBe(false);
    const newKey = m.assign('a', 4, 'a');
    expect(newKey).not.toBeNull();
    expect(newKey).not.toBe(oldKey);
    expect(m.seatOf('a')).toBe(4);
    expect(m.rejoin('z', oldKey)).toBeNull();
    m.finishAssignment();
    expect(m.assignmentPending).toBe(false);
    expect(m.sit('b', 3, 'b').ok).toBe(true);
  });

  it('空きの数: 空席と兼任中の席', () => {
    const m = new SeatManager();
    expect(m.freeCount()).toBe(7);
    sitOk(m, 'a', 1);
    m.hostSeat(2);
    expect(m.freeCount()).toBe(6);
  });
});
