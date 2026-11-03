/** Eight volumetric holographic biomes; only uniforms/transforms change per frame.
 * Metres, +Y up; parentless until GameSystem places it above the mat.
 */
import {
  BufferGeometry, DoubleSide, EdgesGeometry,
  Float32BufferAttribute, Group, LineLoop, LineSegments, Mesh, MeshBasicMaterial, Vector3,
} from '@iwsdk/core';
import { TextLabel } from './glass.js';
import { holoBody, holoLine } from './holo.js';
import { islandProgress, type IslandProgress } from './island-progress.js';
import { PER_WORLD, WORLDS } from './levels.js';
import type { HandBodies } from './hand-bodies.js';
import { sfx } from './sfx.js';
import { creatureHologram, driftingCloud, foundation } from './island-holograms.js';
import {
  Facets, ISLAND_RADIUS as RADIUS, ISLAND_INNER as INNER,
  ISLAND_SECTOR as SECTOR, ISLAND_GAP as GAP, REGION_RADIUS, REGION_TOP,
  polar, surfaceHeight, terrain, type P,
} from './island-terrain.js';

const TAU = Math.PI * 2;
const noHit = () => {};

export interface WorldIslandHost {
  play(index: number): void;
  canPlay(): boolean;
}

export class WorldIsland {
  readonly root = new Group();
  readonly hits: Mesh[] = [];
  readonly progress: IslandProgress[] = [];
  private labels: TextLabel[] = [];
  private body = holoBody();
  private creatureBody = holoBody();
  private creatures: (Group | null)[] = new Array(WORLDS.length).fill(null);
  private lift = new Float32Array(8);
  private focus = new Float32Array(8);
  private lines = holoLine(0x9befff);
  private open = new Float32Array(8);
  private fill = new Float32Array(8);
  private from = new Float32Array(8);
  private fillTime = new Float32Array(8).fill(1);
  private hover = new Float32Array(8);
  private rayHovers = new Int8Array(8);
  private shake = new Float32Array(8);
  private shakeTime = new Float32Array(8);
  private pulse = new LineLoop(new BufferGeometry(), holoLine(0xd8faff));
  private wave = new LineLoop(new BufferGeometry(), holoLine(0xa4f3ff));
  private local = new Vector3();
  private pinchWasOn = [false, false];
  private current = -1;
  private clock = 0;
  private lastFire = -Infinity;
  private waveTime = 1;
  private waveWorld = -1;

  constructor(private host: WorldIslandHost) {
    this.root.name = 'WorldIsland';
    const all = new Facets();
    const edges: number[] = [], worlds: number[] = [], outlines: number[] = [], gaps: number[] = [];
    const hitMaterial = new MeshBasicMaterial({ visible: false, side: DoubleSide });
    for (let w = 0; w < WORLDS.length; w++) {
      const f = terrain(w);
      all.append(f);
      const g = f.geometry();
      const hit = new Mesh(g, hitMaterial);
      hit.name = `Island_${WORLDS[w].name}`;
      this.hits.push(hit);
      this.root.add(hit);
      const e = new EdgesGeometry(g, 25);
      const p = e.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        edges.push(p.getX(i), p.getY(i), p.getZ(i));
        worlds.push(w); outlines.push(0); gaps.push(Math.floor(i / 2) % 2);
      }
      e.dispose();
      // Full perimeter, dashed only when locked; suppress the interior wire then.
      const path: P[] = [];
      const a0 = w * SECTOR + GAP, a1 = (w + 1) * SECTOR - GAP;
      for (let j = 0; j <= 16; j++) path.push(polar(RADIUS, a0 + (a1-a0)*j/16, .002));
      for (let j = 1; j <= 12; j++) path.push(polar(RADIUS-(RADIUS-INNER)*j/12, a1, .002));
      for (let j = 1; j <= 8; j++) path.push(polar(INNER, a1-(a1-a0)*j/8, .002));
      for (let j = 1; j <= 12; j++) path.push(polar(INNER+(RADIUS-INNER)*j/12, a0, .002));
      for (let j = 0; j < path.length - 1; j++) {
        edges.push(...path[j], ...path[j+1]);
        worlds.push(w,w); outlines.push(1,1); gaps.push(j%2,j%2);
      }
      const label = new TextLabel(.018);
      label.mesh.position.set(0, .12, 0);
      if (!Array.isArray(label.mesh.material)) label.mesh.material.forceSinglePass = true;
      label.mesh.rotation.x = -Math.PI / 2;
      label.mesh.raycast = noHit;
      label.mesh.visible = false;
      this.labels.push(label);
      this.root.add(label.mesh);
      const events = hit as unknown as { addEventListener(type: string, cb: () => void): void };
      events.addEventListener('pointerenter', () => { this.rayHovers[w]++; });
      events.addEventListener('pointerleave', () => { this.rayHovers[w] = Math.max(0, this.rayHovers[w]-1); });
      events.addEventListener('pointerdown', () => this.select(w));
    }
    this.configureBody();
    const body = new Mesh(all.geometry(), this.body);
    body.name = 'Island_terraces_and_markers';
    body.raycast = noHit;
    this.root.add(body);
    const wire = new BufferGeometry();
    wire.setAttribute('position', new Float32BufferAttribute(edges, 3));
    wire.setAttribute('aWorld', new Float32BufferAttribute(worlds, 1));
    wire.setAttribute('aOutline', new Float32BufferAttribute(outlines, 1));
    wire.setAttribute('aGap', new Float32BufferAttribute(gaps, 1));
    this.configureLines();
    const mesh = new LineSegments(wire, this.lines);
    mesh.name = 'Island_wire_and_lock_outlines';
    mesh.raycast = noHit;
    this.root.add(mesh);
    this.root.add(foundation(), driftingCloud());
    this.creatureBody.forceSinglePass = true;
    this.creatureBody.uniforms.uThick.value = 0;
    this.creatureBody.uniforms.uGlow.value = 1.8;
    this.creatureBody.fragmentShader = this.creatureBody.fragmentShader.replace(
      'float body = 0.09', 'float body = 0.48');
    const ring: number[] = [];
    const waveRing: number[] = [];
    for (let i = 0; i < 64; i++) {
      ring.push(Math.cos(i*TAU/64), 0, Math.sin(i*TAU/64));
      waveRing.push(Math.cos(i*TAU/64), 1, Math.sin(i*TAU/64));
    }
    this.pulse.geometry.setAttribute('position', new Float32BufferAttribute(ring, 3));
    this.wave.geometry.setAttribute('position', new Float32BufferAttribute(waveRing, 3));
    this.wave.position.y = .005;
    this.pulse.name = 'Island_current_world_pulse';
    this.wave.name = 'Island_solve_wave';
    this.pulse.raycast = this.wave.raycast = noHit;
    this.wave.visible = false;
    this.root.add(this.pulse, this.wave);
    this.setProgress([], [0, 1]);
  }

  private configureBody() {
    const m = this.body;
    m.forceSinglePass = true;
    m.uniforms.uThick.value = 0;
    m.uniforms.uTintK.value = 0;
    m.uniforms.uFill = { value: this.fill };
    m.uniforms.uOpen = { value: this.open };
    m.uniforms.uHover = { value: this.hover };
    m.uniforms.uShake = { value: this.shake };
    m.uniforms.uLift = { value: this.lift };
    m.uniforms.uFocus = { value: this.focus };
    m.vertexShader = `attribute float aWorld; attribute float aTerrace;
      uniform float uShake[8]; uniform float uLift[8];
      varying float vIslandWorld; varying float vTerrace;\n${m.vertexShader}`
      .replace('void main() {', 'void main() { vIslandWorld = aWorld; vTerrace = aTerrace;')
      .replace('vec4 w = modelMatrix', 'p.x += uShake[int(aWorld)]; p.y += uLift[int(aWorld)]; vec4 w = modelMatrix');
    m.fragmentShader = `uniform float uFill[8]; uniform float uOpen[8]; uniform float uHover[8]; uniform float uFocus[8];
      varying float vIslandWorld; varying float vTerrace;\n${m.fragmentShader}`
      .replace('void main() {', `void main() {
        int wi = int(vIslandWorld + 0.5);
        float awake = step(0.001, uFill[wi]);
        float islandFill = clamp(uFill[wi] - vTerrace, 0.0, 1.0);
        float islandGain = (1.0 + uFocus[wi] * 0.45 + uHover[wi] * 0.35);`)
      .replace('float body = 0.09', 'float body = 0.65')
      .replace('gl_FragColor = vec4(col, min(0.4, 0.12 + 0.3 * rim));', `
        // Faint surveyed land before solving; bright coloured solid facets after.
        col = mix(vec3(0.18, 0.56, 0.75) * 0.12, col, awake);
        col *= mix(0.9, 0.45 + 0.55 * islandFill, awake) * islandGain;
        float alpha = mix(uOpen[wi] > 0.5 ? 0.055 : 0.03, 0.62, awake);
        gl_FragColor = vec4(col * alpha, alpha);`);
  }

  private configureLines() {
    this.lines.onBeforeCompile = (shader) => {
      shader.uniforms.uOpen = { value: this.open };
      shader.uniforms.uFill = { value: this.fill };
      shader.uniforms.uHover = { value: this.hover };
      shader.uniforms.uShake = { value: this.shake };
      shader.uniforms.uLift = { value: this.lift };
      shader.vertexShader = `attribute float aWorld; attribute float aOutline; attribute float aGap;
        uniform float uOpen[8]; uniform float uFill[8]; uniform float uHover[8];
        uniform float uShake[8]; uniform float uLift[8];
        varying float vIslandLight;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          int wi = int(aWorld + 0.5);
          transformed.x += uShake[wi]; transformed.y += uLift[wi];
          vIslandLight = uFill[wi] > 0.001 ? 0.19 + uHover[wi] * 0.25
            : (1.0 - aGap) * (0.13 + uOpen[wi] * 0.08 + uHover[wi] * 0.2);`);
      shader.fragmentShader = `varying float vIslandLight;\n${shader.fragmentShader}`
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          if (vIslandLight < 0.001) discard;
          vec4 diffuseColor = vec4(diffuse * vIslandLight, opacity);`);
    };
    this.lines.customProgramCacheKey = () => 'foldlings-island-lines-v2';
  }

  setProgress(solved: readonly string[], unlockedWorlds: readonly number[], animate = false) {
    for (let i = 0; i < WORLDS.length; i++) {
      const state = islandProgress(i, solved, unlockedWorlds);
      this.from[i] = this.fill[i];
      this.fillTime[i] = animate && state.solved > this.fill[i] ? 0 : 1;
      if (this.fillTime[i] === 1) this.fill[i] = state.solved;
      this.open[i] = state.unlocked ? 1 : 0;
      this.progress[i] = state;
      if (state.solved > 0 && !this.creatures[i]) {
        this.creatures[i] = creatureHologram(i, this.creatureBody);
        this.root.add(this.creatures[i]!);
        this.positionRegion(i);
      }
      if (this.creatures[i]) this.creatures[i]!.visible = state.solved > 0;
      this.labels[i].set(`${WORLDS[i].name.toUpperCase()}  ${state.solved}/${PER_WORLD}${state.unlocked ? '' : '  LOCKED'}`);
    }
  }

  setCurrentWorld(worldIndex: number) {
    this.current = Number.isInteger(worldIndex) && worldIndex >= 0 && worldIndex < WORLDS.length ? worldIndex : -1;
    this.pulse.visible = this.current >= 0;
    for (let i = 0; i < WORLDS.length; i++) {
      this.focus[i] = i === this.current ? 1 : 0;
      this.lift[i] = this.focus[i] * .01 + (this.rayHovers[i] > 0 ? .015 : 0);
      this.positionRegion(i);
    }
  }

  private positionRegion(i: number) {
    const a = (i + .5) * SECTOR, x = Math.cos(a) * REGION_RADIUS + this.shake[i], z = Math.sin(a) * REGION_RADIUS;
    this.hits[i].position.set(this.shake[i], this.root.visible ? this.lift[i] : -50, 0);
    const creature = this.creatures[i];
    if (creature) creature.position.set(x, REGION_TOP + this.lift[i], z);
    if (i === this.current) this.pulse.position.set(x, REGION_TOP + this.lift[i] + .001, z);
  }

  /** Centre of the highest terrace, in world coordinates, including visual lift. */
  regionCenter(i: number, out: Vector3): Vector3 {
    if (!Number.isInteger(i) || i < 0 || i >= WORLDS.length) throw new RangeError(`Invalid island world: ${i}`);
    const a = (i + .5) * SECTOR;
    out.set(Math.cos(a) * REGION_RADIUS + this.shake[i], REGION_TOP + this.lift[i], Math.sin(a) * REGION_RADIUS);
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(out);
  }

  setVisible(visible: boolean) {
    if (this.root.visible === visible) return;
    this.root.visible = visible;
    // Park hit surfaces too: pointer libraries can traverse invisible ancestors.
    for (let i = 0; i < this.hits.length; i++) {
      this.hits[i].position.y = visible ? this.lift[i] : -50;
      this.rayHovers[i] = 0;
      this.labels[i].mesh.visible = false;
    }
  }

  celebrate(worldIndex: number) {
    if (!Number.isInteger(worldIndex) || worldIndex < 0 || worldIndex >= WORLDS.length) return;
    this.waveWorld = worldIndex;
    this.waveTime = 0;
    this.wave.visible = true;
  }

  /** Same callback as the level book; the host guards busy and modal states. */
  private select(worldIndex: number) {
    if (!this.root.visible || !this.host.canPlay() || this.clock-this.lastFire < .35) return;
    this.lastFire = this.clock;
    if (!this.progress[worldIndex].unlocked) {
      this.shakeTime[worldIndex] = .35;
      sfx.error();
      return;
    }
    sfx.click();
    this.host.play(this.progress[worldIndex].nextLevelIndex);
  }

  private nearWorld(at: Vector3): number {
    this.local.copy(at);
    this.root.worldToLocal(this.local);
    const r = Math.hypot(this.local.x, this.local.z);
    if (r < INNER || r > RADIUS) return -1;
    const a = (Math.atan2(this.local.z, this.local.x) + TAU) % TAU;
    const within = a % SECTOR;
    if (within < GAP || within > SECTOR-GAP) return -1;
    const world = Math.floor(a / SECTOR);
    const y = surfaceHeight(this.hits[world].geometry, this.local.x - this.shake[world], this.local.z) + this.lift[world];
    return Math.abs(this.local.y-y) < .035 ? world : -1;
  }

  update(dt: number, hands: HandBodies['pinch']) {
    this.clock += dt;
    this.waveTime = Math.min(1, this.waveTime+dt);
    let nearLeft = -1, nearRight = -1;
    for (let h = 0; h < 2; h++) {
      const hand = h === 0 ? hands.left : hands.right;
      const on = hand.tracked && hand.on;
      const near = this.root.visible && hand.tracked ? this.nearWorld(hand.at) : -1;
      if (h === 0) nearLeft = near; else nearRight = near;
      if (on && !this.pinchWasOn[h] && near >= 0) this.select(near);
      this.pinchWasOn[h] = on;
    }
    let labelWorld = -1;
    for (let i = 0; i < WORLDS.length; i++) {
      const hovered = this.rayHovers[i] > 0 || i === nearLeft || i === nearRight;
      if (hovered) labelWorld = i;
      this.hover[i] = (hovered ? 1 : 0) + (i === this.waveWorld ? Math.max(0, 1-this.waveTime/.8) : 0);
      this.fillTime[i] = Math.min(1, this.fillTime[i]+dt);
      this.fill[i] = this.from[i] + (this.progress[i].solved-this.from[i])*this.fillTime[i];
      this.shakeTime[i] = Math.max(0, this.shakeTime[i]-dt);
      this.shake[i] = Math.sin(this.shakeTime[i]*85)*.004*(this.shakeTime[i]/.35);
      this.lift[i] = this.focus[i] * .01 + (hovered ? .015 : 0);
      this.positionRegion(i);
      const creature = this.creatures[i];
      if (creature) creature.rotation.y = .24 * Math.sin(this.clock * .42 + i);
    }
    for (let i = 0; i < this.labels.length; i++) this.labels[i].mesh.visible = i === labelWorld;
    this.pulse.scale.setScalar(.024*(1+.1*Math.sin(this.clock*2)));
    this.pulse.material.opacity = .45+.3*Math.sin(this.clock*2);
    this.wave.visible = this.waveTime < .8;
    const radius = .012+(RADIUS-.012)*Math.min(1,this.waveTime/.8);
    // Solve wave expands across the volumetric island without rebuilding geometry.
    this.wave.scale.set(radius, .03*Math.max(0,1-this.waveTime/.8), radius);
    this.wave.material.opacity = Math.max(0,1-this.waveTime/.8);
  }
}
