/**
 * The flat page shown before entering the headset experience: what the game
 * is, product details, and buttons for passthrough or VR.
 */

import { SessionMode, World } from '@iwsdk/core';
import { unlockAudio } from '../game/sfx.js';
import { formatCode } from '../game/share.js';

async function supported(mode: XRSessionMode): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported(mode)) ?? false;
  } catch {
    return false;
  }
}

export async function setupLanding(world: World) {
  const landing = document.getElementById('landing')!;
  const ar = document.getElementById('play-ar') as HTMLButtonElement;
  const vr = document.getElementById('play-vr') as HTMLButtonElement;
  const note = document.getElementById('note')!;
  const mouse = document.getElementById('try-mouse') as HTMLButtonElement;
  setupScrollReveal(landing);

  const [arOk, vrOk] = await Promise.all([supported('immersive-ar'), supported('immersive-vr')]);
  ar.disabled = !arOk;
  vr.disabled = !vrOk;
  if (arOk) {
    note.textContent = 'Hands only — no controllers needed. Best on Meta Quest 3 or 3S.';
  } else if (vrOk) {
    ar.hidden = true;
    note.textContent = 'Hands only — no controllers needed. You will fold in a cosy virtual study.';
  } else {
    ar.hidden = vr.hidden = true;
    note.textContent = 'Open this page in the Meta Quest browser to play with your hands.';
  }
  mouse.hidden = false;
  showShare();

  ar.addEventListener('click', () => {
    unlockAudio();
    world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
  });
  vr.addEventListener('click', () => {
    unlockAudio();
    world.launchXR({ sessionMode: SessionMode.ImmersiveVR });
  });
  mouse.addEventListener('click', () => {
    unlockAudio();
    landing.classList.add('hidden');
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') landing.classList.remove('hidden');
  });
  world.renderer.xr.addEventListener('sessionstart', () => landing.classList.add('hidden'));
  world.renderer.xr.addEventListener('sessionend', () => landing.classList.remove('hidden'));
}

/** Progressive enhancement: content stays visible without animation support. */
function setupScrollReveal(landing: HTMLElement) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || !('IntersectionObserver' in window)) return;

  const sections = landing.querySelectorAll<HTMLElement>('[data-reveal]');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove('reveal-pending');
      observer.unobserve(entry.target);
    }
  }, { root: landing, threshold: 0.08 });

  for (const section of sections) {
    section.classList.add('reveal-pending');
    observer.observe(section);
  }

  const revealAll = () => {
    if (!motion.matches) return;
    observer.disconnect();
    sections.forEach((section) => section.classList.remove('reveal-pending'));
    motion.removeEventListener('change', revealAll);
  };
  motion.addEventListener('change', revealAll);
}

/** The newest player-made puzzle, with a link a friend can open. */
function showShare() {
  const el = document.getElementById('share');
  if (!el) return;
  let codes: string[] = [];
  try {
    codes = (JSON.parse(localStorage.getItem('foldlings.progress.v1') ?? 'null')?.custom as string[]) ?? [];
  } catch {
    return;
  }
  const code = codes[codes.length - 1];
  if (!code) return;
  const link = `${location.origin}${location.pathname}?p=${code}`;
  el.textContent = `Your latest puzzle: ${formatCode(code)} `;
  const copy = document.createElement('button');
  copy.className = 'ghost';
  copy.textContent = 'Copy link';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(link).then(() => (copy.textContent = 'Copied'));
  });
  el.append(copy);
  el.hidden = false;
}
