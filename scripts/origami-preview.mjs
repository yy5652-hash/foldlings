import { mkdirSync, writeFileSync } from 'node:fs';
import { baked } from '../src/game/origami/baked.ts';

const directory = new URL('../.tmp/origami-preview/', import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL('baked.json', directory), JSON.stringify(baked));
for (const [kind, data] of Object.entries(baked)) {
  const span = k => Math.max(...data.positions.map(p => p[k])) - Math.min(...data.positions.map(p => p[k]));
  const views = [
    ['Front', [1, 0, 0], [0, 1, 0], [0, 0, -1]],
    ['Side', [0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ['Top', [1, 0, 0], [0, 0, 1], [0, 1, 0]],
    ['Quarter', [.70710678, 0, -.70710678], [-.35355339, .8660254, -.35355339], [.61237244, .5, .61237244]],
  ];
  const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
  const cm = n => (n * 100).toFixed(2);
  const svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="840" viewBox="0 0 1120 840">',
    '<rect width="1120" height="840" fill="#fafcfd"/>',
    '<style>text{font-family:monospace;fill:#284251}.face{stroke:#345c70;stroke-width:.7;stroke-linejoin:round}.label{font-size:15px}</style>',
    `<text x="28" y="30" font-size="20">${kind} · 20 × 20 cm sheet · ${data.faces.length} faces</text>`,
    `<text x="28" y="54" class="label">W ${cm(span(0))} cm · H ${cm(span(1))} cm · L ${cm(span(2))} cm · 1 grid square = 1 cm</text>`];
  views.forEach(([name, right, up, depth], view) => {
    const ox = view % 2 * 560, oy = Math.floor(view / 2) * 370 + 80;
    const pts = data.positions.map(p => [dot(p, right), dot(p, up), dot(p, depth)]);
    const min = [0, 1].map(k => Math.min(...pts.map(p => p[k]))), max = [0, 1].map(k => Math.max(...pts.map(p => p[k])));
    const scale = 2350, cx = ox + 280, cy = oy + 180;
    const xy = p => [cx + (p[0] - (min[0] + max[0]) / 2) * scale, cy - (p[1] - (min[1] + max[1]) / 2) * scale];
    svg.push(`<text x="${ox + 28}" y="${oy + 18}" font-size="18">${name}</text>`);
    for (let k = -10; k <= 10; k++) {
      const d = k * .01 * scale;
      svg.push(`<path d="M${cx + d},${oy + 35}V${oy + 320} M${ox + 25},${cy + d}H${ox + 535}" stroke="#e8eef1" stroke-width=".5"/>`);
    }
    const faces = data.faces.map((f, i) => ({ f, i, depth: f.vertices.reduce((s, v) => s + pts[v][2], 0) / f.vertices.length })).sort((a, b) => a.depth - b.depth || a.i - b.i);
    for (const { f } of faces) {
      const points = f.vertices.map(v => xy(pts[v]).map(n => n.toFixed(2)).join(',')).join(' ');
      svg.push(`<polygon class="face" points="${points}" fill="${f.front ? '#8ad7e2' : '#e1d8c8'}" fill-opacity="${f.front ? '.12' : '.035'}"><title>${f.part}</title></polygon>`);
    }
    svg.push(`<text x="${ox + 28}" y="${oy + 350}" class="label">${cm(max[0] - min[0])} × ${cm(max[1] - min[1])} cm</text>`);
  });
  svg.push('</svg>');
  writeFileSync(new URL(`${kind}.svg`, directory), svg.join('\n') + '\n');
  console.log(`.tmp/origami-preview/${kind}.svg`);
}
