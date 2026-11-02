import type { World } from '@iwsdk/core';
import { classifyView, projectionAngles, type ViewAngles } from './fov.js';

export class ViewFov {
  angles: ViewAngles | null = null;
  mode: 'wide' | 'narrow' = 'wide';
  projection: Float32Array | null = null;
  private sampled = false;

  /** Dev only: the emulator masks its view but reports a wide projection. */
  force(angles: ViewAngles) {
    this.sampled = true;
    this.angles = angles;
    this.mode = classifyView(angles);
  }

  constructor(world: World) {
    world.renderer.xr.addEventListener('sessionend', () => {
      this.sampled = false;
      this.angles = null;
      this.projection = null;
      this.mode = 'wide';
    });
    world.onXRFrame((frame) => {
      if (this.sampled) return;
      const ref = world.renderer.xr.getReferenceSpace();
      const pose = ref && frame.getViewerPose(ref);
      if (!pose?.views.length) return;
      this.projection = new Float32Array(pose.views[0].projectionMatrix);
      // Use the intersection so shared panels fit in either eye.
      for (const view of pose.views) {
        const angles = projectionAngles(view.projectionMatrix);
        if (!this.angles) this.angles = angles;
        else {
          this.angles.left = Math.min(this.angles.left, angles.left);
          this.angles.right = Math.min(this.angles.right, angles.right);
          this.angles.up = Math.min(this.angles.up, angles.up);
          this.angles.down = Math.min(this.angles.down, angles.down);
        }
      }
      this.mode = classifyView(this.angles!);
      this.sampled = true;
    });
  }
}

const views = new WeakMap<World, ViewFov>();

export function viewFov(world: World): ViewFov {
  let view = views.get(world);
  if (!view) {
    view = new ViewFov(world);
    views.set(world, view);
  }
  return view;
}
