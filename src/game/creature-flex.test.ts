import { describe, expect, it } from 'vitest';
import { Vector3 } from '@iwsdk/core';
import { buildRig, CREATURE_KINDS, MAX_SEAM, type Rig } from './creature-models.js';
import type { CreatureKind } from './levels.js';
import { baked } from './origami/baked.js';
import type { BakedOrigami } from './origami/data.js';
import { settle } from './origami/settle.js';

const dataOf = (kind: CreatureKind) => (baked as Record<CreatureKind, BakedOrigami>)[kind];
const groupOf = (rig: Rig, part: string) => rig.body.getObjectByName(part[0].toUpperCase() + part.slice(1))!;

/** Where the moved part now puts a vertex of the folded sheet. */
function moved(rig: Rig, part: string, p: number[]) {
  return groupOf(rig, part).children[0].localToWorld(new Vector3(p[0], p[1], p[2]));
}

describe('creatures move the way paper can', () => {
  it.each(CREATURE_KINDS)('%s opens no seam wider than a millimetre at full turn', (kind) => {
    const data = dataOf(kind), rig = buildRig(kind, '#ffffff', '#000000');
    const owners = new Map<number, Set<string>>();
    for (const f of data.faces) for (const v of f.vertices) owners.set(v, (owners.get(v) ?? new Set()).add(f.part));
    for (const [field, flex] of Object.entries(rig.flex)) {
      const inside = Object.entries(data.rig).filter(([, f]) => f === field).map(([part]) => part);
      flex.turn(flex.limit, 0, 0, 1);
      rig.root.updateMatrixWorld(true);
      let worst = 0;
      for (const [v, parts] of owners) {
        const part = inside.find((p) => parts.has(p));
        if (!part || [...parts].every((p) => inside.includes(p))) continue;
        worst = Math.max(worst, moved(rig, part, data.positions[v]).distanceTo(new Vector3(...data.positions[v])));
      }
      expect(worst, `${kind} ${field}`).toBeLessThanOrEqual(MAX_SEAM + 1e-6);
      flex.turn(0, 0, 0, 1);
    }
  });

  it('turns a head on a straight crease as far as it likes', () => {
    expect(buildRig('frog', '#ffffff', '#000000').flex.head!.limit).toBeGreaterThan(1);
  });

  it("drives the frog's back legs down as it leaps", () => {
    const data = dataOf('frog'), rig = buildRig('frog', '#ffffff', '#000000');
    const legs = (part: string) => data.faces.filter((f) => f.part === part).flatMap((f) => f.vertices);
    const low = (part: string) => Math.min(...legs(part).map((v) => moved(rig, part, data.positions[v]).y));
    rig.root.updateMatrixWorld(true);
    const rest = [low('legL'), low('legR')];
    rig.flex.legR!.turn(0.3, 0, 0, 1);
    rig.flex.legL!.turn(-0.3, 0, 0, 1);
    rig.root.updateMatrixWorld(true);
    expect(low('legL')).toBeLessThan(rest[0]);
    expect(low('legR')).toBeLessThan(rest[1]);
  });

  it.each(CREATURE_KINDS.filter((k) => dataOf(k).touchesGround))('%s stands where its weight puts it', (kind) => {
    const data = dataOf(kind);
    const rest = settle(data.positions, data.faces.flatMap((f) => f.triangles));
    expect(rest.tilt).toBeLessThan(0.01);
    expect(rest.margin).toBeGreaterThanOrEqual(0);
  });
});
