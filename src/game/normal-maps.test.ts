/** Relief continuity, normal encoding and texture sampling contracts. */
import { describe, expect, it } from 'vitest';
import {
  DataTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat,
} from '@iwsdk/core';
import { feltHeight, fiberHeight, heightToNormal, normalTexture } from './normal-maps.js';

describe.each([
  ['paper', fiberHeight],
  ['felt', feltHeight],
] as const)('%s relief', (_name, generate) => {
  it('repeats exactly for a seed and varies between seeds', () => {
    const a = generate(64, 0);
    expect(a).toEqual(generate(64, 0));
    expect(a).not.toEqual(generate(64, 1));
  });

  it.each([64, 128, 256, 512])('stays finite and within 0..1 at size %i', size => {
    const h = generate(size, -12345);
    let min = Infinity;
    let max = -Infinity;
    for (const value of h) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(h).toBeInstanceOf(Float32Array);
    expect(h.length).toBe(size * size);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.01);
  });

  it.each([64, 128, 256, 512])('has no statistical seam on either axis at size %i', size => {
    let seamX = 0;
    let seamY = 0;
    let interiorX = 0;
    let interiorY = 0;
    for (let seed = 0; seed < 16; seed++) {
      const h = generate(size, seed);
      for (let y = 0; y < size; y++) {
        seamX += Math.abs(h[y * size] - h[y * size + size - 1]);
        seamY += Math.abs(h[y] - h[(size - 1) * size + y]);
        for (let x = 1; x < size; x++) {
          interiorX += Math.abs(h[y * size + x] - h[y * size + x - 1]);
          interiorY += Math.abs(h[x * size + y] - h[(x - 1) * size + y]);
        }
      }
    }
    // Pool seeds to allow natural sampling variation without hiding a border jump.
    expect(seamX / (interiorX / (size - 1))).toBeLessThan(1.15);
    expect(seamY / (interiorY / (size - 1))).toBeLessThan(1.15);
  });

  it('generates a 256 map in under 50 ms (median of five warm runs)', () => {
    generate(256, 42);
    const times: number[] = [];
    for (let seed = 0; seed < 5; seed++) {
      const start = performance.now();
      generate(256, seed);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(50);
  });
});

describe('heightToNormal', () => {
  it('encodes flat heights and zero strength as straight-up normals', () => {
    for (const rgba of [
      heightToNormal(new Float32Array(64 * 64).fill(0.5), 64, 8),
      heightToNormal(fiberHeight(64, 42), 64, 0),
    ]) {
      expect(rgba).toBeInstanceOf(Uint8Array);
      expect(rgba.length).toBe(64 * 64 * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        expect(Array.from(rgba.subarray(i, i + 4))).toEqual([128, 128, 255, 255]);
      }
    }
  });

  it('takes central differences across both wrapped edges', () => {
    const size = 64;
    const h = new Float32Array(size * size);
    h[0] = 1;
    const rgba = heightToNormal(h, size, 2);
    const pixel = (x: number, y: number) => Array.from(rgba.subarray(
      (y * size + x) * 4, (y * size + x + 1) * 4,
    ));
    expect(pixel(1, 0)).toEqual([218, 128, 218, 255]);
    expect(pixel(size - 1, 0)).toEqual([37, 128, 218, 255]);
    expect(pixel(0, 1)).toEqual([128, 218, 218, 255]);
    expect(pixel(0, size - 1)).toEqual([128, 37, 218, 255]);
    expect(pixel(0, 0)).toEqual([128, 128, 255, 255]);
  });

  it.each([0.5, 8, 1000])('encodes unit normals with positive Z at strength %f', strength => {
    for (const generate of [fiberHeight, feltHeight]) {
      const h = generate(64, 17);
      const before = h.slice();
      const rgba = heightToNormal(h, 64, strength);
      let maxError = 0;
      let minBlue = 255;
      let minAlpha = 255;
      for (let i = 0; i < rgba.length; i += 4) {
        const x = rgba[i] / 127.5 - 1;
        const y = rgba[i + 1] / 127.5 - 1;
        const z = rgba[i + 2] / 127.5 - 1;
        maxError = Math.max(maxError, Math.abs(Math.hypot(x, y, z) - 1));
        minBlue = Math.min(minBlue, rgba[i + 2]);
        minAlpha = Math.min(minAlpha, rgba[i + 3]);
      }
      expect(maxError).toBeLessThan(0.007);
      expect(minBlue).toBeGreaterThanOrEqual(128);
      expect(minAlpha).toBe(255);
      expect(h).toEqual(before);
    }
  });
});

it('creates a repeating RGBA data texture with mipmaps and no color conversion', () => {
  const rgba = heightToNormal(feltHeight(64, 1), 64, 2);
  const texture = normalTexture(rgba, 64);
  expect(texture).toBeInstanceOf(DataTexture);
  expect(texture.image.data).toBe(rgba);
  expect(texture.image.width).toBe(64);
  expect(texture.image.height).toBe(64);
  expect(texture.format).toBe(RGBAFormat);
  expect(texture.wrapS).toBe(RepeatWrapping);
  expect(texture.wrapT).toBe(RepeatWrapping);
  expect(texture.minFilter).toBe(LinearMipmapLinearFilter);
  expect(texture.generateMipmaps).toBe(true);
  expect(texture.colorSpace).toBe(NoColorSpace);
  expect(texture.version).toBe(1);
  texture.dispose();
});
