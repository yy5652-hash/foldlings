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
      if (typeof v.$object === 'string') {
        const p = await frame.evaluate((n) => window.__foldlings.world.scene.getObjectByName(n)?.getWorldPosition(new (window.__foldlings.world.camera.position.constructor)()).toArray(), v.$object);
        if (!p) throw new Error(`no object ${v.$object}`);
        return { x: p[0] + (v.dx ?? 0), y: p[1] + (v.dy ?? 0), z: p[2] + (v.dz ?? 0) };
      }
      if (typeof v.$head === 'object') {
        const h = await frame.evaluate(() => window.__foldlings.world.camera.getWorldPosition(new (window.__foldlings.world.camera.position.constructor)()).toArray());
        return { x: h[0] + v.$head[0], y: h[1] + v.$head[1], z: h[2] + v.$head[2] };
      }
      if (typeof v.$creature === 'string') {
        // "@" means the kind chosen by an earlier eval (window.__filmKind).
        const kind = v.$creature === '@' ? await frame.evaluate(() => window.__filmKind) : v.$creature;
        const p = await frame.evaluate((k) => window.__foldlings.zoo.positions().find((c) => c.kind === k)?.p, kind);
        if (!p) throw new Error(`no ${v.$creature} in the zoo`);
        const up = v.up ?? 0;
        return { x: p[0], y: p[1] + up, z: p[2] };
      }
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
  // Capture the app's own sound effects alongside the picture.
  await frame.evaluate(() => {
    window.__foldlings.stopMusic?.();
    const a = window.__foldlings.audio();
    if (!a.ctx || !a.master) return;
    const dest = a.ctx.createMediaStreamDestination();
    a.master.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    window.__filmAudio = { rec, chunks, dest, master: a.master };
    rec.start();
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
        ...(opt.hold
          ? [{ label: 'hold', position: { $board: opt.holdAt === 'dest' ? [dest.x * 0.8, dest.y * 0.8, 0.05] : [mid.x, mid.y, 0.11] }, anchor: 'grasp', duration: opt.hold }]
          : []),
        { label: 'over', position: { $board: [dest.x, dest.y, 0.012] }, anchor: 'grasp', duration: 0.6 / sp },
        { label: 'release', pinch: 0, duration: 0.18 },
        { label: 'back', position: { $board: opt.rest ?? [0.16, -0.22, 0.16] }, anchor: 'grasp', duration: 0.6 / sp },
      ],
    });
  };
  // {"tap": {...}} glides the right index fingertip to a target with direct
  // poses, so a pose held by the left hand (a raised palm) stays put.
  let tipOffset = null;
  const tap = async (opt) => {
    const ori = opt.orientation ?? { pitch: -20, yaw: 25, roll: 0 };
    if (!tipOffset) {
      const probe = await resolve({ $head: [0.2, -0.3, -0.35] });
      await remote('set_transform', { device: 'hand-right', position: probe, orientation: ori });
      await new Promise((r) => setTimeout(r, 250));
      const tip = await frame.evaluate(() => window.__foldlings.hands().right.tip.toArray());
      tipOffset = [tip[0] - probe.x, tip[1] - probe.y, tip[2] - probe.z];
    }
    const t = await resolve(opt.target);
    let from = opt.from ?? [0.08, 0.03, 0.08];
    if (opt.fromHead) {
      // Come in from the player's side, `fromHead` metres out.
      const h = await resolve({ $head: [0, -0.05, 0] });
      const d = [h.x - t.x, h.y - t.y, h.z - t.z];
      const l = Math.hypot(...d) || 1;
      from = d.map((v) => (v / l) * opt.fromHead);
    }
    const n = opt.steps ?? 10;
    const path = [];
    for (let i = 0; i <= n; i++) path.push(1 - i / n);
    for (let i = n - 1; i >= 0; i--) path.push(1 - i / n);
    for (const k of path) {
      const p = { x: t.x + from[0] * k - tipOffset[0], y: t.y + from[1] * k - tipOffset[1], z: t.z + from[2] * k - tipOffset[2] };
      await remote('set_transform', { device: 'hand-right', position: p, orientation: ori });
      await new Promise((r) => setTimeout(r, (opt.dt ?? 0.05) * 1000));
    }
    return true;
  };
  for (const s of shot.steps) {
    if (signal?.aborted) break;
    const at = Date.now() - t0;
    if (s.mark) marks.push({ label: s.mark, ms: at });
    if (s.fold) results.push({ fold: !!(await fold(s.fold)) });
    if (s.tap) results.push({ tap: await tap(s.tap) });
    if (s.eval) results.push(await frame.evaluate((src) => new Function(`return (${src});`)(), s.eval));
    if (s.remote) {
      const r = await remote(s.remote, s.params ?? {});
      results.push(s.remote === 'run_sequence' ? { ok: !!r, warnings: r?.warnings } : null);
    }
    if (s.wait) await new Promise((r) => setTimeout(r, s.wait * 1000));
  }
  await cdp.send('Page.stopScreencast');
  const b64 = await frame.evaluate(async () => {
    const f = window.__filmAudio;
    if (!f) return '';
    await new Promise((r) => {
      f.rec.onstop = r;
      f.rec.stop();
    });
    f.master.disconnect(f.dest);
    const buf = new Uint8Array(await new Blob(f.chunks, { type: 'audio/webm' }).arrayBuffer());
    let str = '';
    for (let i = 0; i < buf.length; i += 0x8000) str += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(str);
  });
  if (b64) writeFileSync(join(dir, 'audio.webm'), Buffer.from(b64, 'base64'));
  writeFileSync(join(dir, 'marks.json'), JSON.stringify({ marks, ms: Date.now() - t0 }, null, 1));
  return { frames: count, seconds: (Date.now() - t0) / 1000, marks: marks.length, results: results.filter(Boolean).slice(0, 8) };
}
