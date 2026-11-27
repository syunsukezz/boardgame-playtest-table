// ロビー: 名前を入れて、部屋を作るか、招待 URL の部屋に参加する（R9）。
import { button, h } from './dom';

const NAME_KEY = 'tt-name';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 保存できなくても続ける
  }
}

export interface LobbyHandlers {
  onCreate(name: string): void;
  onJoin(name: string): void;
}

/** roomId があれば「参加する」を主にする。message はロビーに戻った理由など。 */
export function renderLobby(el: HTMLElement, roomId: string | null, handlers: LobbyHandlers, message?: string): void {
  const nameInput = h('input', { type: 'text', maxlength: 40, placeholder: '例: たろう', value: loadName() });
  const name = (): string => {
    const n = nameInput.value.trim() || (roomId ? '参加者' : 'ホスト');
    saveName(nameInput.value.trim());
    return n;
  };
  const busy = (): void => {
    for (const b of el.querySelectorAll('button')) b.disabled = true;
  };
  const actions = h('div', { class: 'row' });
  if (roomId) {
    actions.append(
      button(
        '参加する',
        () => {
          busy();
          handlers.onJoin(name());
        },
        'primary',
      ),
    );
  }
  actions.append(
    button(
      roomId ? '新しく部屋を作る' : '部屋を作る',
      () => {
        busy();
        handlers.onCreate(name());
      },
      roomId ? '' : 'primary',
    ),
  );
  el.replaceChildren(
    h(
      'div',
      { class: 'screen center' },
      h(
        'div',
        { class: 'card lobby' },
        h('h1', {}, 'ボドゲ試遊卓'),
        h('p', { class: 'muted' }, '試作中のボードゲームを、ブラウザだけで最大8人で試遊できます。'),
        message ? h('p', { class: 'notice' }, message) : null,
        roomId ? h('p', {}, '招待された部屋に参加します。') : null,
        h('label', { class: 'field' }, 'あなたの名前 ', nameInput),
        actions,
      ),
    ),
  );
  nameInput.focus();
  nameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') (actions.querySelector('button') as HTMLButtonElement | null)?.click();
  });
}
