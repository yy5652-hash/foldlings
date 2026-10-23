// Dev-only: measure frame rate and renderer info in the running app frame.
export default async function ({ frame, page }) {
  const vp = page.viewportSize();
  const r = await frame.evaluate(async () => {
    let n = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        n++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      fps: (n / (performance.now() - t0)) * 1000,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
      dpr: devicePixelRatio,
      size: [innerWidth, innerHeight],
    };
  });
  return { ...r, viewport: vp };
}
