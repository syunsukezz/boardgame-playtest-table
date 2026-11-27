// 手札のカードの「見える人を変える」ダイアログ（R5）。全員・誰にも・席の複数選択から選ぶ。
import type { CommandBody } from '../core/commands';
import { MAX_SEATS, normalizeSeats, type SeatId } from '../core/state';
import { openDialog } from './dialog';
import { h, seatLabel } from './dom';

export type VisibilityChoice = 'all' | 'none' | 'seats';

/** 選んだ内容から操作を作る。席の複数選択で1席も無ければ null。 */
export function buildVisibilityCommand(cardId: string, choice: VisibilityChoice, seats: SeatId[]): CommandBody | null {
  if (choice === 'all') return { type: 'setVisibility', cardId, visibility: { kind: 'all' } };
  if (choice === 'none') return { type: 'setVisibility', cardId, visibility: { kind: 'none' } };
  const list = normalizeSeats(seats);
  if (list.length === 0) return null;
  return { type: 'setVisibility', cardId, visibility: { kind: 'seats', seats: list } };
}

export function openVisibilityDialog(opts: { cardId: string; seatNames: string[]; send(body: CommandBody): void }): void {
  const radios: HTMLInputElement[] = [];
  const mk = (v: VisibilityChoice, label: string, checked = false): HTMLLabelElement => {
    const r = h('input', { type: 'radio', name: 'vis-choice', value: v, checked });
    radios.push(r);
    return h('label', {}, r, label);
  };
  const seatBoxes: HTMLInputElement[] = [];
  const seatList = h('div', { class: 'checks indent' });
  for (let s = 0; s < MAX_SEATS; s++) {
    const cb = h('input', { type: 'checkbox', value: s });
    seatBoxes.push(cb);
    const name = opts.seatNames[s];
    seatList.append(h('label', {}, cb, name ? `${seatLabel(s)}（${name}）` : seatLabel(s)));
  }
  const read = (): CommandBody | null =>
    buildVisibilityCommand(
      opts.cardId,
      (radios.find((r) => r.checked)?.value ?? 'seats') as VisibilityChoice,
      seatBoxes.filter((b) => b.checked).map((b) => Number(b.value)),
    );
  const dlg = openDialog({
    title: '見える人を変える',
    body: [h('div', { class: 'checks' }, mk('all', '全員'), mk('none', '誰にも見えない'), mk('seats', '席を選ぶ', true)), seatList],
    okLabel: '変える',
    onOk: () => {
      const body = read();
      if (!body) return false;
      opts.send(body);
      return true;
    },
  });
  const update = (): void => {
    const seatsMode = radios.find((r) => r.checked)?.value === 'seats';
    for (const b of seatBoxes) b.disabled = !seatsMode;
    dlg.setOkEnabled(read() !== null);
  };
  dlg.root.addEventListener('change', update);
  update();
}
