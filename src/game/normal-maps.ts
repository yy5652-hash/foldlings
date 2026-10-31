/** Seeded, tileable paper and felt relief, sampled in texel units. */
import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace,
  RepeatWrapping, RGBAFormat,
} from '@iwsdk/core';

function randomSeed(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function line(
  h: Float32Array, size: number, x: number, y: number,
  dx: number, dy: number, amplitude: number,
): void {
  const mask = size - 1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(length * 2));
  const weight = amplitude * length / steps;
  for (let i = 0; i < steps; i++) {
    const px = x + dx * (i + 0.5) / steps;
    const py = y + dy * (i + 0.5) / steps;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const a = (iy & mask) * size;
    const b = ((iy + 1) & mask) * size;
    h[a + (ix & mask)] += weight * (1 - fx) * (1 - fy);
    h[a + ((ix + 1) & mask)] += weight * fx * (1 - fy);
    h[b + (ix & mask)] += weight * (1 - fx) * fy;
    h[b + ((ix + 1) & mask)] += weight * fx * fy;
  }
}

function blur(h: Float32Array, size: number): Float32Array {
  const result = new Float32Array(h.length);
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = ((y + dy) & mask) * size;
        sum += h[row + ((x - 1) & mask)] + h[row + x] + h[row + ((x + 1) & mask)];
      }
      result[y * size + x] = Math.max(0, Math.min(1, sum / 9));
    }
  }
  return result;
}

function relief(size: number, seed: number, curly: boolean): Float32Array {
  const random = randomSeed(seed);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = 0.5 + (random() - 0.5) * 0.025;
  const count = Math.ceil(h.length / (curly ? 8 : 32));
  for (let i = 0; i < count; i++) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    const segments = curly ? 4 + Math.floor(random() * 5) : 8 + Math.floor(random() * 17);
    const step = curly ? 1.25 : 2;
    const turn = (random() < 0.5 ? -1 : 1) * (curly ? 0.3 + random() * 0.5 : 0.015);
    const amplitude = (random() < 0.5 ? -1 : 1) *
      (curly ? 0.05 + random() * 0.04 : 0.16 + random() * 0.14);
    for (let j = 0; j < segments; j++) {
      const dx = Math.cos(angle) * step;
      const dy = Math.sin(angle) * step;
      const taper = Math.sin(Math.PI * (j + 0.5) / segments);
      line(h, size, x, y, dx, dy, amplitude * taper);
      x += dx;
      y += dy;
      angle += turn;
    }
  }
  return blur(h, size);
}

export function fiberHeight(size: number, seed: number): Float32Array {
  return relief(size, seed, false);
}

export function feltHeight(size: number, seed: number): Float32Array {
  return relief(size, seed, true);
}

export function heightToNormal(h: Float32Array, size: number, strength: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const above = ((y - 1) & mask) * size;
    const below = ((y + 1) & mask) * size;
    for (let x = 0; x < size; x++) {
      const nx = (h[row + ((x - 1) & mask)] - h[row + ((x + 1) & mask)]) * strength * 0.5;
      const ny = (h[above + x] - h[below + x]) * strength * 0.5;
      const scale = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      rgba[i] = Math.round((nx * scale + 1) * 127.5);
      rgba[i + 1] = Math.round((ny * scale + 1) * 127.5);
      rgba[i + 2] = Math.round((scale + 1) * 127.5);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

export function normalTexture(rgba: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(rgba, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
