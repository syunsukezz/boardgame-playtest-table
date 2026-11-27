import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/apply';
import type { Command, CommandBody } from '../../src/core/commands';
import { project } from '../../src/core/project';
import { seededRng } from '../../src/core/rng';
import { emptyState, type TableState } from '../../src/core/state';
import { sha256Hex } from '../../src/assets/hash';
import { AssetStore, type StoredAsset } from '../../src/assets/store';
import { AssetReceiver, AssetSendTracker, CHUNK_SIZE, chunkAsset, neededAssetHashes } from '../../src/assets/transfer';

let n = 0;
function run(state: TableState, seat: number, body: CommandBody): TableState {
  const r = apply(state, { ...body, seat, cmdId: `a${n++}` } as Command, seededRng(3));
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('分割送信', () => {
  it('300KBを分割して順に渡すと、元のバイト列とハッシュが一致する', async () => {
    const bytes = new Uint8Array(300 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
    const asset: StoredAsset = { hash: await sha256Hex(bytes), mime: 'image/webp', bytes };
    const msgs = chunkAsset(asset);
    expect(msgs[0]).toMatchObject({ type: 'asset-begin', chunks: Math.ceil(bytes.length / CHUNK_SIZE) });
    const rx = new AssetReceiver();
    let done: StoredAsset | null = null;
    for (const m of msgs) done = rx.handle(m) ?? done;
    expect(done).not.toBeNull();
    expect(done!.bytes).toEqual(bytes);
    expect(await sha256Hex(done!.bytes)).toBe(asset.hash);
  });
});

describe('PeerJS 経由の受信', () => {
  it('分割データが ArrayBuffer で届いても、元のバイト列に組み立てられる', async () => {
    const bytes = new Uint8Array(150_000).map((_, i) => (i * 7) % 256);
    const asset: StoredAsset = { hash: await sha256Hex(bytes), mime: 'image/png', bytes };
    const rx = new AssetReceiver();
    let out: StoredAsset | null = null;
    for (const m of chunkAsset(asset)) {
      // PeerJS の binary 直列化は Uint8Array を ArrayBuffer にして届ける
      const wire = m.type === 'asset-chunk' ? { ...m, data: m.data.slice().buffer as unknown as Uint8Array } : m;
      out = rx.handle(wire) ?? out;
    }
    expect(await sha256Hex(out!.bytes)).toBe(asset.hash);
  });
});

describe('必要な画像', () => {
  it('受け手(席2)に配ったカードの表は席2の集合にだけ入り、裏は両方に入る', () => {
    const origin = { pos: { x: 0, y: 0, z: 0 }, rot: 0 };
    const cards = [{ faceHash: 'FACE-A', backHash: 'BACK', name: 'A' }];
    let s = run(emptyState(), 0, { type: 'spawnDeck', cards, placement: origin });
    const stackId = Object.keys(s.objects)[0]!;
    s = run(s, 1, { type: 'deal', stackId, count: 1, seats: [2], visibility: 'recipient' });
    const n1 = neededAssetHashes(project(s, { kind: 'seat', seat: 1 }));
    const n2 = neededAssetHashes(project(s, { kind: 'seat', seat: 2 }));
    expect(n2.has('FACE-A')).toBe(true);
    expect(n1.has('FACE-A')).toBe(false);
    expect(n1.has('BACK')).toBe(true);
    expect(n2.has('BACK')).toBe(true);
  });
});

describe('送信済みの記録', () => {
  it('同じ相手には二度送らず、別の相手には送る', () => {
    const t = new AssetSendTracker();
    const need = new Set(['h1']);
    expect(t.missing('p1', need)).toEqual(['h1']);
    t.markSent('p1', 'h1');
    expect(t.missing('p1', need)).toEqual([]);
    expect(t.missing('p2', need)).toEqual(['h1']);
  });
});

describe('AssetStore', () => {
  it('同じハッシュの再putは通知しない', () => {
    const st = new AssetStore();
    let c = 0;
    st.onAdded(() => c++);
    const a = { hash: 'x', mime: 'image/png', bytes: new Uint8Array(1) };
    st.put(a);
    st.put(a);
    expect(c).toBe(1);
    expect(st.has('x')).toBe(true);
  });
});
