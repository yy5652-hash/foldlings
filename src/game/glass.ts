/**
 * The spatial interface kit: floating glass surfaces, type and motion, in the
 * manner of visionOS. Passthrough pixels cannot be read, so the glass is a
 * translucent scrim with a lit rim, a specular lobe that moves with your head
 * and a soft shadow, rather than a real blur.
 *
 * Every surface is one quad and one draw call: the rounded shape, shadow and
 * content texture are all resolved in one shader, composited in display space
 * the way a browser composites CSS.
 */

import {
  CanvasTexture,
  CircleGeometry,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  PokeInteractable,
  RayInteractable,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  World,
} from '@iwsdk/core';
import { ICON_PATHS, IconKind } from './icon-paths.js';

export type { IconKind };

export const SANS = '"Inter Variable", -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

/** White at three levels, which is how visionOS sets text on glass. */
export const INK = {
  primary: 'rgba(255,255,255,0.98)',
  secondary: 'rgba(255,255,255,0.68)',
  tertiary: 'rgba(255,255,255,0.42)',
  gold: '#ffd166',
  /** Soft white fill of a section on a window. */
  section: 'rgba(255,255,255,0.075)',
  sectionHover: 'rgba(255,255,255,0.14)',
};

/** Draw layers: windows, then what sits on them, then what floats over them. */
export const LAYER = { window: 100, section: 101, control: 102, text: 103, overlay: 110 };

const VERT = /* glsl */ `
uniform vec2 uQuad;
varying vec2 vP;
varying vec3 vView;
varying vec3 vN;
varying vec3 vL;
void main() {
  vP = position.xy * uQuad;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vN = normalMatrix * vec3(0.0, 0.0, 1.0);
  vL = (viewMatrix * vec4(-0.25, 1.0, 0.35, 0.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec2 uHalf;
uniform float uR;
uniform vec3 uTint;
uniform float uBody;
uniform float uRim;
uniform float uSheen;
uniform float uShadow;
uniform float uSoft;
uniform float uDrop;
uniform float uFade;
uniform sampler2D uMap;
uniform float uUseMap;
uniform float uHover;
uniform vec2 uHoverP;
uniform float uSpot;
uniform float uFill;
uniform vec3 uFillTint;
varying vec2 vP;
varying vec3 vView;
varying vec3 vN;
varying vec3 vL;

float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  float d = box(vP, uHalf, uR);
  float aa = max(fwidth(d), 1e-5);
  float shape = 1.0 - smoothstep(-aa, aa, d);

  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  vec3 H = normalize(normalize(vL) + V);
  float spec = pow(max(dot(N, H), 0.0), 70.0);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);

  float up = clamp(vP.y / uHalf.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = uTint + vec3(0.085) * up * up;
  float a = uBody;

  float sheen = uSheen * uBody;
  col += vec3(spec * 0.55 + fres * 0.3) * sheen;
  a += (spec * 0.3 + fres * 0.25) * sheen;

  // A soft light that follows the finger, ray or gaze across the surface.
  float spot = uHover * smoothstep(uSpot, 0.0, length(vP - uHoverP));
  col += vec3(0.5) * spot;
  a += spot * 0.22;
  a = clamp(a, 0.0, 1.0);

  // The fill runs left to right: progress on a pill, the "on" of a toggle.
  if (uFill > 0.0) {
    float x = vP.x / uHalf.x * 0.5 + 0.5;
    float f = 1.0 - smoothstep(uFill - 0.004, uFill + 0.004, x);
    col = mix(col, uFillTint, f);
    a = mix(a, 1.0, f);
  }

  vec3 pm = col * a * shape;
  float pa = a * shape;

  // Rim: a hairline lit from above, stronger under hover.
  if (uRim > 0.0) {
    float rimW = 0.0011;
    float rim = (smoothstep(-rimW - aa, -rimW + aa, d)) * shape;
    float lit = mix(0.14, 0.85, smoothstep(-0.8, 0.9, vP.y / uHalf.y - vP.x / uHalf.x * 0.25));
    rim *= clamp(lit * uRim + uHover * 0.25, 0.0, 1.0);
    pm = pm * (1.0 - rim) + vec3(rim);
    pa = pa * (1.0 - rim) + rim;
  }

  if (uUseMap > 0.5) {
    vec4 m = texture2D(uMap, vP / (2.0 * uHalf) + 0.5);
    m *= shape;
    pm = m.rgb + pm * (1.0 - m.a);
    pa = m.a + pa * (1.0 - m.a);
  }

  if (uShadow > 0.0) {
    float sd = box(vP + vec2(0.0, uDrop), uHalf, uR);
    float s = uShadow * pow(1.0 - smoothstep(-uSoft * 0.5, uSoft, sd), 2.0);
    pa = pa + s * (1.0 - pa);
  }

  pm *= uFade;
  pa *= uFade;
  if (pa < 0.003) discard;
  gl_FragColor = vec4(pm, pa);
}`;

const UNIT_QUAD = new PlaneGeometry(1, 1);
const UNIT_DISC = new CircleGeometry(1, 24);
/** Never drawn, but rays and fingertips still find it. */
const HIT_MATERIAL = new MeshBasicMaterial({ visible: false });

/** A pressable rectangle facing +Z, centred on the origin. */
export function hitPlane(w: number, h: number): Mesh {
  const m = new Mesh(UNIT_QUAD, HIT_MATERIAL);
  m.scale.set(w, h, 1);
  m.name = 'Hit';
  return m;
}

/** A pressable disc facing +Z, centred on the origin. */
export function hitDisc(r: number): Mesh {
  const m = new Mesh(UNIT_DISC, HIT_MATERIAL);
  m.scale.set(r, r, 1);
  m.name = 'Hit';
  return m;
}

export interface SurfaceOptions {
  w: number;
  h: number;
  /** Corner radius in metres; defaults to fully round on the short side. */
  r?: number;
  tint?: [number, number, number];
  /** Scrim opacity; 0 draws no body at all (text or hit areas). */
  body?: number;
  rim?: number;
  sheen?: number;
  shadow?: number;
  /** Shadow softness and how far it falls, in metres. */
  soft?: number;
  drop?: number;
  map?: Texture | null;
  order?: number;
}

/** The standard dark glass used by windows. */
export const WINDOW_GLASS = { tint: [0.1, 0.105, 0.125] as [number, number, number], body: 0.66, rim: 1, sheen: 1 };
/** The thinner glass of a control floating on its own. */
export const CONTROL_GLASS = { tint: [0.14, 0.145, 0.165] as [number, number, number], body: 0.6, rim: 0.9, sheen: 1 };

/** One rounded, lit, shadowed quad. Its local XY plane faces +Z. */
export class Surface {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly material: ShaderMaterial;
  private pad = 0;

  constructor(opts: SurfaceOptions) {
    const soft = opts.soft ?? 0.018;
    const drop = opts.drop ?? 0.006;
    const shadow = opts.shadow ?? 0;
    this.pad = shadow > 0 ? soft + drop : 0;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      toneMapped: false,
      uniforms: {
        uQuad: { value: new Vector2(1, 1) },
        uHalf: { value: new Vector2(0.5, 0.5) },
        uR: { value: opts.r ?? Math.min(opts.w, opts.h) / 2 },
        uTint: { value: new Vector3(...(opts.tint ?? WINDOW_GLASS.tint)) },
        uBody: { value: opts.body ?? WINDOW_GLASS.body },
        uRim: { value: opts.rim ?? 0 },
        uSheen: { value: opts.sheen ?? 0 },
        uShadow: { value: shadow },
        uSoft: { value: soft },
        uDrop: { value: drop },
        uFade: { value: 1 },
        uMap: { value: opts.map ?? null },
        uUseMap: { value: opts.map ? 1 : 0 },
        uHover: { value: 0 },
        uHoverP: { value: new Vector2() },
        uSpot: { value: Math.max(opts.w, opts.h) * 0.7 },
        uFill: { value: 0 },
        uFillTint: { value: new Vector3(1, 1, 1) },
      },
    });
    this.mesh = new Mesh(UNIT_QUAD, this.material);
    this.mesh.renderOrder = opts.order ?? LAYER.window;
    // The quad is larger than the shape (it carries the shadow), so it never
    // takes input: whatever is pressable adds an exact hit shape of its own.
    this.mesh.raycast = () => {};
    (this.mesh as unknown as { pointerEvents: string }).pointerEvents = 'none';
    this.setSize(opts.w, opts.h, opts.r);
  }

  setSize(w: number, h: number, r?: number) {
    const q = 2 * this.pad;
    this.mesh.scale.set(w + q, h + q, 1);
    this.material.uniforms.uQuad.value.set(w + q, h + q);
    this.material.uniforms.uHalf.value.set(w / 2, h / 2);
    this.material.uniforms.uR.value = r ?? Math.min(w, h) / 2;
  }

  setMap(map: Texture | null) {
    this.material.uniforms.uMap.value = map;
    this.material.uniforms.uUseMap.value = map ? 1 : 0;
  }

  /** Hover light in 0..1, centred on a point in local metres. */
  setHover(k: number, x = 0, y = 0) {
    this.material.uniforms.uHover.value = k;
    this.material.uniforms.uHoverP.value.set(x, y);
  }

  setFill(k: number, tint?: [number, number, number]) {
    this.material.uniforms.uFill.value = k;
    if (tint) this.material.uniforms.uFillTint.value.set(...tint);
  }

  setBody(alpha: number, tint?: [number, number, number]) {
    this.material.uniforms.uBody.value = alpha;
    if (tint) this.material.uniforms.uTint.value.set(...tint);
  }

  get fade(): number {
    return this.material.uniforms.uFade.value;
  }

  set fade(v: number) {
    this.material.uniforms.uFade.value = v;
  }
}

// --- Canvas content ----------------------------------------------------------

/** A canvas meant for a Surface: premultiplied, unconverted and mip-mapped. */
export function contentTexture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

export function setFont(g: CanvasRenderingContext2D, px: number, weight = 500, tracking = 0) {
  g.font = `${weight} ${px}px ${SANS}`;
  g.letterSpacing = `${tracking}px`;
  g.fontKerning = 'normal';
  g.textRendering = 'geometricPrecision';
}

const pathCache = new Map<IconKind, Path2D[]>();

/** Draws a line icon centred on (x, y), `size` pixels across. */
export function drawIcon(
  g: CanvasRenderingContext2D,
  kind: IconKind,
  x: number,
  y: number,
  size: number,
  color: string = INK.primary,
  weight = 1.9,
  fill = false,
) {
  let paths = pathCache.get(kind);
  if (!paths) {
    paths = ICON_PATHS[kind].map((d) => new Path2D(d));
    pathCache.set(kind, paths);
  }
  g.save();
  g.translate(x - size / 2, y - size / 2);
  g.scale(size / 24, size / 24);
  g.lineWidth = weight;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  for (const p of paths) {
    if (fill) g.fill(p);
    g.stroke(p);
  }
  g.restore();
}

/** A row of `total` stars with `earned` lit. */
export function drawStars(g: CanvasRenderingContext2D, x: number, y: number, size: number, earned: number, total = 3) {
  const step = size * 1.16;
  const x0 = x - ((total - 1) * step) / 2;
  for (let i = 0; i < total; i++) {
    if (i < earned) drawIcon(g, 'star', x0 + i * step, y, size, INK.gold, 1.6, true);
    else drawIcon(g, 'star', x0 + i * step, y, size, INK.tertiary, 1.6);
  }
}

/** A text plane with no glass: `h` metres tall, width follows the text. */
export class TextLabel {
  readonly surface: Surface;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private text = '';
  private style = '';

  constructor(
    private h: number,
    private px = 56,
    private weight = 500,
    private color: string = INK.primary,
    order = LAYER.text,
  ) {
    this.canvas.width = 8;
    this.canvas.height = Math.ceil(px * 1.5);
    this.tex = contentTexture(this.canvas);
    this.surface = new Surface({ w: h, h, r: 0, body: 0, map: this.tex, order });
    this.surface.mesh.name = 'Label';
  }

  get mesh(): Mesh {
    return this.surface.mesh;
  }

  /** Width in metres of the current text. */
  width = 0;

  set(text: string, color: string = this.color) {
    if (text === this.text && color === this.style) return;
    this.text = text;
    this.style = color;
    let g = this.canvas.getContext('2d')!;
    setFont(g, this.px, this.weight);
    const w = Math.max(8, Math.ceil(g.measureText(text).width) + 12);
    if (this.canvas.width !== w) {
      this.canvas.width = w;
      this.tex.dispose();
      g = this.canvas.getContext('2d')!;
    }
    g.clearRect(0, 0, w, this.canvas.height);
    setFont(g, this.px, this.weight);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, w / 2, this.canvas.height / 2 + this.px * 0.03);
    this.tex.needsUpdate = true;
    this.width = (w / this.canvas.height) * this.h;
    this.surface.setSize(this.width, this.h, 0);
  }
}

// --- Motion ------------------------------------------------------------------

/** A critically damped follower: settles without overshoot in about 4/rate s. */
export function follow(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** A spring with a little life in it, for presses and hovers. */
export class Spring {
  v = 0;

  constructor(
    public x = 0,
    private k = 260,
    private c = 26,
  ) {}

  to(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30);
    this.v += (-this.k * (this.x - target) - this.c * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

/** Fades every Surface under `root`. Other materials simply scale with it. */
export function fadeTree(root: Object3D, k: number) {
  root.traverse((o) => {
    const m = (o as Mesh).material as ShaderMaterial | undefined;
    if (m?.uniforms?.uFade) m.uniforms.uFade.value = k;
  });
}

/**
 * Keeps an interface element visible through anything real: for what floats by
 * the mat, where a monitor or a plant behind it would otherwise cut it off.
 */
export function floatOverRoom(root: Object3D) {
  root.traverse((o) => {
    const m = (o as Mesh).material as ShaderMaterial | undefined;
    if (m) m.depthTest = false;
  });
}

// --- Window ------------------------------------------------------------------

interface HitArea {
  holder: Group;
  entity: Entity;
  w: number;
  h: number;
  r: number;
}

export interface WindowOptions {
  name: string;
  w: number;
  h: number;
  /** Canvas width in pixels; 0 for a window without drawn content. */
  px?: number;
  r?: number;
  autoClose?: number;
  /** Parent entity; a floating window has none. */
  parent?: Entity;
  /** Draw the glass slab itself (off for a home-view grid of free controls). */
  glass?: boolean;
}

/** Anything a window should keep ticking. */
export interface Ticking {
  update(dt: number): void;
}

/**
 * A floating window. It opens where you are looking and stays there; it grows
 * in with a fade and no bounce, and a highlight glides between its hit areas.
 */
export class GlassWindow {
  readonly root = new Group();
  /** Scaled and faded on open; children go here. */
  readonly content = new Group();
  /** Parent for anything pressable on the window. */
  readonly entity: Entity;
  readonly surface: Surface;
  canvas: HTMLCanvasElement | null = null;
  g: CanvasRenderingContext2D | null = null;
  private tex: CanvasTexture | null = null;
  readonly w: number;
  readonly h: number;
  readonly px: number;
  readonly py: number;

  private want = false;
  /** 0 closed .. 1 open. */
  reveal = 0;
  private shown = -1;
  idle = 0;
  private autoClose: number;
  private ticking: Ticking[] = [];
  private head = new Vector3();
  private fwd = new Vector3();

  private hits: HitArea[] = [];
  private glide: Surface;
  private glideOn = 0;
  private glideX = 0;
  private glideY = 0;
  private glideW = 0.1;
  private glideH = 0.1;
  private hovered: HitArea | null = null;
  private glideR = 0.01;
  private lastPress = -1e9;

  constructor(
    private world: World,
    opts: WindowOptions,
  ) {
    this.w = opts.w;
    this.h = opts.h;
    this.px = opts.px ?? 0;
    this.py = Math.round((this.px * opts.h) / opts.w);
    this.autoClose = opts.autoClose ?? 30;
    this.root.name = opts.name;
    this.root.add(this.content);
    const r = opts.r ?? 0.03;
    if (this.px) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.px;
      this.canvas.height = this.py;
      this.g = this.canvas.getContext('2d')!;
      this.tex = contentTexture(this.canvas);
    }
    const glass = opts.glass !== false;
    this.surface = new Surface({
      w: opts.w,
      h: opts.h,
      r,
      ...WINDOW_GLASS,
      body: glass ? WINDOW_GLASS.body : 0,
      rim: glass ? 1 : 0,
      sheen: glass ? 1 : 0,
      shadow: glass ? 0.42 : 0,
      soft: 0.05,
      drop: 0.016,
      map: this.tex,
      order: LAYER.window,
    });
    this.surface.mesh.name = `${opts.name}_Glass`;
    this.content.add(this.surface.mesh);

    this.glide = new Surface({ w: 0.1, h: 0.1, r: 0.01, tint: [1, 1, 1], body: 0, order: LAYER.section });
    this.glide.mesh.visible = false;
    this.glide.mesh.position.z = 0.0008;
    this.content.add(this.glide.mesh);

    const rootEntity = world.createTransformEntity(this.root, opts.parent);
    this.entity = world.createTransformEntity(this.content, rootEntity);
    this.root.visible = false;
    this.root.position.set(0, -50, 0);
  }

  get isOpen(): boolean {
    return this.want;
  }

  /** How far open, for gating presses on a window still growing in. */
  get ready(): boolean {
    return this.want && this.reveal > 0.85;
  }

  /** Opens in front of the player, a little below the eye line, where it stays. */
  open(distance = 0.5, drop = 0.1) {
    const camera = this.world.camera;
    camera.getWorldPosition(this.head);
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.root.position.copy(this.head).addScaledVector(this.fwd, distance);
    this.root.position.y -= drop;
    this.root.lookAt(this.head);
    this.show();
  }

  /** Reveals it wherever `root` has been placed. */
  show() {
    this.root.visible = true;
    this.want = true;
    this.idle = 0;
  }

  close() {
    this.want = false;
  }

  /** Called on any interaction, to hold off the auto-close. */
  touch() {
    this.idle = 0;
  }

  /** Canvas pixels to window-local metres. */
  toLocal(px: number, py: number): [number, number] {
    return [(px / this.px - 0.5) * this.w, (0.5 - py / this.py) * this.h];
  }

  /** Clears the content canvas for a redraw; call `commit` afterwards. */
  clear(): CanvasRenderingContext2D {
    const g = this.g!;
    g.clearRect(0, 0, this.px, this.py);
    return g;
  }

  commit() {
    if (this.tex) this.tex.needsUpdate = true;
  }

  /** Attaches a control so it can be poked and pointed at, and keeps it ticking. */
  addControl(obj: Object3D, tick?: Ticking): Entity {
    const e = this.world.createTransformEntity(obj, this.entity);
    e.addComponent(RayInteractable);
    e.addComponent(PokeInteractable);
    if (tick) this.ticking.push(tick);
    return e;
  }

  addTick(tick: Ticking) {
    this.ticking.push(tick);
  }

  /** Removes every hit area (they go when a page changes). */
  clearHits() {
    // Dispose the entities too: a merely detached one is put back in the scene
    // by its transform and would keep catching rays and pokes.
    for (const h of this.hits) {
      h.holder.parent?.remove(h.holder);
      h.entity.dispose();
    }
    this.hits = [];
    this.hovered = null;
  }

  /** A pressable rectangle given in canvas pixels, with the gliding highlight. */
  addHit(x: number, y: number, w: number, h: number, r: number, run: () => void, name = 'Hit') {
    const [cx, cy] = this.toLocal(x + w / 2, y + h / 2);
    const scale = this.w / this.px;
    this.addHitMetres(cx, cy, w * scale, h * scale, r * scale, run, name);
  }

  addHitMetres(cx: number, cy: number, w: number, h: number, r: number, run: () => void, name = 'Hit') {
    const holder = new Group();
    holder.name = name;
    holder.position.set(cx, cy, 0.002);
    holder.add(hitPlane(w, h));
    const entity = this.world.createTransformEntity(holder, this.entity);
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    const hit: HitArea = { holder, entity, w, h, r };
    const t = holder as unknown as { addEventListener(type: string, fn: () => void): void };
    t.addEventListener('pointerdown', () => {
      // One press per touch, even when a fingertip passes in and out.
      const now = performance.now();
      if (!this.ready || now - this.lastPress < 450) return;
      this.lastPress = now;
      this.idle = 0;
      run();
    });
    t.addEventListener('pointerenter', () => {
      if (!this.hovered && this.glideOn < 0.02) {
        this.glideX = cx;
        this.glideY = cy;
        this.glideW = w;
        this.glideH = h;
      }
      this.glideR = r;
      this.hovered = hit;
      this.idle = 0;
    });
    t.addEventListener('pointerleave', () => {
      if (this.hovered === hit) this.hovered = null;
    });
    this.hits.push(hit);
  }

  update(dt: number) {
    const target = this.want ? 1 : 0;
    // Open over about half a second with no bounce; close faster.
    this.reveal = follow(this.reveal, target, this.want ? 9 : 16, dt);
    if (Math.abs(this.reveal - target) < 0.002) this.reveal = target;
    if (this.reveal !== this.shown) {
      this.shown = this.reveal;
      const s = 0.94 + 0.06 * this.reveal;
      this.content.scale.setScalar(s);
      this.content.position.z = -0.012 * (1 - this.reveal);
      fadeTree(this.content, this.reveal * this.reveal);
    }
    if (this.want) {
      this.idle += dt;
      if (this.idle > this.autoClose) this.close();
    } else if (this.reveal === 0 && this.root.visible) {
      // Park it far away so a hidden window never catches rays.
      this.root.visible = false;
      this.root.position.set(0, -50, 0);
    }
    if (!this.root.visible) return;
    for (const t of this.ticking) t.update(dt);

    this.glideOn = follow(this.glideOn, this.hovered ? 1 : 0, this.hovered ? 30 : 8, dt);
    if (this.hovered) {
      const p = this.hovered.holder.position;
      this.glideX = follow(this.glideX, p.x, 26, dt);
      this.glideY = follow(this.glideY, p.y, 26, dt);
      this.glideW = follow(this.glideW, this.hovered.w, 26, dt);
      this.glideH = follow(this.glideH, this.hovered.h, 26, dt);
    }
    const on = this.glideOn > 0.01;
    this.glide.mesh.visible = on;
    if (on) {
      this.glide.mesh.position.x = this.glideX;
      this.glide.mesh.position.y = this.glideY;
      this.glide.setSize(this.glideW, this.glideH, this.glideR);
      this.glide.setBody(0.12 * this.glideOn);
    }
  }
}

/** An on/off switch: a track that warms up and a knob that travels. */
export class Toggle implements Ticking {
  readonly root = new Group();
  private track: Surface;
  private knob: Surface;
  private x: Spring;
  private tint = 0;
  private trackW: number;

  constructor(
    public on: boolean,
    private h = 0.0175,
  ) {
    this.trackW = h * 1.65;
    this.track = new Surface({ w: this.trackW, h, tint: [1, 1, 1], body: 0.2, order: LAYER.control });
    const k = h - 0.0028;
    this.knob = new Surface({ w: k, h: k, tint: [1, 1, 1], body: 1, shadow: 0.3, soft: 0.004, drop: 0.001, order: LAYER.text });
    this.knob.mesh.position.z = 0.0005;
    this.root.add(this.track.mesh, this.knob.mesh);
    this.x = new Spring(on ? 1 : 0, 320, 30);
    this.tint = on ? 1 : 0;
    this.apply();
  }

  private apply() {
    const span = (this.trackW - this.h) / 2;
    this.knob.mesh.position.x = (this.x.x * 2 - 1) * span;
    const k = this.tint;
    this.track.setBody(0.2 + 0.8 * k, [1 - 0.81 * k, 1 - 0.18 * k, 1 - 0.65 * k]);
  }

  update(dt: number) {
    this.x.to(this.on ? 1 : 0, dt);
    this.tint = follow(this.tint, this.on ? 1 : 0, 14, dt);
    this.apply();
  }
}

/** Waits for the interface font, so canvases never draw in a fallback. */
export function fontsReady(): Promise<unknown> {
  const fonts = document.fonts;
  return Promise.race([
    Promise.all([fonts.load(`500 40px "Inter Variable"`), fonts.load(`700 40px "Inter Variable"`)]),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
}
