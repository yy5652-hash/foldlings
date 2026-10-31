/**
 * Dims the real room for a moment, the way a film theatre lowers its lights.
 * The sphere draws first and writes only alpha: passthrough shows through less
 * while everything virtual is drawn over it untouched.
 */

import { BackSide, Mesh, Object3D, ShaderMaterial, SphereGeometry } from '@iwsdk/core';
import { follow } from './glass.js';

export class Dimmer {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private k = 0;

  constructor() {
    const material = new ShaderMaterial({
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uDim; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uDim); }',
      uniforms: { uDim: { value: 0 } },
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(new SphereGeometry(8, 16, 12), material);
    this.mesh.name = 'RoomDimmer';
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
  }

  /** Eases towards `target` (0 clear .. 1 fully dark). */
  update(dt: number, target: number, camera: Object3D) {
    this.k = follow(this.k, target, target > this.k ? 3 : 2.2, dt);
    if (this.k < 0.004 && target === 0) this.k = 0;
    this.mesh.visible = this.k > 0;
    if (this.mesh.visible) {
      camera.getWorldPosition(this.mesh.position);
      this.mesh.material.uniforms.uDim.value = this.k;
    }
  }
}
