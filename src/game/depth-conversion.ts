/** Move non-linear depth away from the viewer by a distance in metres. */
export function biasedDepth(raw: number, near: number, far: number, bias = 0.03): number {
  if (raw >= 1) return 1;
  const eye = far === Infinity ? near / (1 - raw) : near * far / (far - raw * (far - near));
  const shifted = eye + bias;
  return Math.min(1, far === Infinity ? 1 - near / shifted : far * (shifted - near) / (shifted * (far - near)));
}
