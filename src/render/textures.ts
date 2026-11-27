// テクスチャの管理。読み込んだテクスチャはすべて保持する（動的な解放はしない）。
import * as THREE from 'three';

export type ImageSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(img: ImageSource, anisotropy: number): THREE.Texture {
  let tex: THREE.Texture;
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    // ImageBitmap は flipY が効かないため、canvas に描き直して使う
    const [c, ctx] = makeCanvas(img.width, img.height);
    ctx.drawImage(img, 0, 0);
    tex = new THREE.CanvasTexture(c);
  } else if (img instanceof HTMLCanvasElement) {
    tex = new THREE.CanvasTexture(img);
  } else {
    tex = new THREE.Texture(img);
    tex.needsUpdate = true;
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** 画像が届くまでの「読み込み中」の見た目 */
function makePlaceholder(): THREE.Texture {
  const [c, ctx] = makeCanvas(128, 180);
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, 128, 180);
  ctx.fillStyle = '#eeeeee';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('…', 64, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// サイコロの目の位置（0〜1）
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};

export class TextureStore {
  private readonly byHash = new Map<string, THREE.Texture>();
  private readonly turned = new Map<string, THREE.Texture>();
  private readonly pips = new Map<number, THREE.Texture>();
  private readonly labels = new Map<string, THREE.Texture>();
  readonly placeholder = makePlaceholder();

  constructor(
    private readonly getImage: (hash: string) => ImageSource | undefined,
    private readonly anisotropy: number,
  ) {}

  /** ハッシュのテクスチャ。まだ画像が無ければ読み込み中の見た目を返す */
  get(hash: string): THREE.Texture {
    const have = this.byHash.get(hash);
    if (have) return have;
    const img = this.getImage(hash);
    if (!img) return this.placeholder;
    const tex = toTexture(img, this.anisotropy);
    this.byHash.set(hash, tex);
    return tex;
  }

  /** 180°回したテクスチャ。カードの下面（-y）に貼ると、裏側から見て正しい向きになる */
  getTurned(hash: string): THREE.Texture {
    const have = this.turned.get(hash);
    if (have) return have;
    const base = this.get(hash);
    if (base === this.placeholder) return base;
    const tex = base.clone();
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI;
    tex.needsUpdate = true;
    this.turned.set(hash, tex);
    return tex;
  }

  /** サイコロの目 n の面 */
  pip(n: number): THREE.Texture {
    const have = this.pips.get(n);
    if (have) return have;
    const [c, ctx] = makeCanvas(128, 128);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = n === 1 ? '#c62828' : '#222222';
    for (const [x, y] of PIPS[n] ?? []) {
      ctx.beginPath();
      ctx.arc(x * 128, y * 128, n === 1 ? 18 : 12, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.pips.set(n, tex);
    return tex;
  }

  /** つかんでいる席の名札 */
  label(text: string, color: string): THREE.Texture {
    const key = `${text}|${color}`;
    const have = this.labels.get(key);
    if (have) return have;
    const [c, ctx] = makeCanvas(128, 48);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(2, 2, 124, 44, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 25);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.labels.set(key, tex);
    return tex;
  }

  dispose(): void {
    for (const t of this.byHash.values()) t.dispose();
    for (const t of this.turned.values()) t.dispose();
    for (const t of this.pips.values()) t.dispose();
    for (const t of this.labels.values()) t.dispose();
    this.placeholder.dispose();
    this.byHash.clear();
    this.pips.clear();
    this.labels.clear();
  }
}
