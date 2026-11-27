// 駒の選択（R4）。既定の形と色から選んで卓に出す。
import type { PieceShape } from '../core/state';
import { openDialog } from './dialog';
import { h } from './dom';

export const PIECE_SHAPES: { shape: PieceShape; label: string }[] = [
  { shape: 'pawn', label: 'ポーン' },
  { shape: 'cube', label: 'キューブ' },
  { shape: 'disc', label: '円盤' },
  { shape: 'cone', label: '円すい' },
];

export const PIECE_COLORS: { color: string; label: string }[] = [
  { color: '#e53935', label: '赤' },
  { color: '#1e88e5', label: '青' },
  { color: '#43a047', label: '緑' },
  { color: '#fdd835', label: '黄' },
  { color: '#8e24aa', label: '紫' },
  { color: '#fb8c00', label: 'オレンジ' },
  { color: '#fafafa', label: '白' },
  { color: '#212121', label: '黒' },
];

export function openPiecePicker(onPick: (shape: PieceShape, color: string) => void): void {
  let shape: PieceShape = 'pawn';
  let color = PIECE_COLORS[0]!.color;
  const shapeRow = h('div', { class: 'choices' });
  for (const s of PIECE_SHAPES) {
    const r = h('input', { type: 'radio', name: 'piece-shape', value: s.shape, checked: s.shape === shape });
    r.addEventListener('change', () => (shape = s.shape));
    shapeRow.append(h('label', {}, r, s.label));
  }
  const colorRow = h('div', { class: 'choices' });
  for (const c of PIECE_COLORS) {
    const r = h('input', { type: 'radio', name: 'piece-color', value: c.color, checked: c.color === color });
    r.addEventListener('change', () => (color = c.color));
    const sw = h('span', { class: 'swatch' });
    sw.style.background = c.color;
    colorRow.append(h('label', {}, r, sw, c.label));
  }
  openDialog({
    title: '駒を出す',
    body: [h('div', { class: 'field' }, h('div', {}, '形'), shapeRow), h('div', { class: 'field' }, h('div', {}, '色'), colorRow)],
    okLabel: '卓に出す',
    onOk: () => onPick(shape, color),
  });
}
