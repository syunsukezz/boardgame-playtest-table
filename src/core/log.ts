// ログの出来事を、その席から見た文面にする（R11）。
// 見えないカードの名前は入れない。カードの名前は切り出し結果（View）からだけ取る。
import type { LogEvent } from './commands';
import type { View } from './project';
import type { SeatId } from './state';

export type SeatName = (seat: SeatId) => string;

export function formatLog(event: LogEvent, view: View, seatName: SeatName): string {
  const who = seatName(event.seat);
  switch (event.type) {
    case 'shuffle':
      return `${who}が山札（${event.count}枚）をシャッフルした`;
    case 'deal': {
      const to = event.seats.map(seatName).join('・');
      const short = event.shortfall > 0 ? `（${event.shortfall}枚足りなかった）` : '';
      return `${who}が${to}に計${event.count}枚配った${short}`;
    }
    case 'draw':
      return `${who}が山札から${event.count}枚取った`;
    case 'setVisibility':
      return `${who}が手札1枚の見える人を変えた`;
    case 'roll':
      return `${who}がサイコロを振った: ${event.value}`;
    case 'play': {
      const face = view.cards[event.cardId]?.face;
      if (event.faceUp && face) return `${who}が「${face.name}」を表向きで出した`;
      return `${who}がカードを1枚裏向きで出した`;
    }
  }
}
