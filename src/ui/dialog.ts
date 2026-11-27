// 汎用のダイアログ（モーダル）と確認。
import { button, h } from './dom';

export interface DialogHandle {
  root: HTMLElement;
  setOkEnabled(enabled: boolean): void;
  close(): void;
}

export interface DialogOptions {
  title: string;
  body: (Node | string)[];
  okLabel?: string;
  cancelLabel?: string;
  /** false を返すと閉じない。Promise も可。 */
  onOk?: () => boolean | void | Promise<boolean | void>;
  onCancel?: () => void;
  /** OK ボタンを出さない */
  noOk?: boolean;
}

export function openDialog(o: DialogOptions): DialogHandle {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const ok = button(o.okLabel ?? 'OK', () => void doOk(), 'primary');
  const cancel = button(o.cancelLabel ?? 'キャンセル', () => {
    close();
    o.onCancel?.();
  });
  const box = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h2', {}, o.title),
    h('div', { class: 'modal-body' }, ...o.body),
    h('div', { class: 'modal-actions' }, cancel, o.noOk ? null : ok),
  );
  backdrop.append(box);
  document.body.append(backdrop);
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }
  async function doOk(): Promise<void> {
    if (ok.disabled) return;
    ok.disabled = true;
    try {
      const r = o.onOk ? await o.onOk() : undefined;
      if (r !== false) close();
    } finally {
      ok.disabled = false;
    }
  }
  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      close();
      o.onCancel?.();
    }
  }
  document.addEventListener('keydown', onKey);
  setTimeout(() => (box.querySelector('input, select, button.primary') as HTMLElement | null)?.focus(), 0);
  return {
    root: box,
    setOkEnabled(enabled) {
      ok.disabled = !enabled;
    },
    close,
  };
}

/** はい／いいえの確認。 */
export function confirmDialog(message: string, okLabel = 'はい'): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog({
      title: '確認',
      body: [h('p', {}, message)],
      okLabel,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
