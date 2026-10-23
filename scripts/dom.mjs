// Dev-only: list top-level DOM of the app frame (to find emulator overlays).
export default async function ({ frame }) {
  return await frame.evaluate(() =>
    [...document.body.children].map((e) => {
      const r = e.getBoundingClientRect();
      return `${e.tagName}#${e.id}.${String(e.className).slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)} z=${getComputedStyle(e).zIndex}`;
    }),
  );
}
