// Dev-only: details of the emulator overlay container's children.
export default async function ({ frame }) {
  return await frame.evaluate(() => {
    const host = document.body.children[document.body.children.length - 1];
    return [...host.children].map((c, i) => ({
      i,
      tag: c.tagName,
      z: getComputedStyle(c).zIndex,
      pe: getComputedStyle(c).pointerEvents,
      shadow: !!c.shadowRoot,
      text: (c.textContent || '').trim().slice(0, 80),
      kids: c.children.length,
      html: c.outerHTML.slice(0, 160),
    }));
  });
}
