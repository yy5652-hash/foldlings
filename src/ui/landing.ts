/**
 * Headset launch page, or an About overlay above the desktop game.
 */

import { SessionMode, World } from '@iwsdk/core';
import { isMuted, unlockAudio } from '../game/sfx.js';
import { decodeFolds, encodeFolds, formatCode } from '../game/share.js';

async function supported(mode: XRSessionMode): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported(mode)) ?? false;
  } catch {
    return false;
  }
}

export async function setupLanding(world: World, actions: { startDesktop(): void; toggleSound(): void }) {
  const landing = document.getElementById('landing')!;
  const ar = document.getElementById('play-ar') as HTMLButtonElement;
  const vr = document.getElementById('play-vr') as HTMLButtonElement;
  const note = document.getElementById('note')!;
  const mouse = document.getElementById('try-mouse') as HTMLButtonElement;
  const hud = document.getElementById('game-hud')!;
  const close = document.getElementById('about-close') as HTMLButtonElement;
  const about = document.getElementById('hud-about') as HTMLButtonElement;
  const help = document.getElementById('hud-help')!;
  const how = document.getElementById('hud-how') as HTMLButtonElement;
  const helpClose = document.getElementById('hud-help-close') as HTMLButtonElement;
  const sound = document.getElementById('hud-sound') as HTMLButtonElement;
  const hudAR = document.getElementById('hud-ar') as HTMLButtonElement;
  const hudVR = document.getElementById('hud-vr') as HTMLButtonElement;
  setupScrollReveal(landing);
  const shared = new URLSearchParams(location.search).get('p');
  const folds = shared ? decodeFolds(shared) : null;
  if (folds) {
    const invitation = document.getElementById('shared-puzzle')!;
    invitation.textContent = `A friend folded this for you · ${formatCode(encodeFolds(folds))}`;
    invitation.hidden = false;
    ar.textContent = 'Fold it in your room';
    vr.textContent = 'Fold it in VR';
    mouse.textContent = 'Fold it here with a mouse';
  }

  const [arOk, vrOk] = await Promise.all([supported('immersive-ar'), supported('immersive-vr')]);
  const desktop = !arOk && !vrOk;
  let playingDesktop = desktop;
  // Decide by immersive capability, never user-agent or screen size.
  landing.classList.toggle('hidden', desktop || world.renderer.xr.isPresenting);
  landing.hidden = false;
  hud.hidden = !desktop || world.renderer.xr.isPresenting;
  close.hidden = !desktop;
  hudAR.disabled = !arOk;
  hudVR.disabled = !vrOk;
  document.getElementById('hud-quest-hint')!.hidden = !desktop;
  if (desktop) {
    document.body.classList.add('desktop-game');
    actions.startDesktop();
  }
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

  const enterAR = () => {
    if (!arOk) return;
    unlockAudio();
    void world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
  };
  const enterVR = () => {
    if (!vrOk) return;
    unlockAudio();
    void world.launchXR({ sessionMode: SessionMode.ImmersiveVR });
  };
  ar.addEventListener('click', enterAR);
  vr.addEventListener('click', enterVR);
  hudAR.addEventListener('click', enterAR);
  hudVR.addEventListener('click', enterVR);
  const closeAbout = () => {
    landing.classList.add('hidden');
    landing.classList.remove('about-overlay');
    landing.removeAttribute('role');
    landing.removeAttribute('aria-modal');
    hud.inert = false;
    about.focus();
  };
  const closeHelp = () => {
    help.hidden = true;
    how.setAttribute('aria-expanded', 'false');
    how.focus();
  };
  about.addEventListener('click', () => {
    help.hidden = true;
    how.setAttribute('aria-expanded', 'false');
    landing.classList.add('about-overlay');
    landing.classList.remove('hidden');
    landing.setAttribute('role', 'dialog');
    landing.setAttribute('aria-modal', 'true');
    landing.setAttribute('aria-label', 'About Foldlings');
    hud.inert = true;
    close.focus();
  });
  close.addEventListener('click', closeAbout);
  how.addEventListener('click', () => {
    help.hidden = !help.hidden;
    how.setAttribute('aria-expanded', String(!help.hidden));
    if (!help.hidden) helpClose.focus();
  });
  helpClose.addEventListener('click', closeHelp);
  const syncSound = () => {
    sound.textContent = isMuted() ? 'Sound off' : 'Sound on';
    sound.setAttribute('aria-pressed', String(!isMuted()));
  };
  syncSound();
  window.addEventListener('foldlings-soundchange', syncSound);
  sound.addEventListener('click', () => {
    unlockAudio();
    actions.toggleSound();
    syncSound();
  });
  // The page now starts without a launch click: unlock on the first real gesture.
  if (desktop) world.renderer.domElement.addEventListener('pointerdown', unlockAudio, { once: true });
  mouse.addEventListener('click', () => {
    unlockAudio();
    playingDesktop = true;
    document.body.classList.add('desktop-game');
    actions.startDesktop();
    hud.hidden = false;
    close.hidden = false;
    closeAbout();
  });
  window.addEventListener('keydown', (e) => {
    if (world.renderer.xr.isPresenting) return;
    if (e.key === 'Escape') {
      if (!playingDesktop) landing.classList.remove('hidden');
      else if (!landing.classList.contains('hidden')) closeAbout();
      else if (!help.hidden) closeHelp();
    }
    if (e.key === 'Tab' && playingDesktop && !landing.classList.contains('hidden')) {
      const controls = Array.from(landing.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
        .filter((el) => el.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  world.renderer.xr.addEventListener('sessionstart', () => {
    landing.classList.add('hidden');
    hud.hidden = true;
    help.hidden = true;
  });
  world.renderer.xr.addEventListener('sessionend', () => {
    playingDesktop = desktop;
    close.hidden = !desktop;
    landing.classList.remove('about-overlay');
    landing.removeAttribute('role');
    landing.removeAttribute('aria-modal');
    hud.inert = false;
    if (desktop) { closeAbout(); hud.hidden = false; }
    else {
      document.body.classList.remove('desktop-game');
      landing.classList.remove('hidden');
    }
  });
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
  copy.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Foldlings', text: 'A friend folded this for you', url: link });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Copied';
    } catch { /* Clipboard access may be unavailable. */ }
  });
  el.append(copy);
  el.hidden = false;
}
