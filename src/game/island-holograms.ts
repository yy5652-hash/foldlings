/** Island-local effects and static rig baking; construction only, never per frame. */
import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, LineSegments,
  Mesh, Points, Vector3, type ShaderMaterial,
} from '@iwsdk/core';
import { buildRig } from './creature-models.js';
import { holoCloud, holoLine, holoWall } from './holo.js';
import { WORLDS } from './levels.js';
import { ISLAND_PLACEMENT, ISLAND_RADIUS, ISLAND_SECTOR, REGION_RADIUS, REGION_TOP } from './island-terrain.js';

export function foundation(): Group {
  const out = new Group();
  out.name = 'Island_projector';
  const grid: number[] = [];
  const segment = (a: number, r: number, b: number, s: number) =>
    grid.push(Math.cos(a)*r, -.016, Math.sin(a)*r, Math.cos(b)*s, -.016, Math.sin(b)*s);
  for (const r of [.055, .12, .2, ISLAND_RADIUS]) {
    for (let j = 0; j < 96; j++) segment(j*Math.PI/48, r, (j+1)*Math.PI/48, r);
  }
  for (let j = 0; j < 16; j++) segment(j*Math.PI/8, .035, j*Math.PI/8, ISLAND_RADIUS);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(grid, 3));
  const base = new LineSegments(g, holoLine(0x69e5ff, .34));
  base.name = 'Island_base_ring_and_radial_grid';
  base.raycast = () => {};
  out.add(base);

  // Inverse of the island's board placement: the emitter sits on the mat straight below the island.
  const { height, tilt, scale } = ISLAND_PLACEMENT;
  const source = new Vector3(0, (.002-height)/scale, 0).applyAxisAngle(new Vector3(1,0,0), -tilt);
  const positions: number[] = [], levels: number[] = [];
  for (let j = 0; j < 48; j++) {
    positions.push(source.x, source.y, source.z,
      Math.cos(j*Math.PI/24)*ISLAND_RADIUS, -.016, Math.sin(j*Math.PI/24)*ISLAND_RADIUS,
      Math.cos((j+1)*Math.PI/24)*ISLAND_RADIUS, -.016, Math.sin((j+1)*Math.PI/24)*ISLAND_RADIUS);
    levels.push(0, 1, 1);
  }
  const cone = new BufferGeometry();
  cone.setAttribute('position', new Float32BufferAttribute(positions, 3));
  cone.setAttribute('aH', new Float32BufferAttribute(levels, 1));
  const material = holoWall();
  material.blending = AdditiveBlending;
  material.premultipliedAlpha = false;
  material.forceSinglePass = true;
  material.fragmentShader = material.fragmentShader.replace(
    'gl_FragColor = vec4(vec3(0.3, 0.8, 1.0) * fall * band * 0.5, 0.0);',
    'gl_FragColor = vec4(vec3(0.3, 0.8, 1.0), 0.012 * sin(vH * 3.141593) * band);');
  const beam = new Mesh(cone, material);
  beam.name = 'Island_soft_projector_beam';
  beam.raycast = () => {};
  out.add(beam);
  return out;
}

export function driftingCloud(): Points {
  const p: number[] = [], n: number[] = [], c: number[] = [], drift: number[] = [];
  let seed = 9381;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 320; i++) {
    const a = random()*Math.PI*2, r = .04 + random()*.243;
    p.push(Math.cos(a)*r, .01+random()*.105, Math.sin(a)*r);
    n.push(Math.cos(a)*.7, .7, Math.sin(a)*.7);
    c.push(.15+random()*.25, .65+random()*.25, 1);
    drift.push(random(), random(), random());
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new Float32BufferAttribute(n, 3));
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  g.setAttribute('aDrift', new Float32BufferAttribute(drift, 3));
  g.computeBoundingSphere();
  g.boundingSphere!.radius += .005;
  const material = holoCloud();
  material.uniforms.uSize.value = 1.35;
  material.vertexShader = material.vertexShader.replace('* 0.0004', '* 0.003');
  const cloud = new Points(g, material);
  cloud.name = 'Island_drifting_holoCloud';
  cloud.raycast = () => {};
  return cloud;
}

/** Bake the fully folded buildRig into one draw; no rig or animation survives the bake. */
export function creatureHologram(world: number, material: ShaderMaterial): Group {
  const rig = buildRig(WORLDS[world].kind, '#7deaff', '#b3a0ff');
  rig.root.updateMatrixWorld(true);
  const positions: number[] = [], colors: number[] = [];
  const v = new Vector3();
  rig.root.traverseVisible(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || (mesh.name !== 'Paper' && mesh.name !== 'Ink')) return;
    const g = mesh.geometry, p = g.getAttribute('position'), c = g.getAttribute('color');
    const count = g.index ? g.index.count : p.count;
    for (let i = 0; i < count; i++) {
      const j = g.index ? g.index.getX(i) : i;
      v.fromBufferAttribute(p, j).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
      colors.push(c.getX(j), c.getY(j), c.getZ(j));
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aLayer', new Float32BufferAttribute(new Float32Array(positions.length/3), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const baked = new Mesh(geometry, material);
  baked.name = 'Island_creature_facets';
  baked.raycast = () => {};
  // The rig is temporary. Its global eye geometry/material belongs to creature-models.
  const disposable = new Set<BufferGeometry>();
  rig.root.traverse(object => {
    const mesh = object as Mesh;
    if (mesh.geometry && mesh.name !== 'Ink') disposable.add(mesh.geometry);
  });
  for (const g of disposable) g.dispose();
  rig.holo.dispose(); rig.core.dispose(); rig.cloud.dispose(); rig.lines.dispose();
  rig.root.clear();
  rig.root.add(baked);
  rig.root.name = `Island_creature_${WORLDS[world].kind}`;
  rig.root.scale.setScalar(.35);
  return rig.root;
}

/** Merge solved miniatures sharing one material; called only on progress changes.
 * Positions are island-local, while aWorld retains GPU lift/shake per region.
 */
export function creatureBatch(worlds: readonly number[], material: ShaderMaterial): BufferGeometry {
  const positions: number[] = [], colors: number[] = [], ids: number[] = [];
  const v = new Vector3();
  for (const world of worlds) {
    const root = creatureHologram(world, material);
    const a = (world + .5) * ISLAND_SECTOR;
    root.position.set(Math.cos(a) * REGION_RADIUS, REGION_TOP, Math.sin(a) * REGION_RADIUS);
    root.updateMatrixWorld(true);
    const mesh = root.children[0] as Mesh;
    const p = mesh.geometry.getAttribute('position'), c = mesh.geometry.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
      colors.push(c.getX(i), c.getY(i), c.getZ(i));
      ids.push(world);
    }
    mesh.geometry.dispose();
    root.clear();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aWorld', new Float32BufferAttribute(ids, 1));
  geometry.setAttribute('aLayer', new Float32BufferAttribute(new Float32Array(ids.length), 1));
  geometry.computeVertexNormals();
  if (positions.length) {
    geometry.computeBoundingSphere();
    geometry.boundingSphere!.radius += .03;
  }
  return geometry;
}
