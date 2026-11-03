/** Headless model/input checks. These do not claim device or WebGL verification. */
import { Group, Mesh, PerspectiveCamera, Vector3, type BufferAttribute } from '@iwsdk/core';
import { describe, expect, it, vi } from 'vitest';
import { LEVELS, PER_WORLD, WORLDS } from './levels.js';
import { WorldIsland } from './world-island.js';
import { sfx } from './sfx.js';
import { projectionAngles } from './fov.js';
import { ISLAND_PLACEMENT, REGION_RADIUS, REGION_TOP, surfaceHeight } from './island-terrain.js';

vi.mock('./glass.js', async () => {
  const { Mesh, PlaneGeometry, MeshBasicMaterial } = await import('@iwsdk/core');
  return { TextLabel: class {
    mesh = new Mesh(new PlaneGeometry(.2, .018), new MeshBasicMaterial());
    set() {}
  } };
});
vi.mock('./sfx.js', () => ({ sfx: { click: vi.fn(), error: vi.fn() } }));

function fixture() {
  const play = vi.fn();
  const island = new WorldIsland({ play, canPlay: () => true });
  const hands = {
    left: { tracked: false, on: false, at: new Vector3() },
    right: { tracked: false, on: false, at: new Vector3() },
  };
  return { island, play, hands };
}
function event(mesh: Mesh, type: string) {
  (mesh as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type });
}

describe('world island without a renderer', () => {
  it('builds eight distinct 58 cm biomes with closed, genuinely raised terraces', () => {
    const { island } = fixture();
    expect(island.root.parent).toBeNull();
    expect(island.hits).toHaveLength(8);
    const fingerprints = new Set<string>();
    for (let w = 0; w < island.hits.length; w++) {
      const g = island.hits[w].geometry, p = g.getAttribute('position');
      const levels = g.getAttribute('aTerrace');
      expect(new Set(Array.from(levels.array))).toEqual(new Set([0,1,2,3,4,5,6,7,8,9]));
      let radius = 0, low = Infinity, high = -Infinity;
      const heights = new Set<number>();
      for (let i = 0; i < p.count; i++) {
        radius = Math.max(radius, Math.hypot(p.getX(i), p.getZ(i)));
        low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i));
        heights.add(Math.round(p.getY(i)*1000));
        expect(Number.isFinite(p.getY(i))).toBe(true);
      }
      expect(radius).toBeCloseTo(.29, 5);
      expect(low).toBeCloseTo(-.014, 5);
      expect(high).toBeCloseTo(.07, 5);
      expect(heights.size).toBeGreaterThanOrEqual(5);
      const a = (w+.5)*Math.PI/4;
      expect(surfaceHeight(g, Math.cos(a)*REGION_RADIUS, Math.sin(a)*REGION_RADIUS)).toBeCloseTo(REGION_TOP, 5);
      fingerprints.add(`${p.count}:${[...heights].sort().join(',')}`);
    }
    expect(fingerprints.size).toBe(8);
  });

  it('fits all lit worlds and feedback inside the narrow view from a seated head looking at the island', () => {
    const { island, hands } = fixture();
    island.setProgress(LEVELS.map(l => l.id), WORLDS.map((_, i) => i));
    island.root.position.set(0, ISLAND_PLACEMENT.height, -.44/2-ISLAND_PLACEMENT.beyondMat);
    island.root.rotation.x = ISLAND_PLACEMENT.tilt;
    const camera = new PerspectiveCamera();
    camera.position.set(0, .45, .5);
    camera.lookAt(island.root.position);
    camera.projectionMatrix.makePerspective(-Math.tan(37*Math.PI/180)*.01, Math.tan(37*Math.PI/180)*.01,
      Math.tan(25*Math.PI/180)*.01, -Math.tan(43*Math.PI/180)*.01, .01, 100);
    const view = projectionAngles(camera.projectionMatrix.elements);
    camera.updateMatrixWorld(true);
    const v = new Vector3();
    let left = 0, right = 0, up = -90, down = 90;
    for (let w = 0; w < WORLDS.length; w++) {
      island.setCurrentWorld(w);
      island.celebrate(w);
      event(island.hits[w], 'pointerenter');
      island.update(.4, hands);
      island.root.updateMatrixWorld(true);
      island.root.traverseVisible(o => {
        const mesh = o as Mesh;
        if (!mesh.geometry || Array.isArray(mesh.material) || !mesh.material.visible) return;
        const p = mesh.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          // Include simultaneous current/hover shader displacement and cloud drift.
          const world = mesh.geometry.getAttribute('aWorld');
          const region = world ? world.getX(i) : -1;
          const lift = region === w ? .025 : 0;
          for (const dy of [-.005, .005]) {
            v.fromBufferAttribute(p,i);
            v.y += lift + dy;
            v.applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
            const x = Math.atan2(v.x,-v.z)*180/Math.PI, y = Math.atan2(v.y,-v.z)*180/Math.PI;
            left = Math.min(left,x); right = Math.max(right,x);
            up = Math.max(up,y); down = Math.min(down,y);
          }
        }
      });
      event(island.hits[w], 'pointerleave');
    }
    expect(left).toBeGreaterThan(-view.left);
    expect(right).toBeLessThan(view.right);
    expect(up).toBeLessThan(view.up);
    expect(down).toBeGreaterThan(-view.down);
    console.info(`Island FOV (island gaze): left=${(-left).toFixed(2)} right=${right.toFixed(2)} up=${up.toFixed(2)} down=${(-down).toFixed(2)} deg`);
    // The old fixed desktop camera aims at the mat. Its centre alone is out of view:
    // shrinking cannot repair that different gaze direction at the requested placement.
    camera.lookAt(0,0,0);
    camera.updateMatrixWorld(true);
    v.copy(island.root.position).applyMatrix4(camera.matrixWorldInverse);
    console.info(`Island centre (fixed mat gaze): up=${(Math.atan2(v.y,-v.z)*180/Math.PI).toFixed(2)} deg`);
    expect(Math.atan2(v.y,-v.z)*180/Math.PI).toBeGreaterThan(view.up);
  });

  it('routes hover and selection to the first unsolved level, and rejects locks', () => {
    const { island, play, hands } = fixture();
    island.setProgress([LEVELS[0].id, LEVELS[2].id], [0,1]);
    event(island.hits[0], 'pointerenter');
    island.update(.4, hands);
    expect(island.root.children.filter(o => o.name === '' && o.visible)).toHaveLength(1);
    event(island.hits[0], 'pointerdown');
    expect(play).toHaveBeenCalledWith(1);
    island.update(.4, hands);
    event(island.hits[7], 'pointerdown');
    expect(play).toHaveBeenCalledTimes(1);
    expect(sfx.error).toHaveBeenCalled();
    island.update(.03, hands);
    expect(island.hits[7].position.x).not.toBe(0);
    island.setVisible(false);
    expect(island.hits.every(h => h.position.y === -50)).toBe(true);
    island.update(.4, hands);
    event(island.hits[0], 'pointerdown');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('accepts either near-hand pinch once, and never rebuilds buffers during feedback', () => {
    const { island, play, hands } = fixture();
    const body = island.root.getObjectByName('Island_terraces_and_markers') as Mesh;
    const geometry = body.geometry;
    const attribute = geometry.getAttribute('position') as BufferAttribute;
    const version = attribute.version;
    island.setCurrentWorld(0);
    island.setProgress([LEVELS[0].id], [0,1], true);
    island.celebrate(0);
    const a = Math.PI/8;
    hands.right.tracked = true;
    hands.right.on = true;
    hands.right.at.set(Math.cos(a)*.112,.015,Math.sin(a)*.112);
    island.update(.4, hands);
    expect(play).toHaveBeenCalledWith(1);
    island.update(.1, hands);
    expect(play).toHaveBeenCalledTimes(1);
    const material = body.material as import('@iwsdk/core').ShaderMaterial;
    expect(material.uniforms.uFill.value[0]).toBeCloseTo(.5);
    island.update(.5, hands);
    expect(material.uniforms.uFill.value[0]).toBe(1);
    expect(island.root.getObjectByName('Island_solve_wave')!.visible).toBe(false);
    hands.right.on = false;
    island.update(.4, hands);
    hands.left.tracked = hands.left.on = true;
    hands.left.at.copy(hands.right.at);
    island.update(.1, hands);
    expect(play).toHaveBeenCalledTimes(2);
    expect(body.geometry).toBe(geometry);
    expect(attribute.version).toBe(version);
  });

  it('returns actual top-surface centres through parent transforms, lift and hidden hit parking', () => {
    const { island, hands } = fixture();
    const board = new Group();
    board.position.set(.3, .74, -.4);
    board.rotation.y = .6;
    board.scale.setScalar(.9);
    board.add(island.root);
    island.root.position.set(0, ISLAND_PLACEMENT.height, -.27);
    island.root.rotation.x = ISLAND_PLACEMENT.tilt;
    const out = new Vector3(), expected = new Vector3();
    for (let i = 0; i < WORLDS.length; i++) {
      island.setCurrentWorld(i);
      event(island.hits[i], 'pointerenter');
      island.update(.1, hands);
      board.updateMatrixWorld(true);
      const a = (i+.5)*Math.PI/4;
      expected.set(Math.cos(a)*REGION_RADIUS, REGION_TOP, Math.sin(a)*REGION_RADIUS);
      island.hits[i].localToWorld(expected);
      expect(island.regionCenter(i, out)).toBe(out);
      expect(out.distanceTo(expected)).toBeLessThan(1e-7);
      event(island.hits[i], 'pointerleave');
    }
    island.setVisible(false);
    island.update(.4, hands);
    expect(island.hits.every(h => h.position.y === -50)).toBe(true);
    island.regionCenter(7, out);
    island.root.worldToLocal(out);
    expect(out.y).toBeCloseTo(REGION_TOP+.01, 6);
    for (const i of [-1,8,.5,NaN,Infinity]) expect(() => island.regionCenter(i, out)).toThrow(RangeError);
  });

  it('accepts a pinch on a raised region through the real board/island transform', () => {
    const { island, hands, play } = fixture();
    island.root.position.set(0,ISLAND_PLACEMENT.height,-.22-ISLAND_PLACEMENT.beyondMat);
    island.root.scale.setScalar(ISLAND_PLACEMENT.scale);
    island.root.rotation.set(25*Math.PI/180,.3,0);
    island.setProgress([LEVELS[3*PER_WORLD].id], [3]);
    island.setCurrentWorld(3);
    hands.right.tracked = hands.right.on = true;
    island.regionCenter(3, hands.right.at);
    island.update(.4, hands);
    expect(play).toHaveBeenCalledWith(3*PER_WORLD+1);
    expect(island.hits[3].position.y).toBeCloseTo(.025);
  });

  it('lazily bakes only solved creatures into single draws sharing a lit material; idle changes only yaw', () => {
    const { island, hands } = fixture();
    const creatures = () => island.root.children.filter(o => o.name.startsWith('Island_creature_'));
    expect(creatures()).toHaveLength(0);
    const solved = [LEVELS[0].id, LEVELS[2*PER_WORLD].id, LEVELS[7*PER_WORLD].id];
    island.setProgress(solved, [0,1,2,7]);
    const models = creatures();
    expect(models).toHaveLength(3);
    const meshes = models.map(o => o.children[0] as Mesh);
    const geometry = meshes.map(o => o.geometry);
    expect(new Set(meshes.map(o => o.material)).size).toBe(1);
    for (const mesh of meshes) {
      expect(mesh.geometry.groups).toHaveLength(0);
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect((mesh.material as import('@iwsdk/core').ShaderMaterial).uniforms.uGlow.value).toBeGreaterThan(1);
    }
    for (let i = 0; i < 30; i++) island.update(.1, hands);
    island.setProgress(solved, [0,1,2,7]);
    expect(creatures()).toEqual(models);
    for (let i = 0; i < models.length; i++) {
      expect(models[i].scale.toArray()).toEqual([.35,.35,.35]);
      expect(models[i].rotation.x).toBe(0);
      expect(models[i].rotation.z).toBe(0);
      expect(models[i].rotation.y).not.toBe(0);
      expect(meshes[i].geometry).toBe(geometry[i]);
      expect((meshes[i].geometry.getAttribute('position') as BufferAttribute).version).toBe(0);
    }
    island.setProgress([], [0,1]);
    expect(models.every(o => !o.visible)).toBe(true);
  });

  it('keeps the projector source on the mat below the island and drifts 320 points entirely in the shader', () => {
    const { island, hands } = fixture();
    island.root.position.set(0,ISLAND_PLACEMENT.height,-.22-ISLAND_PLACEMENT.beyondMat);
    island.root.rotation.x = ISLAND_PLACEMENT.tilt;
    island.root.scale.setScalar(ISLAND_PLACEMENT.scale);
    island.root.updateMatrixWorld(true);
    const beam = island.root.getObjectByName('Island_soft_projector_beam') as Mesh;
    const source = new Vector3().fromBufferAttribute(beam.geometry.getAttribute('position'),0);
    beam.localToWorld(source);
    expect(source.distanceTo(new Vector3(0,.002,-.22-ISLAND_PLACEMENT.beyondMat))).toBeLessThan(1e-6);
    const material = beam.material as import('@iwsdk/core').ShaderMaterial;
    expect(material.fragmentShader).toContain('0.012 * sin');
    const cloud = island.root.getObjectByName('Island_drifting_holoCloud') as Mesh;
    const p = cloud.geometry.getAttribute('position') as BufferAttribute;
    expect(p.count).toBe(320);
    island.update(.5, hands);
    expect(p.version).toBe(0);
  });

  it('stays within 24 draws with all eight creatures, hover, pulse and solve wave', () => {
    const { island, hands } = fixture();
    island.setCurrentWorld(0);
    island.celebrate(0);
    event(island.hits[0], 'pointerenter');
    island.update(.1, hands);
    island.setProgress(LEVELS.map(l => l.id), WORLDS.map((_, i) => i));
    let calls = 0;
    island.root.traverseVisible(o => {
      const renderable = o as Mesh;
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const m of materials) if (m.visible) calls += m.transparent && m.side === 2 && !m.forceSinglePass ? 2 : 1;
    });
    expect(calls).toBe(16);
    expect(calls).toBeLessThanOrEqual(24);
    console.info(`Island maximum structural draw estimate: ${calls}`);
  });
});
