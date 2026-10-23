// Dev-only film recorder (iwsdk browser run). Makes the page REC_W x REC_H,
// ends any XR session, waits for a new one (start it with `iwsdk xr enter`),
// hides the emulator overlay and records REC_SECONDS of CDP screencast frames
// into REC_DIR as <milliseconds>.jpg.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ page, cdp, signal }) {
  const dir = process.env.REC_DIR ?? 'film/raw';
  const seconds = Number(process.env.REC_SECONDS ?? 5);
  const width = Number(process.env.REC_W ?? 1920);
  const height = Number(process.env.REC_H ?? 1080);
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    const f = document.getElementById('workspace-runtime-frame');
    if (f) Object.assign(f.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', zIndex: '99999', border: '0' });
  });
  const frame = page.frames().find((f) => f.url().startsWith('https://localhost'));
  await frame.evaluate(async () => {
    const w = window.__foldlings?.world;
    if (w?.session) w.exitXR();
    await new Promise((r) => setTimeout(r, 600));
    window.dispatchEvent(new Event('resize'));
  });
  writeFileSync(join(dir, 'READY'), '1');
  // Wait for the CLI to start a fresh session at the new size.
  const ok = await frame.evaluate(async () => {
    for (let i = 0; i < 200; i++) {
      if (window.__foldlings?.world?.session) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
  if (!ok) return { error: 'no session' };
  await new Promise((r) => setTimeout(r, Number(process.env.REC_SETTLE ?? 1500)));
  await frame.evaluate(() => {
    const host = document.body.children[document.body.children.length - 1];
    for (const c of host?.children ?? []) if (c.tagName === 'DIV' && c.shadowRoot) c.style.visibility = 'hidden';
  });
  let count = 0;
  let first = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const t = f.metadata.timestamp;
    if (!first) first = t;
    writeFileSync(join(dir, `${String(Math.round((t - first) * 1000)).padStart(7, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    count++;
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  writeFileSync(join(dir, 'RECORDING'), '1');
  await new Promise((res) => {
    const t = setTimeout(res, seconds * 1000);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      res();
    });
  });
  await cdp.send('Page.stopScreencast');
  const canvas = await frame.evaluate(() => window.__foldlings?.world?.renderer.domElement.width);
  return { frames: count, fps: count / seconds, canvas };
}
