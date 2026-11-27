import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/apply';
import type { Command, CommandBody } from '../../src/core/commands';
import { seededRng } from '../../src/core/rng';
import { emptyState, type TableState } from '../../src/core/state';
import { sha256Hex } from '../../src/assets/hash';
import type { StoredAsset } from '../../src/assets/store';
import { readSave, SaveError } from '../../src/save/read';
import { FORMAT_VERSION, writeSave } from '../../src/save/write';

let n = 0;
function run(state: TableState, seat: number, body: CommandBody): TableState {
  const r = apply(state, { ...body, seat, cmdId: `s${n++}` } as Command, seededRng(3));
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

async function asset(text: string): Promise<StoredAsset> {
  const bytes = strToU8(text);
  return { hash: await sha256Hex(bytes), mime: 'image/webp', bytes };
}

async function sampleGame() {
  const back = await asset('back-image');
  const faces = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => asset(`face-${i}`)));
  const origin = { pos: { x: 0, y: 0, z: 0 }, rot: 0 };
  let state = run(emptyState(), 0, {
    type: 'spawnDeck',
    cards: faces.map((f, i) => ({ faceHash: f.hash, backHash: back.hash, name: `カード${i}` })),
    placement: origin,
  });
  const stackId = Object.keys(state.objects)[0]!;
  state = run(state, 0, { type: 'shuffle', stackId });
  state = run(state, 0, { type: 'deal', stackId, count: 1, seats: [1, 2], visibility: 'others' });
  state = run(state, 1, { type: 'setVisibility', cardId: state.hands[1]![0]!, visibility: { kind: 'seats', seats: [1, 3] } });
  state = run(state, 2, { type: 'grab', objId: stackId });
  return { state, assets: [back, ...faces] };
}

describe('保存と読み込み', () => {
  it('Covers AE4. 書き出して読み込むと、配置・山札の順番・各席の手札・見える人が一致する', async () => {
    const { state, assets } = await sampleGame();
    const bytes = writeSave(state, assets);
    const loaded = await readSave(bytes);
    expect(loaded.state.objects).toEqual(state.objects);
    expect(loaded.state.cards).toEqual(state.cards);
    expect(loaded.state.hands).toEqual(state.hands);
    expect(loaded.assets.map((a) => a.hash).sort()).toEqual(assets.map((a) => a.hash).sort());
    // つかみは読み込み後に持ち越さない
    expect(loaded.state.heldBy).toEqual({});
  });

  it('画像のハッシュがファイル名と一致しない zip は読み込みを拒否する', async () => {
    const { state, assets } = await sampleGame();
    const files = { ...readZip(writeSave(state, assets)) };
    const victim = Object.keys(files).find((k) => k.startsWith('assets/'))!;
    files[victim] = strToU8('tampered');
    await expect(readSave(zipSync(files))).rejects.toThrow(SaveError);
  });

  it('形式の版が新しすぎるファイルは、理由つきで拒否する', async () => {
    const { state, assets } = await sampleGame();
    const files = { ...readZip(writeSave(state, assets)) };
    files['manifest.json'] = strToU8(JSON.stringify({ formatVersion: FORMAT_VERSION + 1 }));
    await expect(readSave(zipSync(files))).rejects.toThrow(/新しい版/);
  });

  it('状態が参照している画像が zip に無ければ拒否する', async () => {
    const { state, assets } = await sampleGame();
    const files = { ...readZip(writeSave(state, assets)) };
    const victim = Object.keys(files).find((k) => k.startsWith('assets/'))!;
    delete files[victim];
    await expect(readSave(zipSync(files))).rejects.toThrow(SaveError);
  });

  it('zip でないファイルは拒否する', async () => {
    await expect(readSave(strToU8('not a zip'))).rejects.toThrow(SaveError);
  });

  it('席の鍵は保存ファイルに含まれない', async () => {
    const { state, assets } = await sampleGame();
    const files = readZip(writeSave(state, assets));
    const text = new TextDecoder().decode(files['state.json']!);
    expect(text).not.toMatch(/seatKey/i);
  });
});

import { unzipSync } from 'fflate';
function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
