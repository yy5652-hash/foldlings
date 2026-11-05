/** Eight tinted holographic biomes; only uniforms/transforms change per frame.
 * Metres, +Y up; parentless until GameSystem places it above the mat.
 */
import {
  BufferGeometry, DoubleSide, EdgesGeometry,
  CircleGeometry, Color, CylinderGeometry, RingGeometry, Float32BufferAttribute, Group, LineLoop, LineSegments, Mesh, MeshBasicMaterial, Vector3,
} from '@iwsdk/core';
import { TextLabel } from './glass.js';
import { holoBody, holoLine } from './holo.js';
import { islandProgress, type IslandProgress } from './island-progress.js';
import { PER_WORLD, WORLDS } from './levels.js';
import type { HandBodies } from './hand-bodies.js';
import { sfx } from './sfx.js';
import { creatureBatch, driftingCloud, foundation } from './island-holograms.js';
import {
  BIOME_COLORS, Facets, ISLAND_RADIUS as RADIUS, ISLAND_INNER as INNER,
  ISLAND_SECTOR as SECTOR, ISLAND_GAP as GAP, REGION_RADIUS, REGION_TOP,
  polar, surfaceHeight, terrain, type P,
} from './island-terrain.js';

const TAU = Math.PI * 2;
const noHit = () => {};

export interface WorldIslandHost {
  play(index: number): void;
  canPlay(): boolean;
  flash(): void;
}

export class WorldIsland {
  readonly root = new Group();
  readonly hits: Mesh[] = [];
  readonly hub = new Mesh(new CircleGeometry(.03, 48), new MeshBasicMaterial({ visible: false, side: DoubleSide }));
  private hubLabel = new TextLabel(.02);
  private hubHovers = 0;
  private flashRing = new Mesh(new RingGeometry(.031, .034, 180, 1, Math.PI / 2, -TAU), new MeshBasicMaterial({
    color: 0xa4f3ff, transparent: true, opacity: .8, toneMapped: false, side: DoubleSide, depthWrite: false,
  }));
  private flashSeconds: number | null = null;
  private waveStrength = 1;

  readonly progress: IslandProgress[] = [];
  // Pre-render textures on progress changes, then swap references without canvas work in update().
  private labels: TextLabel[] = [];
  private hoverLabel = new Mesh();
  private startLabel = new TextLabel(.018);
  private beacon = new Mesh(new CylinderGeometry(.0015, .0025, .07, 6), new MeshBasicMaterial({
    color: BIOME_COLORS[0], transparent: true, opacity: .65, toneMapped: false, depthWrite: false,
  }));
  private body = holoBody();
  private creatureBody = holoBody();
  private creatures = new Mesh(new BufferGeometry(), this.creatureBody);
  private creatureMask = 0;
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
    this.hub.name = 'Island_FlashFold';
    this.hub.rotation.x = -Math.PI / 2;
    this.hub.position.y = -.012;
    this.flashRing.material.forceSinglePass = true;
    this.hubLabel.mesh.name = 'Flash_hub_label';
    if (!Array.isArray(this.hubLabel.mesh.material)) this.hubLabel.mesh.material.forceSinglePass = true;
    this.hubLabel.set('FLASH FOLD');
    this.hubLabel.mesh.position.set(0, .045, 0);
    this.hubLabel.mesh.rotation.x = -Math.PI / 2;
    this.hubLabel.mesh.raycast = this.flashRing.raycast = noHit;
    this.hubLabel.mesh.visible = false;
    this.flashRing.name = 'Flash_clock_ring';
    this.flashRing.rotation.x = -Math.PI / 2;
    this.flashRing.position.y = -.01;
    this.root.add(this.hub, this.hubLabel.mesh, this.flashRing);
    const hubEvents = this.hub as unknown as { addEventListener(type: string, cb: () => void): void };
    hubEvents.addEventListener('pointerenter', () => this.hubHovers++);
    hubEvents.addEventListener('pointerleave', () => { this.hubHovers = Math.max(0, this.hubHovers - 1); });
    hubEvents.addEventListener('pointerdown', () => this.select(8));

    const all = new Facets();
    const edgeColors: number[] = [];
    const tint = new Color();
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
      tint.set(BIOME_COLORS[w]);
      while (edgeColors.length < edges.length) edgeColors.push(tint.r, tint.g, tint.b);
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
    wire.setAttribute('color', new Float32BufferAttribute(edgeColors, 3));
    wire.setAttribute('aWorld', new Float32BufferAttribute(worlds, 1));
    wire.setAttribute('aOutline', new Float32BufferAttribute(outlines, 1));
    wire.setAttribute('aGap', new Float32BufferAttribute(gaps, 1));
    this.configureLines();
    const mesh = new LineSegments(wire, this.lines);
    mesh.name = 'Island_wire_and_lock_outlines';
    mesh.raycast = noHit;
    this.root.add(mesh);
    this.root.add(foundation(), driftingCloud());
    this.hoverLabel.geometry.dispose();
    (this.hoverLabel.material as MeshBasicMaterial).dispose();
    this.hoverLabel.geometry = this.labels[0].mesh.geometry;
    this.hoverLabel.material = this.labels[0].mesh.material;
    this.hoverLabel.name = 'Island_hover_label';
    this.hoverLabel.raycast = noHit;
    this.hoverLabel.visible = false;
    this.beacon.name = 'Island_START_column';
    this.startLabel.mesh.name = 'Island_START_label';
    this.startLabel.set('START');
    this.startLabel.mesh.rotation.x = -Math.PI / 2;
    this.startLabel.mesh.raycast = this.beacon.raycast = noHit;
    if (!Array.isArray(this.startLabel.mesh.material)) this.startLabel.mesh.material.forceSinglePass = true;
    this.creatures.name = 'Island_creature_batch';
    this.creatures.raycast = noHit;
    this.creatures.visible = false;
    this.root.add(this.hoverLabel, this.beacon, this.startLabel.mesh, this.creatures);
    this.creatureBody.uniforms.uLift = { value: this.lift };
    this.creatureBody.uniforms.uShake = { value: this.shake };
    this.creatureBody.vertexShader = `attribute float aWorld; uniform float uLift[8]; uniform float uShake[8];
${this.creatureBody.vertexShader}`
      .replace('vec4 w = modelMatrix', 'p.x += uShake[int(aWorld)]; p.y += uLift[int(aWorld)]; vec4 w = modelMatrix');
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
        float islandFill = clamp(uFill[wi] - vTerrace, 0.0, 1.0);
        float islandGain = (1.0 + uFocus[wi] * 0.45 + uHover[wi] * 0.35);`)
      .replace('float body = 0.09', 'float body = 0.65')
      .replace('gl_FragColor = vec4(col, min(0.4, 0.12 + 0.3 * rim));', `
        // Faint surveyed land before solving; bright coloured solid facets after.
        // Unsolved facets retain their own colour at 30% brightness (25% locked).
        // The same alpha preserves that ratio with premultiplied additive light.
        float base = uOpen[wi] > 0.5 ? 0.30 : 0.25;
        col *= mix(base, 1.0, islandFill) * islandGain;
        float alpha = 0.62;
        gl_FragColor = vec4(col * alpha, alpha);`);
  }

  private configureLines() {
    this.lines.color.set(0xffffff);
    this.lines.vertexColors = true;
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
          float pattern = uOpen[wi] > 0.5 ? 1.0 : aOutline * (1.0 - aGap);
          vIslandLight = pattern * (0.22 + uOpen[wi] * 0.13 + min(uFill[wi], 1.0) * 0.15 + uHover[wi] * 0.2);`);
      shader.fragmentShader = `varying float vIslandLight;\n${shader.fragmentShader}`
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          if (vIslandLight < 0.001) discard;
          vec4 diffuseColor = vec4(diffuse * vIslandLight, opacity);`);
    };
    this.lines.customProgramCacheKey = () => 'foldlings-island-lines-v3';
  }

  setProgress(solved: readonly string[], unlockedWorlds: readonly number[], animate = false) {
    for (let i = 0; i < WORLDS.length; i++) {
      const state = islandProgress(i, solved, unlockedWorlds);
      this.from[i] = this.fill[i];
      this.fillTime[i] = animate && state.solved > this.fill[i] ? 0 : 1;
      if (this.fillTime[i] === 1) this.fill[i] = state.solved;
      this.open[i] = state.unlocked ? 1 : 0;
      this.progress[i] = state;
      this.labels[i].set(`${WORLDS[i].name.toUpperCase()}  ${state.solved}/${PER_WORLD}${state.unlocked ? '' : '  LOCKED'}`);
    }
    let mask = 0;
    const worlds: number[] = [];
    for (let i = 0; i < WORLDS.length; i++) if (this.progress[i].solved > 0) {
      mask |= 1 << i;
      worlds.push(i);
    }
    if (mask !== this.creatureMask) {
      this.creatures.geometry.dispose();
      this.creatures.geometry = creatureBatch(worlds, this.creatureBody);
      this.creatureMask = mask;
    }
    this.creatures.visible = mask !== 0;
    this.updateBeacon(true);
  }

  setCurrentWorld(worldIndex: number) {
    this.current = Number.isInteger(worldIndex) && worldIndex >= 0 && worldIndex < WORLDS.length ? worldIndex : -1;
    this.pulse.visible = this.current >= 0;
    for (let i = 0; i < WORLDS.length; i++) {
      this.focus[i] = i === this.current ? 1 : 0;
      this.lift[i] = this.focus[i] * .01 + (this.rayHovers[i] > 0 ? .015 : 0);
      this.positionRegion(i);
    }
    this.updateBeacon(true);
  }

  private updateBeacon(reduceMotion: boolean) {
    const i = this.current < 0 ? 0 : this.current;
    const show = this.progress[i].unlocked && this.progress[i].solved === 0;
    this.beacon.visible = this.startLabel.mesh.visible = show;
    if (!show) return;
    const a = (i + .5) * SECTOR;
    const x = Math.cos(a) * REGION_RADIUS + this.shake[i], z = Math.sin(a) * REGION_RADIUS;
    this.beacon.position.set(x, REGION_TOP + this.lift[i] + .035, z);
    this.startLabel.mesh.position.set(x, REGION_TOP + this.lift[i] + .085, z);
    this.beacon.material.color.set(BIOME_COLORS[i]);
    this.beacon.material.opacity = reduceMotion ? .65 : .55 + .2 * Math.sin(this.clock * 2.8);
  }

  private positionRegion(i: number) {
    const a = (i + .5) * SECTOR, x = Math.cos(a) * REGION_RADIUS + this.shake[i], z = Math.sin(a) * REGION_RADIUS;
    this.hits[i].position.set(this.shake[i], this.root.visible ? this.lift[i] : -50, 0);
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
    this.hub.position.y = visible ? -.012 : -50;
    this.hubHovers = 0;
    this.hubLabel.mesh.visible = this.hoverLabel.visible = false;
    // Park hit surfaces too: pointer libraries can traverse invisible ancestors.
    for (let i = 0; i < this.hits.length; i++) {
      this.hits[i].position.y = visible ? this.lift[i] : -50;
      this.rayHovers[i] = 0;
      this.labels[i].mesh.visible = false;
    }
  }

  setFlashClock(seconds: number | null) { this.flashSeconds = seconds; }

  celebrate(worldIndex: number, combo = 1) {
    if (!Number.isInteger(worldIndex) || worldIndex < 0 || worldIndex >= WORLDS.length) return;
    this.waveStrength = 1 + .3 * (Math.max(1, Math.min(5, combo)) - 1);
    this.waveWorld = worldIndex;
    this.waveTime = 0;
    this.wave.visible = true;
  }

  /** Same callback as the level book; the host guards busy and modal states. */
  private select(worldIndex: number) {
    if (!this.root.visible || !this.host.canPlay() || this.clock-this.lastFire < .35) return;
    this.lastFire = this.clock;
    if (worldIndex === 8) { sfx.click(); this.host.flash(); return; }
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
    if (r < .03 && Math.abs(this.local.y + .012) < .035) return 8;
    if (r < INNER || r > RADIUS) return -1;
    const a = (Math.atan2(this.local.z, this.local.x) + TAU) % TAU;
    const within = a % SECTOR;
    if (within < GAP || within > SECTOR-GAP) return -1;
    const world = Math.floor(a / SECTOR);
    const y = surfaceHeight(this.hits[world].geometry, this.local.x - this.shake[world], this.local.z) + this.lift[world];
    return Math.abs(this.local.y-y) < .035 ? world : -1;
  }

  update(dt: number, hands: HandBodies['pinch'], reduceMotion = false) {
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
      this.hover[i] = (hovered ? 1 : 0) + (!reduceMotion && i === this.waveWorld ? this.waveStrength * Math.max(0, 1-this.waveTime/.7) : 0);
      this.fillTime[i] = Math.min(1, this.fillTime[i]+dt);
      this.fill[i] = this.from[i] + (this.progress[i].solved-this.from[i])*this.fillTime[i];
      this.shakeTime[i] = Math.max(0, this.shakeTime[i]-dt);
      this.shake[i] = Math.sin(this.shakeTime[i]*85)*.004*(this.shakeTime[i]/.35);
      this.lift[i] = this.focus[i] * .01 + (hovered ? .015 : 0);
      this.positionRegion(i);
    }
    this.hoverLabel.visible = this.root.visible && labelWorld >= 0;
    if (labelWorld >= 0) {
      const source = this.labels[labelWorld].mesh;
      this.hoverLabel.geometry = source.geometry;
      this.hoverLabel.material = source.material;
      this.hoverLabel.position.copy(source.position);
      this.hoverLabel.rotation.copy(source.rotation);
      this.hoverLabel.scale.copy(source.scale);
    }
    this.updateBeacon(reduceMotion);
    this.pulse.scale.setScalar(.024*(1+.1*Math.sin(this.clock*2)));
    this.pulse.material.opacity = .45+.3*Math.sin(this.clock*2);
    this.hubLabel.mesh.visible = this.flashSeconds === null && (this.hubHovers > 0 || nearLeft === 8 || nearRight === 8);
    const segments = this.flashSeconds === null ? 180 : Math.max(0, Math.min(180, Math.ceil(this.flashSeconds * 2)));
    this.flashRing.geometry.setDrawRange((180 - segments) * 6, segments * 6);
    const urgent = this.flashSeconds !== null && this.flashSeconds <= 10;
    this.flashRing.material.color.set(urgent ? (!reduceMotion && Math.sin(this.clock * 12) > 0 ? 0xff563f : 0xffb347) : 0xa4f3ff);
    this.flashRing.material.opacity = urgent && !reduceMotion ? .65 + .35 * Math.sin(this.clock * 12) : .8;
    this.wave.visible = !reduceMotion && this.waveTime < .7;
    const radius = .012+(RADIUS-.012)*Math.min(1,this.waveTime/.7);
    // Solve wave expands across the volumetric island without rebuilding geometry.
    this.wave.scale.set(radius * (1 + .1 * (this.waveStrength - 1)), .03 * this.waveStrength *Math.max(0,1-this.waveTime/.7), radius);
    this.wave.material.opacity = Math.max(0,1-this.waveTime/.7) * Math.min(1, .55 * this.waveStrength);
  }
}
