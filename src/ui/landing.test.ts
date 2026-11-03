import { readFileSync } from 'node:fs';
import { SessionMode, type World } from '@iwsdk/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupLanding } from './landing.js';

const audio = vi.hoisted(() => ({ muted: false }));
vi.mock('../game/sfx.js', () => ({ isMuted: () => audio.muted, unlockAudio: vi.fn() }));

class Classes {
  values = new Set<string>();
  add(value: string) { this.values.add(value); }
  remove(value: string) { this.values.delete(value); }
  contains(value: string) { return this.values.has(value); }
  toggle(value: string, on: boolean) { if (on) this.add(value); else this.remove(value); }
}
class Element extends EventTarget {
  classList = new Classes();
  hidden = false;
  disabled = false;
  inert = false;
  textContent = '';
  attributes = new Map<string, string>();
  focus = vi.fn();
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  querySelectorAll() { return []; }
  click() { this.dispatchEvent(new Event('click')); }
}
afterEach(() => { vi.unstubAllGlobals(); audio.muted = false; });

function fixture(support?: (mode: XRSessionMode) => Promise<boolean>) {
  // Use the actual HTML ids, so missing controls fail setup rather than a mock inventing them.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const el = new Element();
    el.hidden = /\shidden(?:[\s>])/.test(match[0]);
    if (/class="hidden"/.test(match[0])) el.classList.add('hidden');
    elements.set(match[1], el);
  }
  const el = (id: string) => elements.get(id)!;
  const windowEvents = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('navigator', { xr: support ? { isSessionSupported: support } : undefined });
  vi.stubGlobal('document', { getElementById: el, body: new Element() });
  vi.stubGlobal('location', { search: '', origin: 'https://example.test', pathname: '/foldlings/' });
  vi.stubGlobal('localStorage', { getItem: () => null });
  const xr = Object.assign(new EventTarget(), { isPresenting: false });
  const launchXR = vi.fn();
  const world = { renderer: { xr, domElement: new EventTarget() }, launchXR } as unknown as World;
  const actions = { startDesktop: vi.fn(), toggleSound: vi.fn(() => { audio.muted = !audio.muted; }) };
  const escape = () => windowEvents.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  return { el, world, xr, launchXR, actions, escape, windowEvents };
}

describe('desktop and headset entry', () => {
  it('starts directly in the game without an XR API; About and Escape return to the game', async () => {
    const f = fixture();
    expect(f.el('landing').hidden).toBe(true);
    await setupLanding(f.world, f.actions);
    expect(f.actions.startDesktop).toHaveBeenCalledOnce();
    expect(f.el('landing').classList.contains('hidden')).toBe(true);
    expect(f.el('game-hud').hidden).toBe(false);
    expect(f.el('hud-vr').disabled).toBe(true); expect(f.el('hud-ar').disabled).toBe(true);
    expect(f.el('hud-quest-hint').hidden).toBe(false);
    f.el('hud-vr').click(); f.el('hud-ar').click();
    expect(f.launchXR).not.toHaveBeenCalled();
    f.el('hud-about').click();
    expect(f.el('landing').classList.contains('hidden')).toBe(false);
    expect(f.el('landing').attributes.get('aria-modal')).toBe('true');
    expect(f.el('game-hud').inert).toBe(true);
    expect(f.el('about-close').focus).toHaveBeenCalled();
    f.escape();
    expect(f.el('landing').classList.contains('hidden')).toBe(true);
    expect(f.el('game-hud').inert).toBe(false);
    f.escape(); expect(f.el('landing').classList.contains('hidden')).toBe(true);
    f.el('hud-about').click(); f.el('about-close').click();
    expect(f.el('landing').classList.contains('hidden')).toBe(true);
  });

  it('opens/dismisses instructions and keeps sound synchronized with existing settings', async () => {
    const f = fixture(); await setupLanding(f.world, f.actions);
    f.el('hud-how').click(); expect(f.el('hud-help').hidden).toBe(false);
    f.escape(); expect(f.el('hud-help').hidden).toBe(true);
    f.el('hud-how').click(); f.el('hud-help-close').click();
    expect(f.el('hud-help').hidden).toBe(true);
    f.el('hud-sound').click();
    expect(f.actions.toggleSound).toHaveBeenCalledOnce();
    expect(f.el('hud-sound').textContent).toBe('Sound off');
    expect(f.el('hud-sound').attributes.get('aria-pressed')).toBe('false');
    audio.muted = false;
    f.windowEvents.dispatchEvent(new Event('foldlings-soundchange'));
    expect(f.el('hud-sound').textContent).toBe('Sound on');
  });

  it('keeps the Quest landing, launch modes, and session return flow', async () => {
    const f = fixture(async () => true); await setupLanding(f.world, f.actions);
    expect(f.actions.startDesktop).not.toHaveBeenCalled();
    expect(f.el('landing').classList.contains('hidden')).toBe(false);
    expect(f.el('game-hud').hidden).toBe(true);
    expect(f.el('about-close').hidden).toBe(true);
    f.el('play-ar').click(); f.el('play-vr').click();
    expect(f.launchXR).toHaveBeenNthCalledWith(1, { sessionMode: SessionMode.ImmersiveAR });
    expect(f.launchXR).toHaveBeenNthCalledWith(2, { sessionMode: SessionMode.ImmersiveVR });
    f.xr.isPresenting = true; f.xr.dispatchEvent(new Event('sessionstart'));
    f.escape(); expect(f.el('landing').classList.contains('hidden')).toBe(true);
    f.xr.isPresenting = false; f.xr.dispatchEvent(new Event('sessionend'));
    expect(f.el('landing').classList.contains('hidden')).toBe(false);
    expect(f.el('game-hud').hidden).toBe(true);
  });

  it('uses either immersive mode as the headset signal and enables preview HUD launch buttons individually', async () => {
    const f = fixture(async (mode) => mode === 'immersive-vr'); await setupLanding(f.world, f.actions);
    expect(f.actions.startDesktop).not.toHaveBeenCalled();
    expect(f.el('play-ar').hidden).toBe(true);
    f.el('try-mouse').click();
    expect(f.actions.startDesktop).toHaveBeenCalledOnce();
    expect(f.el('game-hud').hidden).toBe(false);
    expect(f.el('hud-vr').disabled).toBe(false); expect(f.el('hud-ar').disabled).toBe(true);
    expect(f.el('hud-quest-hint').hidden).toBe(true);
    f.el('hud-vr').click();
    expect(f.launchXR).toHaveBeenCalledWith({ sessionMode: SessionMode.ImmersiveVR });
    f.xr.dispatchEvent(new Event('sessionstart')); f.xr.dispatchEvent(new Event('sessionend'));
    expect(f.el('landing').classList.contains('hidden')).toBe(false);
    expect(f.el('game-hud').hidden).toBe(true);
  });

  it('falls back to desktop when support checks return false or reject', async () => {
    for (const support of [async () => false, async () => { throw new Error('XR unavailable'); }]) {
      const f = fixture(support); await setupLanding(f.world, f.actions);
      expect(f.actions.startDesktop).toHaveBeenCalledOnce();
      expect(f.el('landing').classList.contains('hidden')).toBe(true);
    }
  });
});
