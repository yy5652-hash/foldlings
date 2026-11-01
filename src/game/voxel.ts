/**
 * Turns triangles into a small 3D texture, the way a scanner would see them.
 * Red holds how close a voxel is to a surface, so a flat wing still has thickness
 * in the volume; green holds how deep it lies inside a closed solid, so a body
 * has an interior to light up.
 */

export interface VoxelGrid {
  data: Uint8Array;
  nx: number;
  ny: number;
  nz: number;
  /** Bounds of the grid, in the same units as the triangles. */
  min: [number, number, number];
  size: [number, number, number];
}

/** Squared distance from point p to triangle abc. */
function triDistSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) {
    qx = ax; qy = ay; qz = az;
  } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      qx = bx; qy = by; qz = bz;
    } else if (d6 >= 0 && d5 <= d6) {
      qx = cx; qy = cy; qz = cz;
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
    } else {
      const k = 1 / (va + vb + vc);
      const v = vb * k;
      const w = vc * k;
      qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * @param tris flat list of nine numbers per triangle
 * @param res voxels along the longest side
 * @param band how far from a surface the shell reaches
 * @param pad clear space around the model
 * @returns a grid with two bytes per voxel (red, green)
 */
export function voxelize(tris: ArrayLike<number>, res: number, band: number, pad: number): VoxelGrid {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]);
    y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]);
    z0 = Math.min(z0, tris[i + 2]); z1 = Math.max(z1, tris[i + 2]);
  }
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const s = Math.max(x1 - x0, y1 - y0, z1 - z0) / res;
  const nx = Math.max(4, Math.ceil((x1 - x0) / s));
  const ny = Math.max(4, Math.ceil((y1 - y0) / s));
  const nz = Math.max(4, Math.ceil((z1 - z0) / s));
  const count = nx * ny * nz;
  // Distance is only filled near surfaces; the flood below finds what is inside.
  const dist = new Float32Array(count).fill(Infinity);
  const reach = band + s * 1.5;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
    const bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5];
    const cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - reach - x0) / s));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) + reach - x0) / s));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - reach - y0) / s));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) + reach - y0) / s));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - reach - z0) / s));
    const k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) + reach - z0) / s));
    for (let k = k0; k <= k1; k++) {
      const pz = z0 + (k + 0.5) * s;
      for (let j = j0; j <= j1; j++) {
        const py = y0 + (j + 0.5) * s;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * s;
          const d = triDistSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
          const o = at(i, j, k);
          if (d < dist[o]) dist[o] = d;
        }
      }
    }
  }
  // Whatever open air cannot reach from the edge of the grid is inside a solid.
  const wallSq = (s * 0.95) * (s * 0.95);
  const outside = new Uint8Array(count);
  const stack: number[] = [];
  const seed = (o: number) => {
    if (!outside[o] && dist[o] >= wallSq) {
      outside[o] = 1;
      stack.push(o);
    }
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      seed(at(0, j, k));
      seed(at(nx - 1, j, k));
    }
    for (let i = 0; i < nx; i++) {
      seed(at(i, 0, k));
      seed(at(i, ny - 1, k));
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      seed(at(i, j, 0));
      seed(at(i, j, nz - 1));
    }
  }
  while (stack.length) {
    const o = stack.pop()!;
    const k = Math.floor(o / (nx * ny));
    const j = Math.floor((o - k * nx * ny) / nx);
    const i = o - nx * (j + ny * k);
    if (i > 0) seed(o - 1);
    if (i < nx - 1) seed(o + 1);
    if (j > 0) seed(o - nx);
    if (j < ny - 1) seed(o + nx);
    if (k > 0) seed(o - nx * ny);
    if (k < nz - 1) seed(o + nx * ny);
  }
  const data = new Uint8Array(count * 2);
  for (let o = 0; o < count; o++) {
    const d = dist[o] === Infinity ? Infinity : Math.sqrt(dist[o]);
    const shell = d === Infinity ? 0 : Math.max(0, 1 - d / band);
    const inside = !outside[o] && d >= s * 0.95;
    data[o * 2] = Math.round(shell * 255);
    // Deeper voxels burn brighter; those beyond the filled band count as deepest.
    data[o * 2 + 1] = inside ? Math.round(Math.min(1, 0.4 + (d === Infinity ? 1 : d / (band * 2))) * 255) : 0;
  }
  return { data, nx, ny, nz, min: [x0, y0, z0], size: [nx * s, ny * s, nz * s] };
}
