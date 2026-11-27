// 招待 URL（KTD5: `#room=` 付き）。

export function inviteUrl(base: string, roomId: string): string {
  return `${base}#room=${roomId}`;
}

/** location.hash から部屋 ID を取り出す。無ければ null。 */
export function parseRoomFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const room = params.get('room');
  return room ? room : null;
}
