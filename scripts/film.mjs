// Dev-only take recorder for the demo film (run with `iwsdk browser run`).
//
//   FILM_SHOT=film/shots/01.json FILM_OUT=film/raw/01 npx @iwsdk/cli browser run scripts/film.mjs --timeout 170000
//
// Makes the managed page 1920x1080, restarts the emulated XR session at that
// size, hides the emulator overlay, then plays the shot list while recording
// the CDP screencast. Steps:
//   { "eval": "js expression" }                 run in the app frame
//   { "remote": "method", "params": {...} }     IWER remote control (run_sequence, animate_to, ...)
//   { "wait": 1.5 }                             seconds
//   { "mark": "label" }                         timestamp for the edit
// Frames are written as <ms>.jpg; marks.json lists step times in ms.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ page, frame, cdp, signal }) {
  const shot = JSON.parse(readFileSync(process.env.FILM_SHOT, 'utf8'));
  const dir = process.env.FILM_OUT ?? 'film/raw/take';
  const width = shot.width ?? 1920;
  const height = shot.height ?? 1080;
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    const f = document.getElementById('workspace-runtime-frame');
    if (f) Object.assign(f.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', zIndex: '99999', border: '0' });
  });
  await frame.waitForFunction(() => !!window.__foldlings?.world, null, { timeout: 20000 });
  // {"$board": [u, v, h]} anywhere in params becomes that mat point in world space.
  const resolve = async (v) => {
    if (Array.isArray(v)) return Promise.all(v.map(resolve));
    if (v && typeof v === 'object') {
      if (Array.isArray(v.$board)) {
        const [x, y, z] = await frame.evaluate((b) => window.__foldlings.boardWorld(...b), v.$board);
        return { x, y, z };
      }
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = await resolve(val);
      return out;
    }
    return v;
  };
  const remote = async (method, params = {}) => {
    const p = await resolve(params);
    return frame.evaluate(([m, q]) => window.IWER_DEVICE.remote.dispatch(m, q), [method, p]);
  };

  // Fresh session at the new size.
  await frame.evaluate(async (setup) => {
    const w = window.__foldlings?.world;
    if (w?.session) w.exitXR();
    await new Promise((r) => setTimeout(r, 700));
    if (setup) new Function(setup)();
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 300));
  }, shot.before ?? '');
  for (const s of shot.pre ?? []) {
    if (s.remote) await remote(s.remote, s.params ?? {});
    if (s.eval) await frame.evaluate((src) => new Function(`return (${src});`)(), s.eval);
  }
  await frame.evaluate((mode) => window.__foldlings.world.launchXR(mode === 'vr' ? { sessionMode: 'immersive-vr' } : undefined), shot.mode ?? 'ar');
  for (let i = 0; i < 30; i++) {
    const live = await frame.evaluate(() => !!window.__foldlings.world.session);
    if (live) break;
    try {
      await remote('accept_session');
    } catch {
      /* not offered yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 500));
  await remote('set_input_mode', { mode: shot.input ?? 'hand' });
  for (const s of shot.setup ?? []) {
    if (s.remote) await remote(s.remote, s.params ?? {});
    if (s.eval) await frame.evaluate((src) => new Function(`return (${src});`)(), s.eval);
    if (s.wait) await new Promise((r) => setTimeout(r, s.wait * 1000));
  }
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
  const t0 = Date.now();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  const marks = [];
  const results = [];
  // {"fold": {...}} pinches and folds the next solution step with one hand.
  const fold = async (opt) => {
    const pts = await frame.evaluate(() => window.__foldlings.game.nextFoldPoints());
    if (!pts) return null;
    const { grab, dest } = pts;
    const mid = { x: (grab.x + dest.x) / 2, y: (grab.y + dest.y) / 2 };
    const sp = opt.speed ?? 1;
    return remote('run_sequence', {
      device: opt.hand ?? 'hand-right',
      gaze: 'fixed',
      steps: [
        { label: 'reach', position: { $board: [grab.x, grab.y, 0.004] }, anchor: 'grasp', pinch: { value: 1, at: 'arrival' }, duration: 1.0 / sp },
        { label: 'lift', position: { $board: [mid.x + (grab.x - mid.x) * 0.3, mid.y + (grab.y - mid.y) * 0.3, 0.085] }, anchor: 'grasp', duration: 0.6 / sp },
        { label: 'over', position: { $board: [dest.x, dest.y, 0.012] }, anchor: 'grasp', duration: 0.6 / sp },
        { label: 'release', pinch: 0, duration: 0.18 },
        { label: 'back', position: { $board: opt.rest ?? [0.16, -0.22, 0.16] }, anchor: 'grasp', duration: 0.6 / sp },
      ],
    });
  };
  for (const s of shot.steps) {
    if (signal?.aborted) break;
    const at = Date.now() - t0;
    if (s.mark) marks.push({ label: s.mark, ms: at });
    if (s.fold) results.push({ fold: !!(await fold(s.fold)) });
    if (s.eval) results.push(await frame.evaluate((src) => new Function(`return (${src});`)(), s.eval));
    if (s.remote) {
      const r = await remote(s.remote, s.params ?? {});
      results.push(s.remote === 'run_sequence' ? { ok: !!r, warnings: r?.warnings } : null);
    }
    if (s.wait) await new Promise((r) => setTimeout(r, s.wait * 1000));
  }
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(dir, 'marks.json'), JSON.stringify({ marks, ms: Date.now() - t0 }, null, 1));
  return { frames: count, seconds: (Date.now() - t0) / 1000, marks: marks.length, results: results.filter(Boolean).slice(0, 8) };
}
