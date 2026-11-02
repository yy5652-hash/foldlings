import { Mesh, Vector3 } from '@iwsdk/core';
import { expect, it } from 'vitest';
import { buildRig, CREATURE_KINDS } from './creature-models.js';
import { voxelize } from './voxel.js';

it('measures voxel baking for every resting model without a renderer', () => {
  const rows = [];
  const v = new Vector3();
  for (const kind of CREATURE_KINDS) {
    const rig = buildRig(kind, '#ffffff', '#ffffff');
    rig.root.updateMatrixWorld(true);
    const tris: number[] = [];
    rig.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || o.name !== 'Paper') return;
      const position = m.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(m.matrixWorld);
        tris.push(v.x, v.y, v.z);
      }
    });
    for (const [resolution, band] of [[56, 0.019], [84, 0.012]]) {
      // Warm JIT separately; timing includes only voxelize, not rig construction.
      voxelize(tris, resolution, band, 0.03);
      const times = [];
      let grid;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        grid = voxelize(tris, resolution, band, 0.03);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      expect(grid!.data.length).toBe(grid!.nx * grid!.ny * grid!.nz * 2);
      rows.push({ kind, resolution, ms: +times[1].toFixed(2), maxMs: +times[2].toFixed(2), texture: `${grid!.nx}x${grid!.ny}x${grid!.nz}`, bytes: grid!.data.byteLength });
    }
    rig.root.traverse((o) => {
      if ((o as Mesh).geometry) (o as Mesh).geometry.dispose();
    });
    rig.holo.dispose();
    rig.core.dispose();
    rig.cloud.dispose();
    rig.lines.dispose();
  }
  console.table(rows);
}, 300000);
