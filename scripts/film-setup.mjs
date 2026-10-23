// Dev-only: make the managed page 1920x1080 with the app frame filling it.
export default async function ({ page }) {
  const width = Number(process.env.REC_W ?? 1920);
  const height = Number(process.env.REC_H ?? 1080);
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    const f = document.getElementById('workspace-runtime-frame');
    if (f) {
      Object.assign(f.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '99999',
        border: '0',
      });
    }
  });
  // Restart the emulated session so the headset view picks up the new size.
  const frame = page.frames().find((f) => f.url().startsWith('https://localhost'));
  const sizes = await frame?.evaluate(async () => {
    const w = window.__foldlings?.world;
    if (w?.session) {
      w.exitXR();
      await new Promise((r) => setTimeout(r, 800));
    }
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 300));
    w?.launchXR();
    await new Promise((r) => setTimeout(r, 1500));
    return { inner: [innerWidth, innerHeight], canvas: w?.renderer.domElement.width, session: !!w?.session };
  });
  return { width, height, sizes };
}
