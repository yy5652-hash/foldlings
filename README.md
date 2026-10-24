# Foldlings

**Fold paper with your bare hands. Every puzzle you solve becomes a little origami creature that moves into your room — and is still there next time.**

Play on Meta Quest 3 / 3S in the Quest Browser: **https://yy5652-hash.github.io/foldlings/**
(no install; hands only; best seated at a table).

## How to play

1. Sit at a table and press **Play in your room**. A holographic scan labels the surfaces the headset found, and the folding mat lands on your real table (or floats at desk height if the room has not been scanned).
2. **Pinch** any part of the paper and lay it over. The crease follows your hand and snaps to the dots on the mat, so shaky hands still fold cleanly.
3. Match the shape on the card. When the folded picture matches, the paper springs to life as a crane, frog, fox, fish, butterfly, boat, rabbit or whale — and goes to live somewhere in your room: on your coffee table, couch, shelf, floor or wall.
4. Come back tomorrow for the **Daily Fold**. Your paper zoo keeps growing and stays where it settled.

Add `?xray=1` to the URL to see the tracked hand joints and the live crease solver.

Round tokens on the mat: **undo**, **hint** (a ghost hand shows the next fold), **restart**, **daily fold**, **sound**, **recenter**. Poke them with a fingertip, point and pinch, or look and pinch.

## Built with

- [Meta Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) (IWSDK, WebXR, Three.js, ECS)
- WebXR hand tracking, plane and mesh detection, anchors (persistent where supported), passthrough
- A custom folding engine in TypeScript (`src/fold/`): paper is a stack of convex facets; a fold clips, reflects and restacks them. Unit-tested with Vitest.
- All models, textures and sounds are generated in code — no external art or audio files.

## Develop

```bash
npm install
npm run dev        # IWSDK dev server with the IWER headset emulator
npx vitest run     # folding engine tests
npm run build
```

`scripts/gen-levels.ts` searches fold sequences breadth-first to find solvable goal pictures for the campaign and the daily pool.
