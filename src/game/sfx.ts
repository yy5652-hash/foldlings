/**
 * All sound is synthesised with WebAudio: paper rustles from filtered noise,
 * chimes from a few detuned sine partials. No audio files to load.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Call from a user gesture (entering XR, a click) so audio may start. */
export function unlockAudio() {
  const a = audio();
  if (a && a.state !== 'running') void a.resume();
}

export function audioDestination(): AudioNode | null {
  audio();
  return master;
}

export function audioContext(): AudioContext | null {
  return audio();
}

function rustle(dur: number, freq: number, q: number, gain: number, delay = 0) {
  const a = audio();
  if (!a || !master || !noise) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(freq, t);
  bp.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(freq: number, dur: number, gain: number, delay = 0, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function bell(freq: number, gain: number, delay = 0) {
  tone(freq, 1.6, gain, delay);
  tone(freq * 2.01, 0.9, gain * 0.35, delay);
  tone(freq * 3.02, 0.5, gain * 0.15, delay);
}

/** A short-lived output that places a sound at `pos` (world metres). */
function spot(pos?: { x: number; y: number; z: number }): AudioNode | null {
  const a = audio();
  if (!a || !master) return null;
  if (!pos) return master;
  const p = a.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = 0.6;
  p.rolloffFactor = 0.8;
  p.positionX.value = pos.x;
  p.positionY.value = pos.y;
  p.positionZ.value = pos.z;
  p.connect(master);
  return p;
}

/** One pitched note with a glide; `f` lists [time, frequency] points. */
function glide(
  out: AudioNode,
  f: [number, number][],
  dur: number,
  gain: number,
  delay = 0,
  type: OscillatorType = 'sine',
  vibrato = 0,
) {
  const a = audio()!;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f[0][1], t);
  for (const [at, hz] of f.slice(1)) o.frequency.exponentialRampToValueAtTime(hz, t + at);
  if (vibrato > 0) {
    const lfo = a.createOscillator();
    const depth = a.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Keeps spatial sounds in step with the player's head. */
export function setListener(pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }) {
  const a = ctx;
  if (!a) return;
  const l = a.listener;
  if (l.positionX) {
    l.positionX.value = pos.x;
    l.positionY.value = pos.y;
    l.positionZ.value = pos.z;
    l.forwardX.value = fwd.x;
    l.forwardY.value = fwd.y;
    l.forwardZ.value = fwd.z;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }
}

const BEAT_NOTES = [392.0, 523.25, 659.25, 783.99, 1046.5];

export const sfx = {
  pick() {
    rustle(0.12, 2600, 1.2, 0.18);
  },
  snap() {
    tone(1900, 0.05, 0.05, 0, 'triangle');
  },
  fold() {
    rustle(0.22, 1800, 0.9, 0.35);
    rustle(0.08, 900, 1.5, 0.25, 0.16);
    tone(150, 0.12, 0.12, 0.17, 'sine');
  },
  cancel() {
    rustle(0.15, 1400, 1, 0.15);
  },
  undo() {
    rustle(0.18, 1500, 0.8, 0.22);
  },
  click() {
    tone(1200, 0.04, 0.08, 0, 'triangle');
    tone(800, 0.06, 0.05, 0.02, 'sine');
  },
  solved() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => bell(f, 0.14, i * 0.09));
  },
  pop() {
    tone(420, 0.09, 0.15, 0, 'sine');
    tone(840, 0.12, 0.08, 0.03, 'sine');
    rustle(0.3, 3200, 0.7, 0.2);
  },
  chirp(pitch = 1) {
    const a = audio();
    if (!a || !master) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    o.frequency.setValueAtTime(1500 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(2600 * pitch, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(1700 * pitch, t + 0.12);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.2);
  },
  croak() {
    const a = audio();
    if (!a || !master) return;
    const t = a.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(190, t + i * 0.13);
      o.frequency.exponentialRampToValueAtTime(120, t + i * 0.13 + 0.1);
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.13 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.13 + 0.11);
      o.connect(lp).connect(g).connect(master);
      o.start(t + i * 0.13);
      o.stop(t + i * 0.13 + 0.14);
    }
  },
  flutter() {
    for (let i = 0; i < 4; i++) rustle(0.06, 2200, 2, 0.12, i * 0.07);
  },
  splash() {
    rustle(0.4, 1200, 0.5, 0.25);
    tone(300, 0.2, 0.05, 0.05);
  },
  /** The fold under your hand would solve it: a soft, bright "this is it". */
  warm() {
    tone(1318.5, 0.35, 0.05, 0);
    tone(1975.5, 0.45, 0.04, 0.07);
    tone(1900, 0.05, 0.05, 0, 'triangle');
  },
  /** One beat of a creature folding itself up: a crisp crease and a note. */
  foldBeat(i: number) {
    rustle(0.09, 3400, 1.4, 0.22);
    tone(BEAT_NOTES[Math.min(i, BEAT_NOTES.length - 1)], 0.5, 0.07, 0.02);
  },
  /** One star landing on the result card (0, 1, 2 rise in pitch). */
  star(i: number) {
    bell([783.99, 987.77, 1174.66][Math.min(2, i)], 0.09);
    rustle(0.12, 4200, 1.2, 0.08);
  },
  /** A whole world complete: a rising run and a held chord. */
  worldComplete() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => bell(f, 0.08, i * 0.09));
    [1046.5, 1318.5, 1568].forEach((f) => bell(f, 0.05, 0.7));
    rustle(0.8, 5200, 0.5, 0.1, 0.5);
  },
  /** All three stars: a short fanfare. */
  perfect() {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(f, 0.07, 0.08 + i * 0.07));
  },
  /** A rising shimmer as the creature finishes and wakes up. */
  awaken() {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(f, 0.05, i * 0.05));
    rustle(0.5, 5200, 0.6, 0.08);
  },
  /** Each kind's own call, placed where the creature is. */
  voice(kind: string, pos?: { x: number; y: number; z: number }, loud = 1) {
    const out = spot(pos);
    if (!out) return;
    const v = 0.09 * loud;
    switch (kind) {
      case 'crane':
        glide(out, [[0, 880], [0.12, 1180]], 0.2, v, 0, 'sine', 18);
        glide(out, [[0, 990], [0.14, 1320]], 0.24, v, 0.22, 'sine', 18);
        break;
      case 'frog':
        for (let i = 0; i < 2; i++) glide(out, [[0, 190], [0.1, 120]], 0.12, v * 1.1, i * 0.13, 'sawtooth');
        break;
      case 'fox':
        glide(out, [[0, 900], [0.05, 1500], [0.14, 760]], 0.16, v, 0, 'triangle');
        glide(out, [[0, 950], [0.05, 1550], [0.12, 820]], 0.14, v * 0.7, 0.2, 'triangle');
        break;
      case 'fish':
        for (let i = 0; i < 3; i++) glide(out, [[0, 520 + i * 90], [0.05, 1300 + i * 120]], 0.07, v * 0.8, i * 0.09);
        break;
      case 'butterfly':
        [1568, 1976, 2349].forEach((f, i) => glide(out, [[0, f], [0.3, f * 1.01]], 0.35, v * 0.45, i * 0.06));
        for (let i = 0; i < 3; i++) rustle(0.05, 2400, 2, 0.06, i * 0.06);
        break;
      case 'boat':
        glide(out, [[0, 330], [0.4, 322]], 0.45, v * 0.8, 0, 'triangle');
        glide(out, [[0, 495], [0.4, 483]], 0.45, v * 0.4, 0);
        break;
      case 'rabbit':
        glide(out, [[0, 1800], [0.06, 2400]], 0.08, v * 0.8);
        glide(out, [[0, 1900], [0.06, 2500]], 0.08, v * 0.7, 0.11);
        break;
      default:
        // Whale: a slow song that rises and falls.
        glide(out, [[0, 220], [0.6, 160], [1.3, 250]], 1.4, v * 1.2, 0, 'sine', 4);
        glide(out, [[0, 440], [0.6, 320], [1.3, 500]], 1.4, v * 0.35, 0, 'sine', 6);
    }
  },
};

// ------------------------------------------------------------ ambient music

let musicTimer: number | null = null;
let musicBus: GainNode | null = null;
let muted = false;
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

function pluck(freq: number, when: number, gain: number) {
  const a = audio();
  if (!a || !musicBus) return;
  const o = a.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2400, when);
  lp.frequency.exponentialRampToValueAtTime(500, when + 1.2);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 2.2);
  o.connect(lp).connect(g).connect(musicBus);
  o.start(when);
  o.stop(when + 2.4);
}

/** Soft generative koto-like notes with an echo; very quiet. */
export function startMusic() {
  const a = audio();
  if (!a || !master || musicTimer !== null) return;
  if (!musicBus) {
    musicBus = a.createGain();
    musicBus.gain.value = muted ? 0 : 0.5;
    const delay = a.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = a.createGain();
    fb.gain.value = 0.35;
    const wet = a.createGain();
    wet.gain.value = 0.4;
    musicBus.connect(master);
    musicBus.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(master);
  }
  let step = 0;
  const tick = () => {
    const ctx = audio();
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    // A slow phrase: mostly rests, a note or two each beat.
    if (Math.random() < 0.55) {
      const root = step % 16 < 8 ? 0 : 2;
      const n = SCALE[(root + Math.floor(Math.random() * 5)) % SCALE.length];
      pluck(n / (Math.random() < 0.3 ? 2 : 1), t, 0.05);
      if (Math.random() < 0.25) pluck(n * 1.5, t + 0.21, 0.025);
    }
    step++;
  };
  musicTimer = window.setInterval(tick, 900);
}

export function stopMusic() {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = null;
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.8;
  if (musicBus) musicBus.gain.value = m ? 0 : 0.5;
}

export function isMuted(): boolean {
  return muted;
}
