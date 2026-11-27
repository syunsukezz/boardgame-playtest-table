import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetStore } from '../../src/assets/store';
import { project, type View } from '../../src/core/project';
import { seededRng } from '../../src/core/rng';
import type { TableState } from '../../src/core/state';
import { GuestSession, type StorageLike } from '../../src/net/guest';
import { HostSession } from '../../src/net/host';
import { createMemoryNetwork, type MemoryLink, type MemoryNetwork } from '../../src/net/memory-transport';
import { inviteUrl, parseRoomFromHash } from '../../src/net/room';

const origin = { pos: { x: 0, y: 0, z: 0 }, rot: 0 };
const at = { x: 1, y: 0, z: 1 };

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** マイクロタスクとタイマーを進めて、メッセージを行き渡らせる。 */
async function flush(ms = 0): Promise<void> {
  for (let i = 0; i < 300; i++) await Promise.resolve();
  if (ms > 0) await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 300; i++) await Promise.resolve();
}

interface G {
  g: GuestSession;
  link: MemoryLink;
  storage: { session: StorageLike; local: StorageLike };
  views: View[];
  statuses: string[];
  errors: string[];
  assets: AssetStore;
}

function raw(link: MemoryLink): string {
  return JSON.stringify(link.guestSide.received);
}

let net: MemoryNetwork;
let host: HostSession;
let hostAssets: AssetStore;

function makeHost(): void {
  net = createMemoryNetwork();
  hostAssets = new AssetStore();
  host = new HostSession({ transport: net.host, assets: hostAssets, rng: seededRng(7) });
}

async function addGuest(
  name: string,
  storage = { session: memStorage(), local: memStorage() },
  reconnectDelaysMs = [100],
): Promise<G> {
  const assets = new AssetStore();
  const g = new GuestSession({ transport: net.guestTransport(), assets, storage, roomId: 'tt-test', reconnectDelaysMs });
  const out: G = { g, link: undefined as unknown as MemoryLink, storage, views: [], statuses: [], errors: [], assets };
  g.onView((v) => out.views.push(v));
  g.onStatus((s) => out.statuses.push(s));
  g.onError((r) => out.errors.push(r));
  await g.join(name);
  await flush();
  out.link = net.links.at(-1)!;
  return out;
}

async function sit(x: G, seat: number): Promise<void> {
  x.g.sit(seat);
  await flush();
}

/** n 枚の山札を置き、その ID を返す。表は face-i、裏は back。 */
function spawnDeck(n: number): string {
  const cards = Array.from({ length: n }, (_, i) => ({ faceHash: `face-${i}`, backHash: 'back', name: `カード${i}` }));
  const r = host.submit({ type: 'spawnDeck', cards, placement: origin });
  expect(r.ok).toBe(true);
  return Object.values(host.getState().objects).find((o) => o.kind === 'stack')!.id;
}

function handFaces(state: TableState, seat: number): string[] {
  return state.hands[seat]!.map((id) => state.cards[id]!.faceHash);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  makeHost();
});

afterEach(() => {
  host.close();
  vi.useRealTimers();
});

describe('招待 URL', () => {
  it('#room= 付きの URL を作り、読み取れる', () => {
    const url = inviteUrl('https://example.com/app/', 'tt-abcd2345');
    expect(url).toBe('https://example.com/app/#room=tt-abcd2345');
    expect(parseRoomFromHash('#room=tt-abcd2345')).toBe('tt-abcd2345');
    expect(parseRoomFromHash('')).toBeNull();
  });
});

describe('ホストと参加者2人', () => {
  it('参加者の「配る」が全員に反映され、ほかの席には受け手だけに見えるカードの中身が届かない', async () => {
    const stackId = spawnDeck(10);
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    const hostViews: View[] = [];
    host.onView((v) => hostViews.push(v));

    a.g.submit({ type: 'deal', stackId, count: 3, seats: [1, 2], visibility: 'recipient' });
    await flush();

    const state = host.getState();
    expect(state.hands[1]).toHaveLength(3);
    expect(state.hands[2]).toHaveLength(3);
    // 全員に反映（rev がそろう）
    expect(a.g.getView()!.rev).toBe(state.rev);
    expect(b.g.getView()!.rev).toBe(state.rev);
    expect(hostViews.at(-1)!.rev).toBe(state.rev);
    expect(a.g.getView()).toEqual(project(state, { kind: 'seat', seat: 1 }));
    expect(b.g.getView()).toEqual(project(state, { kind: 'seat', seat: 2 }));
    // B が受け取った生のメッセージに、A の手札の表が入っていない
    const bRaw = raw(b.link);
    for (const f of handFaces(state, 1)) expect(bRaw).not.toContain(`"${f}"`);
    for (const f of handFaces(state, 2)) expect(bRaw).toContain(`"${f}"`);
    // ログは両方に届く
    expect(b.link.guestSide.received.some((m) => (m as { type: string }).type === 'log')).toBe(true);
  });

  it('未着席の参加者には手札の中身が届かない', async () => {
    const stackId = spawnDeck(6);
    const a = await addGuest('A');
    const spectator = await addGuest('S');
    await sit(a, 1);
    host.submit({ type: 'deal', stackId, count: 2, seats: [0, 1], visibility: 'recipient' });
    await flush();
    const state = host.getState();
    const sRaw = raw(spectator.link);
    for (const f of [...handFaces(state, 0), ...handFaces(state, 1)]) expect(sRaw).not.toContain(`"${f}"`);
    expect(spectator.g.getView()).toEqual(project(state, { kind: 'spectator' }));
  });

  it('参加者の操作が失敗したら、その参加者にだけ理由が返る', async () => {
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    const cmdId = a.g.submit({ type: 'shuffle', stackId: 'nope' });
    await flush();
    expect(a.errors).toContain('not-found');
    expect(b.errors).toHaveLength(0);
    expect(cmdId).toBeTruthy();
  });
});

describe('再接続（KTD6）', () => {
  it('Covers AE3. 切断して同じ鍵で再接続すると同じ席に戻り、その席の切り出しだけを受け取る', async () => {
    const stackId = spawnDeck(10);
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    host.submit({ type: 'deal', stackId, count: 3, seats: [1, 2], visibility: 'recipient' });
    await flush();

    a.link.drop();
    await flush();
    expect(host.getSeats()[1]!.status).toBe('disconnected');
    expect(a.statuses).toContain('reconnecting');

    await flush(150);
    const newLink = net.links.at(-1)!;
    expect(newLink).not.toBe(a.link);
    expect(host.getSeats()[1]!.status).toBe('occupied');
    expect(a.g.getSeat()).toBe(1);
    const state = host.getState();
    const snap = newLink.guestSide.received.find((m) => (m as { type: string }).type === 'snapshot') as { view: View };
    expect(snap.view).toEqual(project(state, { kind: 'seat', seat: 1 }));
    const newRaw = raw(newLink);
    for (const f of handFaces(state, 2)) expect(newRaw).not.toContain(`"${f}"`);
    expect(a.g.getView()).toEqual(project(state, { kind: 'seat', seat: 1 }));
  });

  it('生存確認が切れる前に同じ鍵で入り直しても同じ席に戻り、古い接続には何も送られない', async () => {
    const stackId = spawnDeck(4);
    const storage = { session: memStorage(), local: memStorage() };
    const a1 = await addGuest('A', storage);
    await sit(a1, 1);
    // 同じタブの再読み込み（古い接続はまだ生きている）
    const a2 = await addGuest('A', storage);
    expect(a2.g.getSeat()).toBe(1);
    expect(host.getSeats()[1]!.status).toBe('occupied');
    const before = a1.link.guestSide.received.length;
    host.submit({ type: 'deal', stackId, count: 1, seats: [1], visibility: 'recipient' });
    await flush(3000);
    expect(a1.link.guestSide.received.length).toBe(before);
    expect(a2.g.getView()).toEqual(project(host.getState(), { kind: 'seat', seat: 1 }));
    expect(a1.statuses.at(-1)).toBe('closed');
  });

  it('同じブラウザの2タブ（sessionStorage は別、localStorage は共有）が別々の席に座れる', async () => {
    const local = memStorage();
    const t1 = await addGuest('T1', { session: memStorage(), local });
    await sit(t1, 1);
    const t2 = await addGuest('T2', { session: memStorage(), local });
    // localStorage の鍵では着席中の席を奪わない
    expect(t2.g.getSeat()).toBeNull();
    expect(host.getSeats()[1]!.name).toBe('T1');
    await sit(t2, 2);
    expect(t1.g.getSeat()).toBe(1);
    expect(t2.g.getSeat()).toBe(2);
  });

  it('別の鍵では着席中の席に座れない', async () => {
    const a = await addGuest('A');
    await sit(a, 1);
    const session = memStorage();
    session.setItem('tt-seat-key:tt-test', 'not-the-right-key');
    const c = await addGuest('C', { session, local: memStorage() });
    expect(c.g.getSeat()).toBeNull();
    await sit(c, 1);
    expect(c.g.getSeat()).toBeNull();
    expect(c.errors).toContain('seat-taken');
    expect(host.getSeats()[1]!.name).toBe('A');
  });
});

describe('兼任（R14, R20）', () => {
  it('Covers AE9. 兼任中の席に参加者が座ると手札を引き継ぎ、ホストの操作中の席が自席に戻る', async () => {
    const stackId = spawnDeck(5);
    expect(host.hostSeat(3)).toBe(true);
    host.submit({ type: 'deal', stackId, count: 3, seats: [3], visibility: 'recipient' });
    expect(host.setActiveSeat(3)).toBe(true);
    expect(host.getActiveSeat()).toBe(3);
    const notices: string[] = [];
    const hostViewers: number[] = [];
    host.onNotice((t) => notices.push(t));
    host.onView((_v, seat) => hostViewers.push(seat));

    const a = await addGuest('A');
    await sit(a, 3);
    const state = host.getState();
    const visible = Object.values(a.g.getView()!.cards).filter((c) => c.face && c.loc.type === 'hand' && c.loc.seat === 3);
    expect(visible).toHaveLength(3);
    expect(host.getActiveSeat()).toBe(0);
    expect(hostViewers.at(-1)).toBe(0);
    expect(notices).toHaveLength(1);
    expect(host.getSeats()[3]!.status).toBe('occupied');
    expect(handFaces(state, 3)).toHaveLength(3);
  });

  it('兼任していない席・着席中の席には視点を切り替えられない', async () => {
    const a = await addGuest('A');
    await sit(a, 1);
    expect(host.setActiveSeat(1)).toBe(false);
    expect(host.setActiveSeat(4)).toBe(false);
    expect(host.getActiveSeat()).toBe(0);
  });
});

describe('満席と途中参加（R9, R26）', () => {
  it('ホストと7人で満席なら次の人は入れず、空席に戻せば途中から入れる', async () => {
    const stackId = spawnDeck(20);
    const guests: G[] = [];
    for (let s = 1; s <= 7; s++) {
      const x = await addGuest(`P${s}`);
      await sit(x, s);
      guests.push(x);
    }
    const ninth = await addGuest('P9');
    expect(ninth.statuses).toContain('full');
    const ninthTypes = ninth.link.guestSide.received.map((m) => (m as { type: string }).type);
    expect(ninthTypes).toContain('roomFull');
    expect(ninthTypes).not.toContain('snapshot');

    host.submit({ type: 'deal', stackId, count: 1, seats: [1, 2, 3], visibility: 'recipient' });
    await flush();
    guests[2]!.g.leave();
    await flush();
    expect(host.getSeats()[3]!.status).toBe('disconnected');
    expect(host.freeSeat(3)).toBe(true);
    expect(host.getSeats()[3]!.status).toBe('empty');

    const late = await addGuest('Late');
    expect(late.statuses).not.toContain('full');
    await sit(late, 3);
    expect(late.g.getSeat()).toBe(3);
    expect(late.g.getView()).toEqual(project(host.getState(), { kind: 'seat', seat: 3 }));
  });

  it('切断中の席を空席に戻しても、手札は state に残る', async () => {
    const stackId = spawnDeck(5);
    const a = await addGuest('A');
    await sit(a, 1);
    host.submit({ type: 'deal', stackId, count: 2, seats: [1], visibility: 'recipient' });
    await flush();
    a.g.leave();
    await flush();
    expect(host.freeSeat(1)).toBe(true);
    expect(host.getSeats()[1]!.status).toBe('empty');
    expect(host.getState().hands[1]).toHaveLength(2);
  });
});

describe('取り直し（KTD2）', () => {
  it('差分の元の rev が合わなければスナップショットを取り直し、ホストの切り出しと一致する', async () => {
    const stackId = spawnDeck(5);
    const a = await addGuest('A');
    await sit(a, 1);
    host.submit({ type: 'deal', stackId, count: 2, seats: [1], visibility: 'recipient' });
    await flush();
    // 抜けたイベントを模して、元の rev がずれた差分を差し込む
    const bogus = { rev: 999, setCards: {}, removeCards: [], setObjects: {}, removeObjects: [], hands: {}, heldBy: { x: 5 } };
    a.link.hostSide.send({ type: 'patch', patch: bogus, baseRev: 998 });
    await flush();
    expect(a.link.hostSide.received.some((m) => (m as { type: string }).type === 'resync')).toBe(true);
    expect(a.g.getView()).toEqual(project(host.getState(), { kind: 'seat', seat: 1 }));
  });
});

describe('チャット（R11）', () => {
  it('hostName を渡すと、ホストの発言とログの名前になる', async () => {
    host.close();
    net = createMemoryNetwork();
    hostAssets = new AssetStore();
    host = new HostSession({ transport: net.host, assets: hostAssets, rng: seededRng(7), hostName: 'ゆう' });
    const a = await addGuest('A');
    await sit(a, 1);
    const got: string[] = [];
    a.g.onChat((from) => got.push(from));
    host.chat('やあ');
    await flush();
    expect(got).toEqual(['ゆう']);
  });

  it('HTML のような文字列もそのまま届き、長すぎる文は500文字に切られる', async () => {
    const a = await addGuest('A');
    const b = await addGuest('B');
    const got: { from: string; text: string }[] = [];
    const hostGot: string[] = [];
    b.g.onChat((from, text) => got.push({ from, text }));
    host.onChat((_from, text) => hostGot.push(text));
    a.g.chat('<b>x</b>');
    a.g.chat('あ'.repeat(600));
    await flush();
    expect(got[0]).toEqual({ from: 'A', text: '<b>x</b>' });
    expect(got[1]!.text).toHaveLength(500);
    expect(hostGot[0]).toBe('<b>x</b>');
    host.chat('hello');
    await flush();
    expect(got[2]!.text).toBe('hello');
  });
});

describe('生存確認とつかみ（KTD6, KTD10）', () => {
  it('10秒何も届かなければ切断とみなす', async () => {
    // 参加者側の自動再接続で席が戻らないよう、再接続を十分遅らせる
    const a = await addGuest('A', undefined, [60_000]);
    await sit(a, 1);
    const history: string[] = [];
    host.onSeats((seats) => history.push(seats[1]!.status));
    a.link.stall();
    await flush(8000);
    expect(host.getSeats()[1]!.status).toBe('occupied');
    await flush(4000);
    expect(host.getSeats()[1]!.status).toBe('disconnected');
    expect(history).toContain('disconnected');
  });

  it('切断したら、5秒を待たずにその席のつかみを解く', async () => {
    host.submit({ type: 'spawnPiece', shape: 'cube', color: '#f00', placement: origin });
    const pieceId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    await sit(a, 1);
    a.g.submit({ type: 'grab', objId: pieceId });
    await flush();
    expect(host.getState().heldBy[pieceId]).toBe(1);
    a.g.leave();
    await flush();
    expect(host.getSeats()[1]!.status).toBe('disconnected');
    expect(host.getState().heldBy[pieceId]).toBeUndefined();
  });

  it('つかんだまま5秒何も送らないと、つかみが解けてほかの席がつかめる', async () => {
    host.submit({ type: 'spawnPiece', shape: 'cube', color: '#f00', placement: origin });
    const pieceId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    a.g.submit({ type: 'grab', objId: pieceId });
    await flush();
    // ドラッグを送っている間は解けない
    for (let i = 0; i < 4; i++) {
      a.g.drag(pieceId, { x: i, y: 0, z: 0 });
      await flush(2000);
    }
    expect(host.getState().heldBy[pieceId]).toBe(1);
    await flush(6000);
    expect(host.getState().heldBy[pieceId]).toBeUndefined();
    expect(host.getSeats()[1]!.status).toBe('occupied');
    b.g.submit({ type: 'grab', objId: pieceId });
    await flush();
    expect(host.getState().heldBy[pieceId]).toBe(2);
  });

  it('サイコロの動きの記録はホストと全参加者に届き、参加者が送った出目は使われない', async () => {
    host.close();
    net = createMemoryNetwork();
    hostAssets = new AssetStore();
    host = new HostSession({
      transport: net.host,
      assets: hostAssets,
      rng: seededRng(7),
      rollDice: () => ({ value: 4, keyframes: [0, 0, 1, 0, 0, 0, 0, 1] }),
    });
    host.submit({ type: 'spawnDie', placement: origin });
    const dieId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    const bRolls: unknown[] = [];
    const hostRolls: unknown[] = [];
    b.g.onDiceRoll((id, kf) => bRolls.push({ id, kf }));
    host.onDiceRoll((id, kf) => hostRolls.push({ id, kf }));
    a.g.submit({ type: 'roll', dieId, outcome: { value: 6 } });
    await flush();
    expect(bRolls).toEqual([{ id: dieId, kf: [0, 0, 1, 0, 0, 0, 0, 1] }]);
    expect(hostRolls).toHaveLength(1);
    expect(host.getState().objects[dieId]).toMatchObject({ value: 4 });
  });

  it('ホスト自身のドラッグ位置は参加者に届き、ホスト自身には返らない', async () => {
    host.submit({ type: 'spawnPiece', shape: 'cube', color: '#f00', placement: origin });
    const pieceId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    await sit(a, 1);
    const aDrags: unknown[] = [];
    const hostDrags: unknown[] = [];
    a.g.onRemoteDrag((objId, pos, seat) => aDrags.push({ objId, pos, seat }));
    host.onRemoteDrag((objId, pos, seat) => hostDrags.push({ objId, pos, seat }));
    // 画面はドラッグを始めるときにつかむ（つかんでいない物の位置は中継しない）
    host.submit({ type: 'grab', objId: pieceId });
    host.drag(pieceId, { x: 3, y: 0, z: 1 });
    await flush(200);
    expect(aDrags).toEqual([{ objId: pieceId, pos: { x: 3, y: 0, z: 1 }, seat: 0 }]);
    expect(hostDrags).toEqual([]);
  });

  it('ドラッグ中の位置はほかの参加者とホストに届き、間引かれ、ログにも rev にも入らない', async () => {
    host.submit({ type: 'spawnPiece', shape: 'cube', color: '#f00', placement: origin });
    const pieceId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    a.g.submit({ type: 'grab', objId: pieceId });
    await flush();
    const rev = host.getState().rev;
    const bDrags: unknown[] = [];
    const hostDrags: unknown[] = [];
    b.g.onRemoteDrag((objId, pos, seat) => bDrags.push({ objId, pos, seat }));
    host.onRemoteDrag((objId, pos, seat) => hostDrags.push({ objId, pos, seat }));
    for (let i = 0; i < 10; i++) {
      a.g.drag(pieceId, { x: i, y: 0, z: 0 });
      await flush(5);
    }
    await flush(200);
    expect(bDrags.length).toBeGreaterThan(0);
    expect(bDrags.length).toBeLessThan(10);
    expect(bDrags.at(-1)).toEqual({ objId: pieceId, pos: { x: 9, y: 0, z: 0 }, seat: 1 });
    expect(hostDrags.at(-1)).toEqual({ objId: pieceId, pos: { x: 9, y: 0, z: 0 }, seat: 1 });
    expect(host.getState().rev).toBe(rev);
    expect(b.link.guestSide.received.some((m) => (m as { type: string }).type === 'log')).toBe(false);
  });
});

describe('画像の配布（KTD4）', () => {
  /** ハッシュごとに中身の違う画像。チャンクの境目をまたぐよう少し大きくする。 */
  function bytesOf(hash: string): Uint8Array {
    const b = new Uint8Array(70 * 1024 + hash.length);
    for (let i = 0; i < b.length; i++) b[i] = (i * 31 + hash.charCodeAt(i % hash.length)) & 0xff;
    return b;
  }
  function putAsset(hash: string): void {
    hostAssets.put({ hash, mime: 'image/png', bytes: bytesOf(hash) });
  }
  function begins(link: MemoryLink): string[] {
    return link.guestSide.received
      .filter((m) => (m as { type: string }).type === 'asset-begin')
      .map((m) => (m as { hash: string }).hash);
  }

  it('表の画像は見えるようになってから届き、同じ画像は二度送られない', async () => {
    putAsset('back');
    for (let i = 0; i < 6; i++) putAsset(`face-${i}`);
    const stackId = spawnDeck(6);
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    expect(begins(a.link)).toEqual(['back']);
    expect(a.assets.has('back')).toBe(true);

    host.submit({ type: 'deal', stackId, count: 1, seats: [1], visibility: 'recipient' });
    await flush();
    const aFace = handFaces(host.getState(), 1)[0]!;
    expect(a.assets.has(aFace)).toBe(true);
    // PeerJS のバイナリ送信と同じく ArrayBuffer で届いても、中身がそろう
    expect(a.assets.get(aFace)!.bytes).toEqual(bytesOf(aFace));
    expect(a.assets.get('back')!.bytes).toEqual(bytesOf('back'));
    expect(begins(b.link)).not.toContain(aFace);

    const cardId = host.getState().hands[1]![0]!;
    a.g.submit({ type: 'play', cardId, pos: at });
    await flush();
    expect(begins(b.link)).toContain(aFace);
    expect(b.assets.has(aFace)).toBe(true);
    expect(b.assets.get(aFace)!.bytes).toEqual(bytesOf(aFace));
    // A には二度送られない
    expect(begins(a.link).filter((h) => h === aFace)).toHaveLength(1);
    expect(begins(a.link).filter((h) => h === 'back')).toHaveLength(1);
  });
});

describe('保存の読み込み（R21）', () => {
  it('全員が未着席になり、割り当て完了まで自分で座れず、ホストが割り当てると新しい鍵で座る', async () => {
    const stackId = spawnDeck(6);
    const a = await addGuest('A');
    await sit(a, 1);
    host.submit({ type: 'deal', stackId, count: 2, seats: [1], visibility: 'recipient' });
    await flush();
    const oldKey = a.storage.session.getItem('tt-seat-key:tt-test');
    expect(oldKey).toBeTruthy();

    const loaded = structuredClone(host.getState());
    host.loadState(loaded);
    await flush();
    expect(a.g.getSeat()).toBeNull();
    expect(a.g.getView()).toEqual(project(loaded, { kind: 'spectator' }));
    const aRawAfter = JSON.stringify(a.link.guestSide.received.slice(-3));
    for (const f of handFaces(loaded, 1)) expect(aRawAfter).not.toContain(`"${f}"`);

    await sit(a, 1);
    expect(a.g.getSeat()).toBeNull();
    expect(a.errors).toContain('assignment-pending');

    const p = host.getParticipants().find((x) => x.name === 'A')!;
    expect(host.assign(p.connId, 1)).toBe(true);
    await flush();
    expect(a.g.getSeat()).toBe(1);
    const newKey = a.storage.session.getItem('tt-seat-key:tt-test');
    expect(newKey).toBeTruthy();
    expect(newKey).not.toBe(oldKey);
    expect(a.g.getView()).toEqual(project(host.getState(), { kind: 'seat', seat: 1 }));
    host.finishAssignment();
    const b = await addGuest('B');
    await sit(b, 2);
    expect(b.g.getSeat()).toBe(2);
  });
});

describe('壊れた操作への耐性', () => {
  /** 参加者の接続から生のメッセージを送る（GuestSession を通さない）。 */
  function sendRaw(x: G, msg: unknown): void {
    x.link.guestSide.send(msg);
  }
  function errorsOf(x: G): string[] {
    return x.link.guestSide.received
      .filter((m) => (m as { type: string }).type === 'error')
      .map((m) => (m as { reason: string }).reason);
  }

  it('不正な見える人・配列でない席・位置の無い移動は invalid-args で拒否され、部屋はほかの参加者に配信を続ける', async () => {
    const stackId = spawnDeck(6);
    host.submit({ type: 'spawnPiece', shape: 'cube', color: '#f00', placement: origin });
    const pieceId = Object.values(host.getState().objects).find((o) => o.kind === 'piece')!.id;
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    const rev = host.getState().rev;
    const bad: unknown[] = [
      { type: 'deal', stackId, count: 1, seats: [1], visibility: 'bogus', cmdId: 'x1' },
      { type: 'deal', stackId, count: 1, seats: 1, visibility: 'recipient', cmdId: 'x2' },
      { type: 'move', objId: pieceId, cmdId: 'x3' },
      { type: 'move', objId: pieceId, pos: { x: 'a', y: 0, z: 0 }, cmdId: 'x4' },
      { type: 'setVisibility', cardId: 'c', visibility: { kind: 'seats' }, cmdId: 'x5' },
      { type: 'spawnDeck', cards: [{ faceHash: 1 }], placement: origin, cmdId: 'x6' },
      { type: 'nope', cmdId: 'x7' },
    ];
    for (const cmd of bad) sendRaw(a, { type: 'command', cmd });
    await flush();
    expect(errorsOf(a)).toEqual(Array(bad.length).fill('invalid-args'));
    expect(errorsOf(b)).toEqual([]);
    expect(host.getState().rev).toBe(rev);
    // 部屋は動き続ける
    b.g.submit({ type: 'draw', stackId, count: 1 });
    await flush();
    expect(host.getState().hands[2]).toHaveLength(1);
    expect(a.g.getView()!.rev).toBe(host.getState().rev);
    expect(b.g.getView()).toEqual(project(host.getState(), { kind: 'seat', seat: 2 }));
  });

  it('数値でないドラッグ位置は中継しない', async () => {
    host.submit({ type: 'spawnPiece', shape: 'cube', color: '#f00', placement: origin });
    const pieceId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    a.g.submit({ type: 'grab', objId: pieceId });
    await flush();
    const bDrags: unknown[] = [];
    b.g.onRemoteDrag((objId, pos) => bDrags.push({ objId, pos }));
    sendRaw(a, { type: 'drag', objId: pieceId, pos: { x: 'x', y: 0, z: 0 } });
    sendRaw(a, { type: 'drag', objId: pieceId });
    sendRaw(a, { type: 'drag', objId: pieceId, pos: { x: Infinity, y: 0, z: 0 } });
    await flush(200);
    expect(bDrags).toEqual([]);
  });

  it('処理中に例外が出ても、データの受信処理から外へ漏れず、その参加者にだけ理由を返す', async () => {
    host.close();
    net = createMemoryNetwork();
    hostAssets = new AssetStore();
    host = new HostSession({
      transport: net.host,
      assets: hostAssets,
      rng: seededRng(7),
      rollDice: () => {
        throw new Error('物理演算の失敗');
      },
    });
    host.submit({ type: 'spawnDie', placement: origin });
    const dieId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // MemoryEnd は受信コールバックの例外をそのまま投げるので、漏れれば未処理の例外になる
    a.g.submit({ type: 'roll', dieId });
    await flush();
    spy.mockRestore();
    expect(errorsOf(a)).toEqual(['invalid-args']);
    expect(errorsOf(b)).toEqual([]);
    b.g.chat('まだ動いている');
    await flush();
    expect(a.link.guestSide.received.some((m) => (m as { type: string }).type === 'chat')).toBe(true);
  });
});

describe('離した後のドラッグ中継', () => {
  it('参加者が動かして離した後、ほかの参加者に drag が届かない', async () => {
    host.submit({ type: 'spawnPiece', shape: 'cube', color: '#f00', placement: origin });
    const pieceId = Object.keys(host.getState().objects)[0]!;
    const a = await addGuest('A');
    const b = await addGuest('B');
    await sit(a, 1);
    await sit(b, 2);
    a.g.submit({ type: 'grab', objId: pieceId });
    await flush();
    // 間隔内に2回送り、2回目が後縁で中継待ちになるようにする
    a.g.drag(pieceId, { x: 1, y: 0, z: 0 });
    await flush();
    const mark = b.link.guestSide.received.length;
    a.link.guestSide.send({ type: 'drag', objId: pieceId, pos: { x: 2, y: 0, z: 0 } });
    a.g.submit({ type: 'move', objId: pieceId, pos: { x: 2, y: 0, z: 0 } });
    a.g.submit({ type: 'release', objId: pieceId });
    await flush(300);
    const after = b.link.guestSide.received.slice(mark).map((m) => (m as { type: string }).type);
    expect(after).not.toContain('drag');
    expect(host.getState().heldBy[pieceId]).toBeUndefined();
  });
});
