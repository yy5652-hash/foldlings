/** View angles and panel fitting, independent of the renderer. */
export interface ViewAngles {
  left: number;
  right: number;
  up: number;
  down: number;
}

const RAD = Math.PI / 180;

export function projectionAngles(m: ArrayLike<number>): ViewAngles {
  return {
    left: Math.atan((1 - m[8]) / m[0]) / RAD,
    right: Math.atan((1 + m[8]) / m[0]) / RAD,
    up: Math.atan((1 + m[9]) / m[5]) / RAD,
    down: Math.atan((1 - m[9]) / m[5]) / RAD,
  };
}

export function classifyView(view: ViewAngles): 'wide' | 'narrow' {
  return Math.min(view.left, view.right) < 45 || view.up < 30 ? 'narrow' : 'wide';
}

/** A face-on panel at radial distance; positive pitch lowers its centre. */
export function fitPanel(width: number, height: number, distance: number, view: ViewAngles): { scale: number; pitch: number } {
  const up = view.up * 0.9 * RAD;
  const down = view.down * 0.9 * RAD;
  const horizontal = Math.min(view.left, view.right) * 0.9 * RAD;
  const preferred = classifyView(view) === 'narrow' ? 5 * RAD : 0;
  const pitchFor = (vertical: number) => Math.max(0, vertical - up, Math.min(preferred, down - vertical));
  const fits = (scale: number) => {
    const vertical = Math.atan(height * scale / (2 * distance));
    const pitch = pitchFor(vertical);
    const near = distance * Math.cos(pitch) - height * scale / 2 * Math.sin(pitch);
    return pitch + vertical <= down && near > 0 && Math.atan(width * scale / (2 * near)) <= horizontal;
  };
  let lo = 0;
  let hi = 1;
  if (fits(1)) lo = 1;
  else for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { scale: lo, pitch: pitchFor(Math.atan(height * lo / (2 * distance))) / RAD };
}
