# Adding a baked kind
Create `<kind>.ts` exporting one `Definition` factory; copy `frog.ts` for a small example.
Declare `construction`, `shape(flat)`, part→Rig `rig`, barycentric `eyes`, and `touchesGround`.
Shape returns matching `positions` and `flatPositions` arrays in metres, +Y up, forward -Z.
The baker grounds contact kinds, resolves eye faces, and reserves the last stage for opening.
Add one entry to `patterns` in `bake.ts`: `() => import('./fox.js').then(m => m.fox()),`.
No runtime builder edits: baked kinds use `origami`; other kinds keep their legacy builders.

## Construction DSL (two-line examples)
`Construction` starts from a valid 20 cm square base; its frame uses the centre and +/+ corner.
```ts
const c = new Construction(birdBase(), () => 'body');
const tip: Point = [.1, .1];
```
`fold` reflects the positive side of a unit-normal line, selecting connected flaps by sheet seeds.
```ts
c.fold({ nx: 1, ny: 0, d: .06 }, [tip], 3, 'legR');
c.fold({ nx: 0, ny: 1, d: .04 }, [tip], 4);
```
`crease` adds an unfolded opening hinge; `finish` rebuilds shared topology and M/V labels.
```ts
c.crease({ nx: 0, ny: 1, d: 0 }, 5);
const construction = c.finish();
```
`rotate` rigidly opens points about an axis; `project` fits shared positions to length constraints offline.
```ts
const opened = positions.map(p => rotate(p, axis, Math.PI / 10));
project(construction.graph, opened, pins, 200); // pins: { vertex, position, weight }[]
```

## Checks and commands
Add `<kind>.test.ts`: full 400 cm² coverage, positive triangulation, Kawasaki/Maekawa, flat closure ≤1e-9 m.
Check every edge and polygon diagonal: worst strain ≤1%, RMS ≤0.2%, planarity ≤0.5 mm, including runtime rounding.
Test that kind's dimensions, silhouette, named parts, eye surfaces, and y=0 contact when declared.
Test sheet → flat-folded at `(stages-1)/stages` → opened at 1, continuity, clamping and replay.
These checks do not certify collision-free folding or physical layer order; layer count is a heuristic.
Bake: `node scripts/bake-origami.ts`; preview: `node scripts/origami-preview.mjs` (offline SVGs, no browser).
Outputs: generated `baked.ts`, `.tmp/origami-preview/baked.json`, and `<kind>.svg` previews.
Verify: `npx tsc --noEmit -p .` then `npx vitest run`. Never hand-edit `baked.ts`.

A model with `touchesGround` is not left in the pose `shape` gives it: `settle` tips it onto whatever its centre of mass rests on, and everything downstream uses that pose. Shape tests can read the designed pose with `bake(definition, { rest: false })`.

Rig parts move only about the crease they share with the rest of the sheet (`Flex` in `creature-models.ts`), and stop before a seam opens past `MAX_SEAM`. Prefer a straight seam for anything that has to move a lot: a crooked one allows very little.
