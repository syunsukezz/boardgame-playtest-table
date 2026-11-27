// 卓の画面: 全画面の3D卓＋横のパネル（席・チャットとログ）＋道具バー＋上の帯（R14）。
// ホストと参加者の違いは TableAdapter で吸収する。
import type { AssetStore } from '../assets/store';
import type { CommandBody } from '../core/commands';
import type { View } from '../core/project';
import type { Placement, SeatId, Vec3 } from '../core/state';
import { createTableRenderer, type TableRenderer } from '../render/scene';
import { seatAnchor, seatLocalToWorld } from '../render/seats-layout';
import type { SeatInfo } from '../net/seats';
import { createChatPanel, type ChatPanel } from '../ui/chat-panel';
import { closeContextMenu, contextMenuItems, runMenuAction, showContextMenu } from '../ui/context-menu';
import { openDealDialog } from '../ui/deal-dialog';
import { confirmDialog } from '../ui/dialog';
import { button, h, seatLabel } from '../ui/dom';
import { openImportDialog } from '../ui/import-dialog';
import { openPiecePicker } from '../ui/piece-picker';
import { renderSeatPanel, seatPanelModel, type SeatAction, type SeatPanelInput } from '../ui/seat-panel';
import { showToast } from '../ui/toast';
import { openVisibilityDialog } from '../ui/visibility-dialog';
import { ImageCache } from './images';

/** 8席の色（つかんでいる名札と席のパネルで使う）。 */
export const SEAT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#6d4c41'] as const;

export interface TableAdapter {
  role: 'host' | 'guest';
  assets: AssetStore;
  submit(body: CommandBody): void;
  drag(objId: string, pos: Vec3): void;
  chat(text: string): void;
  /** 操作中の席。未着席なら null */
  activeSeat(): SeatId | null;
  seatPanelInput(): SeatPanelInput;
  seatAction(seat: SeatId, a: SeatAction): void;
  finishAssignment(): void;
  /** 席の表示名（ダイアログ用） */
  seatNames(): string[];
  /** ホストだけ */
  inviteUrl?: string;
  save?(): Promise<void>;
  load?(): Promise<void>;
}

export interface TableScreen {
  renderer: TableRenderer;
  chat: ChatPanel;
  setView(view: View): void;
  /** 席や操作中の席が変わったら呼ぶ（パネルと帯と視点を描き直す） */
  refreshSeats(): void;
  /** 再接続中などで操作を止める。null で解除 */
  setBlocked(message: string | null): void;
  dispose(): void;
}

export function createTableScreen(root: HTMLElement, ad: TableAdapter): TableScreen {
  const stage = h('div', { class: 'stage' });
  const banner = h('div', { class: 'banner' });
  const toolbar = h('div', { class: 'toolbar' });
  const seatPanelEl = h('section', { class: 'seat-panel' });
  const chat = createChatPanel((t) => ad.chat(t));
  const side = h('aside', { class: 'side' }, seatPanelEl, chat.root);
  const overlay = h('div', { class: 'block-overlay', hidden: true });
  const screen = h('div', { class: 'table-screen' }, stage, side, banner, toolbar, overlay);
  root.replaceChildren(screen);

  let view: View | null = null;
  let renderer!: TableRenderer;
  const images = new ImageCache(ad.assets, () => renderer.refreshImages());

  renderer = createTableRenderer(stage, {
    onCommand: (body) => ad.submit(body),
    onDragMove: (id, pos) => ad.drag(id, pos),
    onContextMenu: (target, pt) => {
      const items = contextMenuItems(target, { activeSeat: ad.activeSeat(), view });
      showContextMenu(items, pt, (it) => {
        void runMenuAction(it.action, {
          confirm: (m) => confirmDialog(m, '消す'),
          send: (b) => ad.submit(b),
          openDeal: (stackId) => {
            const o = view?.objects[stackId];
            openDealDialog({
              stackId,
              stackCount: o?.kind === 'stack' ? o.count : 0,
              seatNames: ad.seatNames(),
              send: (cmd) => ad.submit(cmd),
            });
          },
          openVisibility: (cardId) => openVisibilityDialog({ cardId, seatNames: ad.seatNames(), send: (b) => ad.submit(b) }),
        });
      });
    },
    getImage: images.get,
  });
  renderer.setSeatColors(Object.fromEntries(SEAT_COLORS.map((c, i) => [i, c])));

  /** 新しく出す物の置き場所: 操作中の席の手前（少しずらす）。 */
  const spawnPlacement = (): Placement => {
    const seat = ad.activeSeat();
    const jitter = () => (Math.random() - 0.5) * 0.6;
    if (seat === null) return { pos: { x: jitter(), y: 0, z: jitter() }, rot: 0 };
    const p = seatLocalToWorld(seat, jitter(), 0, -2.4);
    return { pos: { x: p.x, y: 0, z: p.z }, rot: seatAnchor(seat).facing };
  };

  // 道具バー（取り込み・保存・読み込みはホストだけ）
  if (ad.role === 'host') {
    toolbar.append(
      button('取り込み', () =>
        openImportDialog({
          assets: ad.assets,
          maxTextureSize: renderer.maxTextureSize,
          placement: spawnPlacement,
          submit: (b) => ad.submit(b),
        }),
      ),
    );
  }
  toolbar.append(
    button('駒', () =>
      openPiecePicker((shape, color) => ad.submit({ type: 'spawnPiece', shape, color, placement: spawnPlacement() })),
    ),
    button('サイコロを出す', () => ad.submit({ type: 'spawnDie', placement: spawnPlacement() })),
  );
  if (ad.save && ad.load) {
    const save = ad.save;
    const load = ad.load;
    toolbar.append(
      button('保存', () => void save()),
      button('読み込み', () => void load()),
    );
  }
  if (ad.inviteUrl) {
    const url = ad.inviteUrl;
    const input = h('input', { type: 'text', readonly: true, value: url, class: 'invite-url' });
    input.addEventListener('focus', () => input.select());
    const copy = button('招待URLをコピー', () => {
      navigator.clipboard.writeText(url).then(
        () => showToast('招待URLをコピーしました'),
        () => {
          input.select();
          showToast('コピーできませんでした。URLを選択したので手でコピーしてください', 'warn');
        },
      );
    });
    toolbar.append(h('div', { class: 'invite' }, input, copy));
  }

  function refreshSeats(): void {
    const seat = ad.activeSeat();
    if (seat !== null) renderer.setActiveSeat(seat);
    const input = ad.seatPanelInput();
    const isHosted = input.seats.find((s: SeatInfo) => s.seat === seat)?.status === 'hosted';
    banner.textContent =
      seat === null ? '見学中（席に座っていません）' : `${seatLabel(seat)}として操作中${isHosted ? '（兼任）' : ''}`;
    banner.style.borderColor = seat === null ? '#888' : (SEAT_COLORS[seat] ?? '#888');
    renderSeatPanel(seatPanelEl, seatPanelModel(input), SEAT_COLORS, {
      onAction: (s, a) => ad.seatAction(s, a),
      onFinish: () => ad.finishAssignment(),
    });
  }
  refreshSeats();

  return {
    renderer,
    chat,
    setView(v) {
      view = v;
      renderer.setView(v);
    },
    refreshSeats,
    setBlocked(message) {
      overlay.hidden = message === null;
      // 帯の文は CSS の attr() で出す（textContent と同じく文字列のまま）
      overlay.dataset.message = message ?? '';
      if (message !== null) closeContextMenu();
    },
    dispose() {
      closeContextMenu();
      renderer.dispose();
      images.dispose();
      screen.remove();
    },
  };
}
