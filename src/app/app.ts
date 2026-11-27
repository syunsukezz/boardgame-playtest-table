// アプリの入口: ロビー → ホスト（部屋を作る）か参加者（招待 URL から参加）→ 卓の画面。
import { AssetStore } from '../assets/store';
import { project } from '../core/project';
import { cryptoRng } from '../core/rng';
import { HOST_SEAT } from '../net/seats';
import type { SeatId } from '../core/state';
import { GuestSession } from '../net/guest';
import { HostSession } from '../net/host';
import { createPeerGuest, createPeerHost } from '../net/peerjs-transport';
import { inviteUrl, parseRoomFromHash } from '../net/room';
import { ConnectionError, type ConnectionFailure } from '../net/transport';
import { dieRestPose } from '../render/scene';
import { failureMessage, renderStatusScreen } from '../ui/connection-error';
import { seatLabel } from '../ui/dom';
import { renderLobby } from '../ui/lobby';
import { loadTable, saveTable } from '../ui/save-load-panel';
import { errorMessage, showToast } from '../ui/toast';
import { createTableScreen, type TableScreen } from './table-screen';

export function startApp(root: HTMLElement): void {
  showLobby(root);
}

function showLobby(root: HTMLElement, message?: string): void {
  const roomId = parseRoomFromHash(location.hash);
  renderLobby(
    root,
    roomId,
    {
      onCreate: (name) => void startHost(root, name),
      onJoin: (name) => {
        if (roomId) startGuest(root, name, roomId);
      },
    },
    message,
  );
}

function backToLobbyAction(root: HTMLElement): { label: string; run(): void } {
  return { label: 'ロビーへ戻る', run: () => showLobby(root) };
}

// ---------------- ホスト ----------------

async function startHost(root: HTMLElement, name: string): Promise<void> {
  renderStatusScreen(root, '部屋を作っています…', '接続の仲介サーバーに登録しています。', []);
  let transport;
  let simulateRoll: typeof import('../dice/simulate').simulateRoll;
  try {
    // 物理演算（Rapier）はホストだけが使うので、ここで読み込む（参加者は読み込まない）
    const loadDice = import('../dice/simulate').then(async (m) => {
      await m.initDicePhysics();
      return m.simulateRoll;
    });
    [transport, simulateRoll] = await Promise.all([createPeerHost(), loadDice]);
  } catch (e) {
    const reason: ConnectionFailure = e instanceof ConnectionError ? e.reason : 'unknown';
    console.error(e);
    const m = failureMessage(reason === 'room-not-found' ? 'unknown' : reason);
    renderStatusScreen(root, '部屋を作れませんでした', m.detail, [
      { label: 'やり直す', run: () => void startHost(root, name) },
      backToLobbyAction(root),
    ]);
    return;
  }

  const assets = new AssetStore();
  const host: HostSession = new HostSession({
    transport,
    assets,
    seatName: (seat) => (seat === HOST_SEAT ? name : (host.getSeats()[seat]?.name ?? seatLabel(seat))),
    // 出目はホストが物理演算で決める（KTD7）。投げ始めはサイコロの今の位置。
    rollDice: (dieId) => {
      const o = host.getState().objects[dieId];
      const p = o?.placement.pos ?? { x: 0, z: 0 };
      const roll = simulateRoll(cryptoRng(), { x: p.x, z: p.z });
      // 止まった位置と向きも出目と一緒に apply へ渡す（元の位置へ戻らないように）
      const rest = dieRestPose(roll.keyframes);
      return { ...roll, rest: { pos: rest.pos, rot: rest.rot } };
    },
  });
  const invite = inviteUrl(location.origin + location.pathname, transport.roomId);

  const seatNames = (): string[] =>
    host.getSeats().map((s) => (s.status === 'host' ? name : (s.name ?? (s.status === 'hosted' ? '兼任中' : ''))));

  let lastSeat: SeatId = HOST_SEAT;
  let switching = false;
  const screen: TableScreen = createTableScreen(root, {
    role: 'host',
    assets,
    submit: (b) => void host.submit(b),
    drag: (id, pos) => host.drag(id, pos),
    chat: (t) => host.chat(t),
    activeSeat: () => host.getActiveSeat(),
    seatPanelInput: () => ({
      role: 'host',
      seats: host.getSeats(),
      assignmentPending: host.isAssignmentPending(),
      mySeat: HOST_SEAT,
      activeSeat: host.getActiveSeat(),
      participants: host.getParticipants(),
    }),
    seatAction: (seat, a) => {
      switch (a.kind) {
        case 'host':
          host.hostSeat(seat);
          break;
        case 'unhost':
          host.unhostSeat(seat);
          break;
        case 'switch':
          switching = true;
          host.setActiveSeat(seat);
          switching = false;
          break;
        case 'free':
          host.freeSeat(seat);
          break;
        case 'assign':
          if (!host.assign(a.connId, seat)) showToast('割り当てられませんでした', 'error');
          break;
        case 'sit':
          break;
      }
      screen.refreshSeats();
    },
    finishAssignment: () => host.finishAssignment(),
    seatNames,
    inviteUrl: invite,
    save: async () => {
      try {
        if (await saveTable(host.getState(), assets)) showToast('保存しました');
      } catch (e) {
        console.error(e);
        showToast('保存できませんでした', 'error');
      }
    },
    load: async () => {
      const r = await loadTable(assets, (state) => host.loadState(state));
      if (r.ok) showToast('読み込みました。参加者を席に割り当て、「割り当て完了」を押してください');
      else if (r.error) showToast(`読み込めませんでした: ${r.error}`, 'error', 6000);
    },
  });

  host.onView((view, seat) => {
    // 兼任していた席に参加者が座った・兼任を外した・読み込んだ、で自席に戻ったとき（AE9）
    if (seat !== lastSeat && seat === HOST_SEAT && !switching) showToast('視点を自席に戻しました', 'info', 5000);
    lastSeat = seat;
    screen.setView(view);
    screen.refreshSeats();
  });
  host.onSeats(() => screen.refreshSeats());
  host.onLog((t) => screen.chat.addLog(t));
  host.onChat((from, t) => screen.chat.addChat(from, t));
  host.onNotice((t) => showToast(t, 'info', 5000));
  host.onCommandError((reason) => showToast(errorMessage(reason), 'error'));
  host.onRemoteDrag((id, pos) => screen.renderer.setRemoteDrag(id, pos));
  host.onDiceRoll((dieId, keyframes) => {
    screen.renderer.playDiceRoll(dieId, keyframes);
  });

  // onView は操作があるまで来ないので、最初の卓はここで描く
  screen.setView(project(host.getState(), { kind: 'seat', seat: HOST_SEAT }));
  screen.chat.addSystem('部屋を作りました。招待URLを参加者に送ってください。');

  // タブを閉じる・再読み込みすると部屋が終わる（R27）
  window.addEventListener('beforeunload', (ev) => {
    ev.preventDefault();
    ev.returnValue = '';
  });
  window.addEventListener('pagehide', () => host.close());
  // 裏に回ったタブはタイマーが間引かれ、参加者への反映が遅れる（Risks）
  let wasHidden = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) wasHidden = true;
    else if (wasHidden) {
      wasHidden = false;
      showToast('このタブが裏に回っている間、参加者への反映が遅れます。部屋を開いている間は、このタブを表に出しておいてください', 'warn', 8000);
    }
  });
}

// ---------------- 参加者 ----------------

function storage(): { session: Storage; local: Storage } {
  return { session: sessionStorage, local: localStorage };
}

function startGuest(root: HTMLElement, name: string, roomId: string): void {
  renderStatusScreen(root, '部屋に接続しています…', '少し時間がかかることがあります。', []);
  const assets = new AssetStore();
  const guest = new GuestSession({ transport: createPeerGuest(roomId), assets, storage: storage(), roomId });
  let screen: TableScreen | null = null;

  const retry = (): void => {
    screen?.dispose();
    screen = null;
    startGuest(root, name, roomId);
  };
  const toScreen = (title: string, detail: string, actions: { label: string; run(): void }[]): void => {
    screen?.dispose();
    screen = null;
    renderStatusScreen(root, title, detail, actions);
  };

  const seatNames = (): string[] =>
    guest.getSeats().map((s) => s.name ?? (s.status === 'host' ? 'ホスト' : s.status === 'hosted' ? '兼任中' : ''));

  const ensureScreen = (): TableScreen => {
    if (screen) return screen;
    const sc = createTableScreen(root, {
      role: 'guest',
      assets,
      submit: (b) => void guest.submit(b),
      drag: (id, pos) => guest.drag(id, pos),
      chat: (t) => guest.chat(t),
      activeSeat: () => guest.getSeat(),
      seatPanelInput: () => ({
        role: 'guest',
        seats: guest.getSeats(),
        assignmentPending: guest.isAssignmentPending(),
        mySeat: guest.getSeat(),
        activeSeat: guest.getSeat(),
        participants: [],
      }),
      seatAction: (seat: SeatId, a) => {
        if (a.kind === 'sit') guest.sit(seat);
      },
      finishAssignment: () => {},
      seatNames,
    });
    const v = guest.getView();
    if (v) sc.setView(v);
    screen = sc;
    return sc;
  };

  guest.onView((v) => screen?.setView(v));
  guest.onSeats(() => screen?.refreshSeats());
  guest.onLog((t) => screen?.chat.addLog(t));
  guest.onChat((from, t) => screen?.chat.addChat(from, t));
  guest.onError((reason) => showToast(errorMessage(reason), 'error'));
  guest.onRemoteDrag((id, pos) => screen?.renderer.setRemoteDrag(id, pos));
  guest.onDiceRoll((id, kf) => screen?.renderer.playDiceRoll(id, kf));
  guest.onStatus((status, reason) => {
    switch (status) {
      case 'connecting':
        return;
      case 'connected': {
        const sc = ensureScreen();
        sc.setBlocked(null);
        sc.refreshSeats();
        return;
      }
      case 'reconnecting':
        if (screen) screen.setBlocked('再接続中です… 接続が戻るまで操作できません');
        else renderStatusScreen(root, '部屋に接続しています…', '接続をやり直しています。', []);
        return;
      case 'full':
        return toScreen('満席です', 'この部屋は席がすべて埋まっています。空席ができたら、やり直してください。', [
          { label: 'やり直す', run: retry },
          backToLobbyAction(root),
        ]);
      case 'closed':
        return toScreen('部屋が終了しました', 'ホストが部屋を閉じたか、別のタブでこの席に入り直しました。', [
          backToLobbyAction(root),
        ]);
      case 'failed': {
        const m = failureMessage(reason);
        return toScreen(m.title, m.detail, [{ label: 'やり直す', run: retry }, backToLobbyAction(root)]);
      }
    }
  });
  void guest.join(name);
}
