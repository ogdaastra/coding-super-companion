/**
 * Turning photo files into retina input (browser only: uses canvas).
 *
 * Each photo is cropped to its centred square and reduced to GRID × GRID pixels
 * in two steps (to 64 × 64, then to GRID × GRID) so every retina pixel is an
 * average over its patch of the photo rather than a single sampled pixel.
 * Photos are processed locally and never leave the browser.
 */
import { CHANNELS, GRID, encodePixels } from './retina.ts';

export interface Photo {
  id: string;
  name: string;
  /** Small JPEG data URL for display. */
  thumb: string;
  /** What the retina receives: GRID × GRID colour preview (PNG data URL). */
  retina: string;
  features: Float32Array;
}

let seq = 0;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot process images (no 2D canvas).');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/** Draws the centred square of `img` into a size × size canvas. */
function square(img: CanvasImageSource & { width: number; height: number }, size: number) {
  const [c, ctx] = canvas(size);
  const side = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return c;
}

/** A GRID × GRID colour picture of retina features (each channel 0..1). */
export function retinaPreview(features: Float32Array): string {
  const [c, ctx] = canvas(GRID);
  const data = ctx.createImageData(GRID, GRID);
  for (let p = 0; p < GRID * GRID; p++) {
    for (let k = 0; k < 3; k++) data.data[4 * p + k] = Math.round(255 * features[p * CHANNELS + k]);
    data.data[4 * p + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

export async function loadPhoto(file: File): Promise<Photo> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: this browser cannot read that image format (try JPEG or PNG).`);
  }
  try {
    const mid = square(bitmap, 64);
    const [small, sctx] = canvas(GRID);
    sctx.drawImage(mid, 0, 0, GRID, GRID);
    const features = encodePixels(sctx.getImageData(0, 0, GRID, GRID).data);
    const thumb = square(bitmap, 72).toDataURL('image/jpeg', 0.82);
    void small;
    return { id: `p${++seq}`, name: file.name, thumb, retina: retinaPreview(features), features };
  } finally {
    bitmap.close();
  }
}
