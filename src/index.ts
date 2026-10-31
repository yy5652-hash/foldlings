import '@fontsource-variable/inter/opsz.css';
import { SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { fontsReady } from './game/glass.js';
import { GameSystem } from './game/game-system.js';
import { setupLanding } from './ui/landing.js';

fontsReady()
  .then(() =>
    World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions),
  )
  .then((world) => {
    world.registerSystem(GameSystem);
    void setupLanding(world);

    // Installed as an app on Quest there is no page to click: the launch tap
    // is the user activation, so go straight into the room. In a browser tab
    // the landing page's buttons stay in charge.
    const nav = navigator as Navigator & { xr?: XRSystem };
    if ('getDigitalGoodsService' in window && nav.xr?.isSessionSupported) {
      nav.xr
        .isSessionSupported('immersive-ar')
        .then((ok) => {
          if (ok) world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
        })
        .catch(() => {});
    }
  });

// Offline play after the first visit (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch(() => {});
}
