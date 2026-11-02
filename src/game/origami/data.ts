import type { RigPart } from './definition.js';
import type { Part } from './pattern.js';
import type { Position } from './relax.js';

export interface BakedOrigami {
  side: number;
  rig: Partial<Record<Part, RigPart>>;
  eyes: { part: Part; vertices: number[]; weights: Position; normalSign: number; radius: number }[];
  touchesGround: boolean;
  sheetPositions: Position[];
  flatPositions: Position[];
  positions: Position[];
  faces: { vertices: number[]; triangles: number[][]; part: Part; front: boolean }[];
  tree: { face: number; parent: number; a: number; b: number; angle: number; stage: number }[];
  rootRotation: [number, number, number, number];
  rootTranslation: Position;
  pivots: Partial<Record<Part, Position>>;
  stages: number;
}

export interface BakeResult extends BakedOrigami {
  uvs: [number, number][];
  creases: { a: number; b: number; assignment: 'M' | 'V' | 'F'; stage: number; faces: number[] }[];
  report: {
    faceCount: number; creaseCount: number; layers: number; area: number;
    wingspan: number; height: number; length: number; closure: number;
    worstStrain: number; rmsStrain: number; planarity: number;
    constraints: number;
    silhouette: Record<string, number | number[]>;
  };
}

/** Runtime geometry has micrometre precision; audit data stays in the bake report. */
export function runtimeData(data: BakeResult): BakedOrigami {
  const { uvs: _uvs, creases: _creases, report: _report, ...runtime } = data;
  return JSON.parse(JSON.stringify(runtime, (_key, value) => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value));
}
