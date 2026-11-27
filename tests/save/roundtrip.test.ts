import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/core/apply';
import type { Command, CommandBody } from '../../src/core/commands';
import { seededRng } from '../../src/core/rng';
import { emptyState, type TableState } from '../../src/core/state';
import { sha256Hex } from '../../src/assets/hash';
import type { StoredAsset } from '../../src/assets/store';
import { readSave, SaveError } from '../../src/save/read';
import { MAX_ASSET_BYTES } from '../../src/save/validate';
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

type Mutable = Record<string, any>;

/** 書き出した zip の state.json を書き換えて、もう一度 zip にする。 */
async function withState(mutate: (s: Mutable) => void): Promise<Uint8Array> {
  const { state, assets } = await sampleGame();
  const files = { ...readZip(writeSave(state, assets)) };
  const json = JSON.parse(new TextDecoder().decode(files['state.json']!)) as Mutable;
  mutate(json);
  files['state.json'] = strToU8(JSON.stringify(json));
  return zipSync(files);
}

function firstCard(s: Mutable, where: string): Mutable {
  return Object.values(s.cards as Record<string, Mutable>).find((c) => c.loc.type === where)!;
}
function firstObj(s: Mutable, kind: string): Mutable {
  return Object.values(s.objects as Record<string, Mutable>).find((o) => o.kind === kind)!;
}

describe('壊れた保存ファイルを拒否する', () => {
  const origin = { pos: { x: 0, y: 0, z: 0 }, rot: 0 };
  const cases: [string, (s: Mutable) => void][] = [
    ['カードの場所の種類が不明', (s) => (firstCard(s, 'hand').loc.type = 'pocket')],
    ['手札のカードの見える人の種類が不明', (s) => (firstCard(s, 'hand').loc.visibility = { kind: 'everyone' })],
    ['手札のカードの見える人の席が配列でない', (s) => (firstCard(s, 'hand').loc.visibility = { kind: 'seats', seats: 1 })],
    ['手札のカードの席が範囲外', (s) => (firstCard(s, 'hand').loc.seat = 9)],
    ['山札の中のカードが無い山札を指す', (s) => (firstCard(s, 'stack').loc.stackId = 'missing')],
    [
      '卓上のカードの位置が数値でない',
      (s) => {
        const c = firstCard(s, 'stack');
        const st = firstObj(s, 'stack');
        st.cardIds = st.cardIds.filter((id: string) => id !== c.id);
        c.loc = { type: 'table', placement: { pos: { x: 'a', y: 0, z: 0 }, rot: 0 }, faceUp: true };
      },
    ],
    ['カードの名前が文字列でない', (s) => (firstCard(s, 'stack').name = 5)],
    ['山札のカードの並びに無いカードがある', (s) => firstObj(s, 'stack').cardIds.push('ghost')],
    ['山札の並びが文字列の配列でない', (s) => (firstObj(s, 'stack').cardIds = 'abc')],
    [
      '山札の中のカードが、指している山札の並びに無い',
      (s) => {
        const st = firstObj(s, 'stack');
        st.cardIds = st.cardIds.slice(1);
      },
    ],
    ['山札の裏面が文字列でない', (s) => (firstObj(s, 'stack').backHash = 1)],
    ['物の種類が不明', (s) => (s.objects.x = { id: 'x', kind: 'rocket', placement: origin })],
    ['駒の形が不明', (s) => (s.objects.x = { id: 'x', kind: 'piece', shape: 'star', color: '#fff', placement: origin })],
    ['サイコロの目が範囲外', (s) => (s.objects.x = { id: 'x', kind: 'die', value: 7, placement: origin })],
    ['盤面の大きさが数値でない', (s) => (s.objects.x = { id: 'x', kind: 'board', imageHash: 'h', width: 'w', depth: 1, placement: origin })],
    ['rev が無い', (s) => delete s.rev],
    ['rev が数値でない', (s) => (s.rev = '3')],
    [
      '手札の並びとカードの席が食い違う',
      (s) => {
        const id = s.hands[1].pop();
        s.hands[2].push(id);
      },
    ],
    ['手札のカードが手札の並びに無い', (s) => s.hands[1].pop()],
  ];
  it.each(cases)('%s', async (_label, mutate) => {
    await expect(readSave(await withState(mutate))).rejects.toThrow(SaveError);
  });

  it('manifest.json が無ければ拒否する', async () => {
    const { state, assets } = await sampleGame();
    const files = { ...readZip(writeSave(state, assets)) };
    delete files['manifest.json'];
    await expect(readSave(zipSync(files))).rejects.toThrow(SaveError);
  });

  it('state.json が JSON として読めなければ拒否する', async () => {
    const { state, assets } = await sampleGame();
    const files = { ...readZip(writeSave(state, assets)) };
    files['state.json'] = strToU8('{"cards": ');
    await expect(readSave(zipSync(files))).rejects.toThrow(SaveError);
  });

  it('大きすぎる画像の項目は拒否する', async () => {
    const { state, assets } = await sampleGame();
    const files: Record<string, Uint8Array> = { ...readZip(writeSave(state, assets)) };
    // 圧縮するとほとんど0バイトだが、展開後の大きさは上限を超える
    files[`assets/${'0'.repeat(64)}.png`] = new Uint8Array(MAX_ASSET_BYTES + 1);
    await expect(readSave(zipSync(files))).rejects.toThrow(/大きすぎる/);
  }, 60_000); // 30MB 超の画像を作るので、負荷が高いと時間がかかる

  it('知らない項目は展開せずに無視する', async () => {
    const { state, assets } = await sampleGame();
    const files: Record<string, Uint8Array> = { ...readZip(writeSave(state, assets)) };
    files['junk/big.bin'] = new Uint8Array(MAX_ASSET_BYTES + 1);
    const loaded = await readSave(zipSync(files));
    expect(loaded.state.cards).toEqual(state.cards);
  });
});

import { unzipSync } from 'fflate';
function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
