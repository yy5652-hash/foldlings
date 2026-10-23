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
