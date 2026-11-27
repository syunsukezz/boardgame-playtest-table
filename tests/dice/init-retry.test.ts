import { expect, it, vi } from 'vitest';

const init = vi.fn<() => Promise<void>>();
vi.mock('@dimforge/rapier3d-compat', () => ({ default: { init } }));

it('物理演算の初期化が一度失敗しても、失敗を覚えずに次の呼び出しでやり直す', async () => {
  const { initDicePhysics } = await import('../../src/dice/simulate');
  init.mockRejectedValueOnce(new Error('読み込み失敗')).mockResolvedValue(undefined);
  await expect(initDicePhysics()).rejects.toThrow('読み込み失敗');
  await expect(initDicePhysics()).resolves.toBeUndefined();
  await expect(initDicePhysics()).resolves.toBeUndefined();
  expect(init).toHaveBeenCalledTimes(2);
});
