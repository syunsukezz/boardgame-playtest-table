// 参加者側の状態画面（R28）: 満席・部屋の終了・部屋が見つからない・つながらない。
import type { ConnectionFailure } from '../net/transport';
import { button, h } from './dom';

/** つながらない理由（R28）を、考えられる原因つきの文にする。 */
export function failureMessage(reason: ConnectionFailure | undefined): { title: string; detail: string } {
  switch (reason) {
    case 'room-not-found':
      return {
        title: '部屋が見つかりません',
        detail: '招待URLが正しいか、ホストが部屋を開いたままにしているかを確かめてください。部屋はホストがタブを閉じると終わります。',
      };
    case 'network-blocked':
      return {
        title: '部屋につながりませんでした',
        detail: '学校・会社のWi-Fiなどで通信が制限されている可能性があります。別の回線（スマホのテザリングなど）で試してください。',
      };
    case 'signaling-unavailable':
      return {
        title: '部屋につながりませんでした',
        detail: '接続の仲介サーバーにつながりません。インターネットへの接続を確かめ、しばらくしてからやり直してください。',
      };
    case 'unsupported-browser':
      return {
        title: 'このブラウザでは使えません',
        detail: 'お使いのブラウザは必要な通信機能（WebRTC）に対応していません。最新の Chrome・Edge・Firefox・Safari で開いてください。',
      };
    default:
      return {
        title: '部屋につながりませんでした',
        detail: '原因は分かりませんでした。回線を確かめて、もう一度試してください。',
      };
  }
}

export interface StatusScreenAction {
  label: string;
  run(): void;
}

/** 全画面のお知らせ。 */
export function renderStatusScreen(el: HTMLElement, title: string, detail: string, actions: StatusScreenAction[]): void {
  el.replaceChildren(
    h(
      'div',
      { class: 'screen center' },
      h(
        'div',
        { class: 'card' },
        h('h1', {}, title),
        h('p', {}, detail),
        h('div', { class: 'row' }, ...actions.map((a, i) => button(a.label, a.run, i === 0 ? 'primary' : ''))),
      ),
    ),
  );
}
