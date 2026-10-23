// Dev-only: inspect the managed workspace layout around the app frame.
export default async function ({ page }) {
  return await page.evaluate(() => {
    const out = { win: [innerWidth, innerHeight], frames: [] };
    for (const f of document.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      out.frames.push({ src: f.src.slice(0, 80), x: r.x, y: r.y, w: r.width, h: r.height, id: f.id, cls: f.className });
    }
    out.bodyKids = [...document.body.children].map((e) => e.tagName + '#' + e.id + '.' + e.className).slice(0, 10);
    return out;
  });
}
