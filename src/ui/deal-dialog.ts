// 配るダイアログ（R8）。枚数・配り先の席・見える人（4択）を選び、1つの「配る」操作を作る。
import type { CommandBody, DealVisibility } from '../core/commands';
import { MAX_SEATS, type SeatId } from '../core/state';
import { openDialog } from './dialog';
import { h, seatLabel } from './dom';

export interface DealForm {
  stackId: string;
  /** 入力欄の文字列か数 */
  count: string | number;
  seats: SeatId[];
  visibility: DealVisibility;
}

export type DealCommand = Extract<CommandBody, { type: 'deal' }>;

/** 枚数を1以上の整数として読む。読めなければ null。 */
export function parseCount(count: string | number): number | null {
  const n = typeof count === 'number' ? count : count.trim() === '' ? NaN : Number(count.trim());
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** 入力から「配る」操作を作る。不正（枚数が1未満・整数でない、席が無い）なら null（送信できない）。 */
export function buildDealCommand(f: DealForm): DealCommand | null {
  const count = parseCount(f.count);
  if (count === null) return null;
  const seats = [...new Set(f.seats)].filter((s) => Number.isInteger(s) && s >= 0 && s < MAX_SEATS).sort((a, b) => a - b);
  if (seats.length === 0) return null;
  return { type: 'deal', stackId: f.stackId, count, seats, visibility: f.visibility };
}

export const DEAL_VISIBILITY_LABELS: Record<DealVisibility, string> = {
  recipient: '配り先だけ',
  others: '配り先以外',
  none: '誰にも見えない',
  all: '全員',
};

/** 配るダイアログを開く。決定したら send に操作を渡す。seatNames は席ごとの表示名。 */
export function openDealDialog(opts: {
  stackId: string;
  stackCount: number;
  seatNames: string[];
  send(cmd: DealCommand): void;
}): void {
  const countInput = h('input', { type: 'number', min: 1, step: 1, value: 1, class: 'num' });
  const seatBoxes: HTMLInputElement[] = [];
  const seatList = h('div', { class: 'checks' });
  for (let s = 0; s < MAX_SEATS; s++) {
    const cb = h('input', { type: 'checkbox', value: s });
    seatBoxes.push(cb);
    const name = opts.seatNames[s];
    seatList.append(h('label', {}, cb, name ? `${seatLabel(s)}（${name}）` : seatLabel(s)));
  }
  const visRadios: HTMLInputElement[] = [];
  const visList = h('div', { class: 'checks' });
  (Object.keys(DEAL_VISIBILITY_LABELS) as DealVisibility[]).forEach((v, i) => {
    const r = h('input', { type: 'radio', name: 'deal-vis', value: v, checked: i === 0 });
    visRadios.push(r);
    visList.append(h('label', {}, r, DEAL_VISIBILITY_LABELS[v]));
  });

  const read = (): DealCommand | null =>
    buildDealCommand({
      stackId: opts.stackId,
      count: countInput.value,
      seats: seatBoxes.filter((b) => b.checked).map((b) => Number(b.value)),
      visibility: (visRadios.find((r) => r.checked)?.value ?? 'recipient') as DealVisibility,
    });

  const dlg = openDialog({
    title: '配る',
    body: [
      h('p', { class: 'muted' }, `山札の残り: ${opts.stackCount}枚（足りなければある分だけ配ります）`),
      h('label', { class: 'field' }, '1席あたりの枚数 ', countInput),
      h('div', { class: 'field' }, h('div', {}, '配り先の席'), seatList),
      h('div', { class: 'field' }, h('div', {}, '見える人'), visList),
    ],
    okLabel: '配る',
    onOk: () => {
      const cmd = read();
      if (!cmd) return false;
      opts.send(cmd);
      return true;
    },
  });
  const update = (): void => dlg.setOkEnabled(read() !== null);
  dlg.root.addEventListener('input', update);
  dlg.root.addEventListener('change', update);
  update();
}
