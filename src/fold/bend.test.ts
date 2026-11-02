import { describe, expect, it } from 'vitest';
import { bendPoint, BendPose, interpolateBend, solveBend, solveHeldBend } from './bend.js';
import { reflectPoint } from './geom.js';
import { initialPaper } from './paper.js';

const pose = (): BendPose => ({ nx: 1, ny: 0, d: 0, theta: 1.4, radius: 0.01, residual: 0 });
const point = () => ({ x: 0, y: 0, h: 0, nx: 0, ny: 0, nh: 1 });

describe('paper bend', () => {
  it('reaches thousands of reachable hands to within half a millimetre', () => {
    const paper = initialPaper();
    const p = { x: -0.1, y: -0.1 };
    const out = pose();
    const held = point();
    let seed = 51;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let reached = 0;
    for (let i = 0; i < 10000; i++) {
      const a = random() * Math.PI / 2;
      const t = 0.012 + random() * 0.3;
      const hand = { x: p.x + Math.cos(a) * t, y: p.y + Math.sin(a) * t, h: random() * 0.12 };
      solveBend(p, hand, paper, null, out);
      // The support clamp is the only limit for these directions and distances.
      const s = out.nx * p.x + out.ny * p.y - out.d;
      const max = Math.max(...paper.facets[0].poly.map(v => -(v.x - p.x) * out.nx - (v.y - p.y) * out.ny)) - 0.002;
      if (s >= max - 1e-8) continue;
      bendPoint(p.x, p.y, 0, out, 0, held);
      expect(Math.hypot(held.x - hand.x, held.y - hand.y, held.h - hand.h)).toBeLessThan(0.0005);
      expect(out.residual).toBeLessThan(0.0005);
      reached++;
    }
    expect(reached).toBeGreaterThan(5000);
  });

  it('preserves arc length along the neutral layer', () => {
    const b = pose();
    const a = point();
    const c = point();
    let length = 0;
    bendPoint(0, 0, 0, b, 0, a);
    for (let i = 1; i <= 2000; i++) {
      bendPoint(i * 0.00005, 0, 0, b, 0, c);
      length += Math.hypot(c.x - a.x, c.y - a.y, c.h - a.h);
      Object.assign(a, c);
    }
    expect(length).toBeCloseTo(0.1, 6);
  });

  it('joins continuously at the crease and the end of the arc', () => {
    const b = pose();
    for (const s of [0, b.radius * b.theta]) {
      const a = bendPoint(s - 1e-9, 0, 0.002, b, 0, point());
      const c = bendPoint(s + 1e-9, 0, 0.002, b, 0, point());
      expect(Math.hypot(a.x - c.x, a.h - c.h)).toBeLessThan(1e-8);
      expect(Math.hypot(a.nx - c.nx, a.nh - c.nh)).toBeLessThan(1e-6);
    }
  });

  it('a flat completed bend is reflection and flat hand input follows the bisector', () => {
    const b = { ...pose(), theta: Math.PI, radius: 0 };
    expect(bendPoint(0.07, 0.03, 0, b, 0, point()).x).toBeCloseTo(reflectPoint(b, { x: 0.07, y: 0.03 }).x);
    const hand = { x: 0.04, y: 0.02, h: 0 };
    const p = { x: -0.08, y: -0.06 };
    solveBend(p, hand, initialPaper(), null, b);
    const held = bendPoint(p.x, p.y, 0, b, 0, point());
    expect(Math.hypot(held.x - hand.x, held.y - hand.y, held.h)).toBeLessThan(1e-10);
  });

  it('reports the actual support-clamped residual and handles rest and vertical pulls', () => {
    const p = { x: -0.09, y: 0 };
    const hand = { x: 0.5, y: 0, h: 0.3 };
    const b = solveBend(p, hand, initialPaper(), null, pose());
    const held = bendPoint(p.x, p.y, 0, b, 0, point());
    expect(b.residual).toBeGreaterThan(0);
    expect(b.residual).toBeCloseTo(Math.hypot(held.x - hand.x, held.y - hand.y, held.h - hand.h), 12);
    solveBend(p, { ...p, h: 0.001 }, initialPaper(), null, b);
    expect(b.theta).toBe(0);
    expect(b.residual).toBe(0.001);
    solveBend(p, { ...p, h: 0.05 }, initialPaper(), null, b);
    expect(Number.isFinite(b.d + b.theta + b.residual)).toBe(true);
  });
});


it('settles continuously to a lattice fold or back to flat with unit normals', () => {
  const from = pose();
  const to = { ...pose(), nx: -1, theta: Math.PI, radius: 0, d: 0.05 };
  const out = pose();
  for (let i = 0; i <= 100; i++) {
    interpolateBend(from, to, i / 100, out);
    expect(Math.hypot(out.nx, out.ny)).toBeCloseTo(1, 12);
    expect(Number.isFinite(out.d + out.theta + out.radius)).toBe(true);
  }
  expect(out.nx).toBeCloseTo(to.nx, 12);
  expect(out.d).toBe(to.d);
  expect(out.theta).toBe(Math.PI);
  expect(out.radius).toBe(0);
  interpolateBend(from, { ...from, theta: 0, radius: 0 }, 1, out);
  const held = bendPoint(0.06, 0, 0.002, out, 0.004, point());
  expect(held.x).toBeCloseTo(0.06, 12);
  expect(held.h).toBeCloseTo(0.002, 12);
});


it('reaches the actual held surface after accounting for stack and hinge heights', () => {
  const p = { x: -0.095, y: -0.095 };
  const paper = initialPaper();
  const out = pose();
  const held = point();
  for (const height of [0.0012, 0.0021, 0.003]) {
    const hingeY = height + 0.00015;
    for (let i = 0; i < 300; i++) {
      const hand = { x: p.x + 0.03 + i / 300 * 0.16, y: p.y + 0.04, h: 0.01 + (i % 11) * 0.005 };
      solveHeldBend(p, hand, paper, null, height, hingeY, out, held);
      expect(out.residual).toBeLessThan(0.0005);
      bendPoint(p.x, p.y, height, out, hingeY, held);
      expect(Math.hypot(held.x - hand.x, held.y - hand.y, held.h - hand.h)).toBeLessThan(0.0005);
    }
  }
});

it('stabilises short horizontal pulls with the previous normal and reports their true error', () => {
  const p = { x: -0.095, y: -0.095 };
  const hand = { x: p.x, y: p.y + 0.003, h: 0.015 };
  const b = solveBend(p, hand, initialPaper(), { x: 1, y: 0 }, pose());
  expect(b.nx).toBe(-1);
  expect(b.ny).toBeCloseTo(0, 12);
  const held = bendPoint(p.x, p.y, 0, b, 0, point());
  expect(b.residual).toBeCloseTo(Math.hypot(held.x - hand.x, held.y - hand.y, held.h - hand.h), 12);
  hand.y = p.y + 0.012;
  solveBend(p, hand, initialPaper(), { x: 1, y: 0 }, b);
  expect(b.nx).toBeCloseTo(0, 12);
  expect(b.ny).toBe(-1);
});


it('keeps a supported strip when pulling outward from the paper boundary', () => {
  const p = { x: 0.1, y: 0 };
  const hand = { x: 0.15, y: 0, h: 0.03 };
  const b = solveBend(p, hand, initialPaper(), null, pose());
  expect(b.nx * p.x + b.ny * p.y - b.d).toBeCloseTo(-0.002, 12);
  const held = bendPoint(p.x, p.y, 0, b, 0, point());
  expect(b.residual).toBeCloseTo(Math.hypot(held.x - hand.x, held.y - hand.y, held.h - hand.h), 12);
});
