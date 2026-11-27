// 席のパネル（R14, R20, R21, R26）。表示内容と操作の候補は seatPanelModel（純粋な関数）で決める。
import type { SeatId } from '../core/state';
import type { Participant } from '../net/host';
import type { SeatInfo, SeatStatus } from '../net/seats';
import { button, h, seatLabel } from './dom';

export type SeatAction =
  | { kind: 'host' }
  | { kind: 'unhost' }
  | { kind: 'switch' }
  | { kind: 'free' }
  | { kind: 'sit' }
  | { kind: 'assign'; connId: string; name: string };

export interface SeatRow {
  seat: SeatId;
  title: string;
  statusText: string;
  name?: string;
  /** 自分が今その席として操作しているか */
  active: boolean;
  actions: SeatAction[];
}

export interface SeatPanelInput {
  role: 'host' | 'guest';
  seats: SeatInfo[];
  assignmentPending: boolean;
  /** 自分の席（ホストは自席 0）。未着席なら null */
  mySeat: SeatId | null;
  /** 操作中の席。未着席なら null */
  activeSeat: SeatId | null;
  /** 接続中の参加者（ホストだけ使う） */
  participants: Participant[];
}

export interface SeatPanelModel {
  rows: SeatRow[];
  notice?: string;
  canFinishAssignment: boolean;
}

const STATUS_TEXT: Record<SeatStatus, string> = {
  host: 'ホスト',
  empty: '空席',
  occupied: '着席中',
  hosted: '兼任中',
  disconnected: '切断中',
};

export const WAITING_ASSIGNMENT = 'ホストが席を割り当てるのを待っています';

export function seatPanelModel(input: SeatPanelInput): SeatPanelModel {
  const isHost = input.role === 'host';
  const unseated = input.participants.filter((p) => p.seat === null);
  const rows = input.seats.map((s): SeatRow => {
    const actions: SeatAction[] = [];
    const active = input.activeSeat === s.seat;
    if (isHost) {
      switch (s.status) {
        case 'host':
          if (!active) actions.push({ kind: 'switch' });
          break;
        case 'empty':
          actions.push({ kind: 'host' });
          break;
        case 'hosted':
          if (!active) actions.push({ kind: 'switch' });
          actions.push({ kind: 'unhost' });
          break;
        case 'occupied':
        case 'disconnected':
          actions.push({ kind: 'free' });
          break;
      }
      if (input.assignmentPending && (s.status === 'empty' || s.status === 'hosted')) {
        for (const p of unseated) actions.push({ kind: 'assign', connId: p.connId, name: p.name });
      }
    } else if (input.mySeat === null && !input.assignmentPending && (s.status === 'empty' || s.status === 'hosted')) {
      actions.push({ kind: 'sit' });
    }
    const row: SeatRow = { seat: s.seat, title: seatLabel(s.seat), statusText: STATUS_TEXT[s.status], active, actions };
    if (s.name !== undefined) row.name = s.name;
    return row;
  });
  const model: SeatPanelModel = { rows, canFinishAssignment: isHost && input.assignmentPending };
  if (!isHost && input.mySeat === null) {
    model.notice = input.assignmentPending ? WAITING_ASSIGNMENT : '空いている席を選んで座ってください';
  } else if (isHost && input.assignmentPending) {
    model.notice = '読み込んだ卓に参加者を割り当て、最後に「割り当て完了」を押してください';
  }
  return model;
}

export function seatActionLabel(a: SeatAction): string {
  switch (a.kind) {
    case 'host':
      return '兼任する';
    case 'unhost':
      return '兼任をやめる';
    case 'switch':
      return 'この席で操作';
    case 'free':
      return '空席に戻す';
    case 'sit':
      return 'この席に座る';
    case 'assign':
      return `${a.name}を座らせる`;
  }
}

/** パネルを描く。操作は onAction、割り当て完了は onFinish。 */
export function renderSeatPanel(
  el: HTMLElement,
  model: SeatPanelModel,
  colors: readonly string[],
  handlers: { onAction(seat: SeatId, a: SeatAction): void; onFinish(): void },
): void {
  const list = h('ul', { class: 'seat-list' });
  for (const r of model.rows) {
    const dot = h('span', { class: 'seat-dot' });
    dot.style.background = colors[r.seat] ?? '#888';
    const li = h(
      'li',
      { class: r.active ? 'seat active' : 'seat' },
      h('div', { class: 'seat-head' }, dot, h('strong', {}, r.title), h('span', { class: 'muted' }, r.statusText), r.name ? h('span', { class: 'seat-name' }, r.name) : null),
    );
    if (r.actions.length) {
      const acts = h('div', { class: 'seat-actions' });
      for (const a of r.actions) acts.append(button(seatActionLabel(a), () => handlers.onAction(r.seat, a), 'small'));
      li.append(acts);
    }
    list.append(li);
  }
  const parts: Node[] = [h('h3', {}, '席')];
  if (model.notice) parts.push(h('p', { class: 'notice' }, model.notice));
  parts.push(list);
  if (model.canFinishAssignment) parts.push(button('割り当て完了', handlers.onFinish, 'primary'));
  el.replaceChildren(...parts);
}
