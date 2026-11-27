// チャットと操作ログ（R11）。利用者の文字列は textContent だけで描く（innerHTML は使わない）。
import { CHAT_MAX_LENGTH } from '../net/chat';
import { h } from './dom';

const MAX_LINES = 500;

export interface ChatPanel {
  root: HTMLElement;
  addChat(from: string, text: string): void;
  addLog(text: string): void;
  addSystem(text: string): void;
}

export function createChatPanel(send: (text: string) => void): ChatPanel {
  const lines = h('div', { class: 'chat-lines', role: 'log' });
  const input = h('input', { type: 'text', maxlength: CHAT_MAX_LENGTH, placeholder: 'メッセージを入力して Enter' });
  const form = h('form', { class: 'chat-form' }, input, h('button', { type: 'submit' }, '送信'));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    send(t);
    input.value = '';
  });
  // チャット入力中のキーを卓に渡さない
  input.addEventListener('keydown', (ev) => ev.stopPropagation());
  const root = h('section', { class: 'chat-panel' }, h('h3', {}, 'チャットとログ'), lines, form);

  function push(el: HTMLElement): void {
    const atBottom = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 30;
    lines.append(el);
    while (lines.childElementCount > MAX_LINES) lines.firstElementChild?.remove();
    if (atBottom) lines.scrollTop = lines.scrollHeight;
  }
  return {
    root,
    addChat(from, text) {
      push(h('div', { class: 'line chat' }, h('span', { class: 'from' }, from), h('span', { class: 'text' }, text)));
    },
    addLog(text) {
      push(h('div', { class: 'line log' }, text));
    },
    addSystem(text) {
      push(h('div', { class: 'line system' }, text));
    },
  };
}
