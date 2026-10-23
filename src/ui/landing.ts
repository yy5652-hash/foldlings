/**
 * The flat page shown before entering the headset experience: what the game
 * is, three steps, and buttons for passthrough or VR.
 */

import { SessionMode, World } from '@iwsdk/core';
import { unlockAudio } from '../game/sfx.js';

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
