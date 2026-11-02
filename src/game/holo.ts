/**
 * The look of everything that is projected: light you can see through, the way
 * a surgeon's scan hangs in the air. Bodies show their far side through the near
 * one, contour lines ring them like the slices of a scan, and their edges burn
 * brighter than their faces. Holograms are drawn as added light, so they read
 * as glowing over a dimmed passthrough room; only a little alpha is written,
 * which keeps the room from washing them out.
 *
 * Colours here are display values, composited directly: nothing is tone mapped.
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  LineBasicMaterial,
  ShaderMaterial,
  Texture,
  Vector3,
} from '@iwsdk/core';

/** Shared clock for every hologram, so scan lines stay in step. */
export const HOLO_TIME = { value: 0 };

/** Fingertips in the world; a hologram lights up where a hand comes near it. */
export const HOLO_FINGERS = { value: [new Vector3(0, -99, 0), new Vector3(0, -99, 0)] };

export function tickHolo(dt: number) {
  HOLO_TIME.value = (HOLO_TIME.value + dt) % 3600;
}

const BODY_VERT = /* glsl */ `
uniform float uExplode;
uniform float uThick;
attribute float aLayer;
varying vec3 vW;
varying vec3 vN;
varying vec3 vC;
varying float vLayer;
varying float vNear;
void main() {
  // Every facet moves out along its own normal: an exploded view of the model.
  float r = fract(sin(dot(normal, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  // Several copies through the thickness turn a flat facet into a slab of light.
  vLayer = aLayer;
  vec3 p = position + normal * (uExplode * (0.4 + r) + aLayer * uThick);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vC = pow(color, vec3(0.4545));
  // How near the viewer this point is, within the body: drives depth grading.
  float z0 = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
  float z = (viewMatrix * w).z;
  vNear = clamp(0.5 + (z - z0) / 0.34, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BODY_FRAG = /* glsl */ `
uniform float uTime;
uniform float uScanY;
uniform float uReveal;
uniform float uGlow;
uniform float uDensity;
uniform vec3 uTint;
uniform float uTintK;
uniform vec3 uFingers[2];
varying vec3 vW;
varying vec3 vN;
varying vec3 vC;
varying float vLayer;
varying float vNear;
void main() {
  if (vW.y > uReveal) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(N, V)), 2.2);
  // Contour rings, as if the body were built from slices of a scan.
  float y = vW.y * uDensity;
  float line = 1.0 - smoothstep(0.0, max(fwidth(y) * 1.4, 0.07), abs(fract(y) - 0.5));
  // A slow band of light climbing the body.
  float climb = pow(fract(vW.y * 3.0 - uTime * 0.22), 28.0);
  // Where the slice plane cuts through, and the edge of a body still forming.
  float cut = exp(-pow((vW.y - uScanY) * 200.0, 2.0));
  float forming = uReveal < 90.0 ? exp(-pow((vW.y - uReveal) * 90.0, 2.0)) : 0.0;
  float flicker = 0.965 + 0.035 * sin(uTime * 41.0 + vW.y * 50.0);
  float body = 0.09 + 0.8 * rim + 0.24 * line + 0.5 * climb;
  // Middle layers burn brightest, the outermost fade like a soft edge.
  body *= 1.0 - 0.72 * abs(vLayer);
  vec3 col = mix(vC, uTint, uTintK) * body * flicker * uGlow;
  // Far parts fade and go blue, as depth does through any haze of light.
  col = mix(col * vec3(0.32, 0.5, 0.82), col, vNear);
  col += vec3(0.78, 0.96, 1.0) * (rim * rim * 0.45 * uGlow + cut * 0.3 + forming * 1.7);
  // A hand coming near lights the body around it.
  vec3 f0 = uFingers[0] - vW;
  vec3 f1 = uFingers[1] - vW;
  col += vec3(0.45, 0.85, 1.0) * (exp(-dot(f0, f0) / 0.009) + exp(-dot(f1, f1) / 0.009)) * 0.75;
  gl_FragColor = vec4(col, min(0.4, 0.12 + 0.3 * rim));
}`;

/** A projected body: per-vertex colour, see-through, one material per creature. */
export function holoBody(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      uTime: HOLO_TIME,
      uExplode: { value: 0 },
      uThick: { value: 0.0016 },
      uScanY: { value: -99 },
      uReveal: { value: 99 },
      uGlow: { value: 1 },
      uDensity: { value: 165 },
      uTint: { value: new Color(1, 0.62, 0.28) },
      uTintK: { value: 0 },
      uFingers: HOLO_FINGERS,
    },
  });
}

/**
 * The body's inner layer: the same facets drawn inside the skin in a second false
 * colour, so a shown creature reads as nested structure rather than a shell.
 */
export function holoCore(): ShaderMaterial {
  const m = holoBody();
  m.uniforms.uExplode.value = -0.006;
  m.uniforms.uTintK.value = 1;
  m.uniforms.uGlow.value = 0.8;
  m.uniforms.uDensity.value = 230;
  return m;
}

const SHEET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHEET_FRAG = /* glsl */ `
uniform sampler2D frontMap;
uniform sampler2D backMap;
uniform float flipped;
uniform float glow;
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
void main() {
  bool showFront = gl_FrontFacing != (flipped > 0.5);
  vec3 base = pow((showFront ? texture2D(frontMap, vUv) : texture2D(backMap, vUv)).rgb, vec3(0.4545));
  vec2 g = abs(fract(vUv * 16.0) - 0.5);
  float gw = max(fwidth(vUv.x * 16.0), 0.02);
  float grid = 1.0 - smoothstep(0.0, gw * 1.2, min(g.x, g.y));
  // A slow diagonal sweep over the sheet.
  float sweep = pow(fract((vW.x + vW.z) * 2.2 - uTime * 0.2), 24.0);
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  vec3 col = base * (0.46 + 0.28 * grid + 0.6 * sweep + 0.8 * rim);
  col += glow * vec3(0.35, 0.42, 0.3);
  // Mostly solid to the layers below, so the top side of a fold can be read.
  gl_FragColor = vec4(col * 0.86, 0.8);
}`;

/** The folding sheet: a film of light, with the top layer reading over the rest. */
export function holoSheet(front: Texture, back: Texture, flipped: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: SHEET_VERT,
    fragmentShader: SHEET_FRAG,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    side: DoubleSide,
    toneMapped: false,
    uniforms: {
      frontMap: { value: front },
      backMap: { value: back },
      flipped: { value: flipped ? 1 : 0 },
      glow: { value: 0 },
      uTime: HOLO_TIME,
    },
  });
}

const PANE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec2 g = abs(fract(vUv * 12.0) - 0.5);
  float w = max(fwidth(vUv.x * 12.0), 0.02);
  float grid = 1.0 - smoothstep(0.0, w * 1.2, min(g.x, g.y));
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = 1.0 - smoothstep(0.0, max(fwidth(vUv.x) * 2.5, 0.012), min(e.x, e.y));
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
  vec3 col = uColor * (0.28 + 0.4 * grid + 0.7 * rim) + vec3(0.8, 0.96, 1.0) * edge;
  gl_FragColor = vec4(col, 0.3);
}`;

/** A plain sheet of light in one colour, gridded, with a burning edge. */
export function holoPane(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: SHEET_VERT,
    fragmentShader: PANE_FRAG,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    side: DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: color }, uTime: HOLO_TIME },
  });
}

const CLOUD_VERT = /* glsl */ `
uniform float uTime;
uniform float uExplode;
uniform float uSize;
attribute vec3 aDrift;
varying vec3 vC;
varying float vA;
void main() {
  // Each point hangs near the surface and breathes around its place.
  float ph = aDrift.x * 6.283;
  vec3 p = position + normal * (uExplode * (0.4 + aDrift.y) + (aDrift.y - 0.5) * 0.002 + sin(uTime * 0.8 + ph) * 0.0004);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vC = pow(color, vec3(0.4545));
  vA = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(uTime * (0.7 + aDrift.z * 1.8) + ph), 3.0);
  gl_PointSize = clamp(uSize * (0.6 + aDrift.z) / -mv.z, 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
}`;

const CLOUD_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - d * d) * vA;
  if (a <= 0.01) discard;
  gl_FragColor = vec4(mix(vC, vec3(1.0), 0.45) * a * 0.75, 0.0);
}`;

/** The cloud of points sampled through a body: motes held in its shape. */
export function holoCloud(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    toneMapped: false,
    uniforms: { uTime: HOLO_TIME, uExplode: { value: 0 }, uSize: { value: 3.4 } },
  });
}

const WALL_VERT = /* glsl */ `
attribute float aH;
varying float vH;
void main() {
  vH = aH;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const WALL_FRAG = /* glsl */ `
uniform float uTime;
varying float vH;
void main() {
  float fall = pow(1.0 - vH, 1.7);
  float band = 0.75 + 0.25 * sin(vH * 30.0 - uTime * 1.4);
  gl_FragColor = vec4(vec3(0.3, 0.8, 1.0) * fall * band * 0.5, 0.0);
}`;

/** Light rising off the edges of a sheet, so that it reads as a slab with depth. */
export function holoWall(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    side: DoubleSide,
    toneMapped: false,
    uniforms: { uTime: HOLO_TIME },
  });
}

/** A thin line of added light. */
export function holoLine(color: number, opacity = 1): LineBasicMaterial {
  return new LineBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}
