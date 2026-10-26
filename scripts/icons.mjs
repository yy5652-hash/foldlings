// Install icons from the paper-crane mark: `node scripts/icons.mjs`.
// "any" icons keep the rounded tile; the maskable one is full-bleed with the
// crane inside the middle safe zone, as Horizon OS applies its own mask.
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const crane = `
  <path d="M10 40 L30 30 L32 16 L36 30 L54 22 L40 36 L44 48 L32 40 L20 46 Z" fill="#e2574c"/>
  <path d="M30 30 L32 16 L36 30 L32 40 Z" fill="#f6f0e4"/>
  <path d="M32 40 L40 36 L44 48 Z" fill="#b8433a"/>`;
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#2f4a45"/>${crane}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#2f4a45"/>
  <g transform="translate(32 32) scale(0.72) translate(-32 -32)">${crane}</g></svg>`;

await mkdir('public/icons', { recursive: true });
const png = (svg, size, out) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(out);
await png(rounded, 192, 'public/icons/icon-192.png');
await png(rounded, 512, 'public/icons/icon-512.png');
await png(maskable, 512, 'public/icons/icon-512-maskable.png');
console.log('icons written');
