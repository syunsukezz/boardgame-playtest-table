// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDealCommand, openDealDialog } from '../../src/ui/deal-dialog';

describe('配るダイアログ（R8）', () => {
  it('「3枚・席2と席3・配り先だけ」で、その内容の配る操作が1つ作られる', () => {
    const cmd = buildDealCommand({ stackId: 's1', count: '3', seats: [1, 2], visibility: 'recipient' });
    expect(cmd).toEqual({ type: 'deal', stackId: 's1', count: 3, seats: [1, 2], visibility: 'recipient' });
  });

  it('席は並べ替えて重複を除く', () => {
    const cmd = buildDealCommand({ stackId: 's1', count: 2, seats: [2, 1, 2], visibility: 'all' });
    expect(cmd?.seats).toEqual([1, 2]);
  });

  it.each(['0', '-1', '1.5', '', 'abc', 0, -3, 2.5])('枚数 %j では送信できない', (count) => {
    expect(buildDealCommand({ stackId: 's1', count, seats: [1], visibility: 'recipient' })).toBeNull();
  });

  it('配り先の席が無いと送信できない', () => {
    expect(buildDealCommand({ stackId: 's1', count: '1', seats: [], visibility: 'none' })).toBeNull();
  });

  it('見える人の4択をそのまま渡す', () => {
    for (const v of ['recipient', 'others', 'none', 'all'] as const) {
      expect(buildDealCommand({ stackId: 's1', count: '1', seats: [0], visibility: v })?.visibility).toBe(v);
    }
  });
});

describe('配るダイアログの画面', () => {
  afterEach(() => document.body.replaceChildren());

  function setup() {
    const send = vi.fn();
    openDealDialog({ stackId: 's1', stackCount: 10, seatNames: [], send });
    const box = document.querySelector('.modal')!;
    const count = box.querySelector<HTMLInputElement>('input[type=number]')!;
    const seats = [...box.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    const ok = [...box.querySelectorAll('button')].find((b) => b.textContent === '配る')!;
    const set = (el: HTMLInputElement, v: string | boolean) => {
      if (typeof v === 'boolean') el.checked = v;
      else el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    return { send, count, seats, ok, set };
  }

  it('枚数が0・負の数のときは送信ボタンが押せず、正しい枚数なら1つの操作が送られる', async () => {
    const { send, count, seats, ok, set } = setup();
    set(seats[1]!, true);
    set(seats[2]!, true);
    set(count, '0');
    expect(ok.disabled).toBe(true);
    set(count, '-2');
    expect(ok.disabled).toBe(true);
    set(count, '3');
    expect(ok.disabled).toBe(false);
    ok.click();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'deal', stackId: 's1', count: 3, seats: [1, 2], visibility: 'recipient' });
  });
});
