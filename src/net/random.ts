// 推測できないランダムな文字列（席の鍵・部屋 ID）。

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** crypto.getRandomValues による base32（小文字と2〜7）の length 文字。 */
export function randomBase32(length: number): string {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += BASE32[b & 31];
  return s;
}
