/** Bias Three r185's depth pre-pass without patching the hologram shaders. */
import { ShaderMaterial, Vector2, type Mesh, type World } from '@iwsdk/core';

const BIAS = 0.03;
const fragmentShader = `
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;
uniform vec2 depthNear;
uniform vec2 depthFar;
uniform float bias;

void main() {
  vec2 coord = gl_FragCoord.xy / vec2(depthWidth, depthHeight);
  int eye;
  #ifdef VIEW_ID
    eye = int(VIEW_ID);
  #else
    eye = coord.x >= 1.0 ? 1 : 0;
    coord.x -= float(eye);
  #endif
  float raw = texture(depthColor, vec3(coord, float(eye))).r;
  // A pixel with no reading must never hide the projection.
  if (raw <= 0.0 || raw >= 1.0) {
    gl_FragDepth = 1.0;
    return;
  }
  float n = depthNear[eye];
  float f = depthFar[eye];
  // Zero represents an infinite far plane, avoiding infinite GPU uniforms.
  float metres = f == 0.0 ? n / (1.0 - raw) : n * f / (f - raw * (f - n));
  metres += bias;
  gl_FragDepth = min(1.0, f == 0.0 ? 1.0 - n / metres : f * (metres - n) / (metres * (f - n)));
}`;

export function installRealDepth(world: World) {
  const xr = world.renderer.xr;
  const original = xr.getDepthSensingMesh.bind(xr);
  const near = new Vector2();
  const far = new Vector2();
  let patched: Mesh | null = null;
  let enabled = true;
  const pass = () => {
    const mesh = enabled ? original() : null;
    if (!mesh) return null;
    if (mesh !== patched) {
      const stock = mesh.material as ShaderMaterial;
      mesh.material = new ShaderMaterial({
        vertexShader: stock.vertexShader,
        fragmentShader,
        colorWrite: false,
        uniforms: {
          ...stock.uniforms,
          depthNear: { value: near },
          depthFar: { value: far },
          bias: { value: BIAS },
        },
      });
      stock.dispose();
      // Vertices are already in clip space, so bounds say nothing about visibility.
      mesh.frustumCulled = false;
      patched = mesh;
    }
    // updateCamera has adopted the depth data's clipping planes before this pass.
    const camera = xr.getCamera();
    const left = camera.cameras[0] ?? camera;
    const right = camera.cameras[1] ?? left;
    near.set(left.near, right.near);
    far.set(left.far === Infinity ? 0 : left.far, right.far === Infinity ? 0 : right.far);
    const viewport = camera.cameras[0]?.viewport;
    if (viewport) {
      const uniforms = (mesh.material as ShaderMaterial).uniforms;
      uniforms.depthWidth.value = viewport.z;
      uniforms.depthHeight.value = viewport.w;
    }
    return mesh;
  };
  // IWSDK assigns a null stub at every session start, because its own occlusion
  // patches stock material chunks. Ours are custom shaders, so the pass must stay.
  Object.defineProperty(xr, 'getDepthSensingMesh', { configurable: true, get: () => pass, set: () => {} });
  // The headset hands out a new native texture as the depth map updates.
  world.onXRFrame((frame) => {
    const texture = xr.getDepthTexture();
    const ref = xr.getReferenceSpace();
    if (!texture || !ref) return;
    const view = frame.getViewerPose(ref)?.views[0];
    const info = view ? xr.getBinding()?.getDepthInformation(view) : null;
    if (info?.texture) texture.sourceTexture = info.texture;
  });
  world.renderer.xr.addEventListener('sessionend', () => {
    if (patched) (patched.material as ShaderMaterial).dispose();
    patched = null;
  });
  return {
    setEnabled(on: boolean) {
      enabled = on;
    },
    status() {
      const session = xr.getSession();
      const granted = session?.enabledFeatures?.includes('depth-sensing') ?? false;
      return {
        granted,
        usage: granted ? session!.depthUsage ?? null : null,
        bias: BIAS,
        active: !!pass(),
      };
    },
  };
}
