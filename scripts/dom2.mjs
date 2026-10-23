// Dev-only: describe overlay elements in the app frame during XR.
export default async function ({ frame }) {
  return await frame.evaluate(() => {
    const out = [];
    const walk = (e, depth) => {
      if (depth > 4) return;
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        out.push(`${'  '.repeat(depth)}${e.tagName}#${e.id}.${String(e.className).slice(0, 30)} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      for (const c of e.children) walk(c, depth + 1);
    };
    for (const c of document.body.children) walk(c, 0);
    return out.slice(0, 60);
  });
}
