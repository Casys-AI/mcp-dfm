/**
 * Pure-TypeScript geometry utilities over tessellated STL surfaces.
 *
 * All functions operate on arrays of triangles produced by parseAsciiStl and
 * perform no I/O. Unit system: mm throughout.
 *
 * @module lib/dfm/api/stl-geometry
 */

import type { Triangle } from "./gmsh.ts";

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
  /** Axis-aligned dimensions [dx, dy, dz] in mm. */
  size: [number, number, number];
}

/** Compute the axis-aligned bounding box from triangle vertices. */
export function computeBoundingBox(triangles: Triangle[]): BoundingBox {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const { vertices } of triangles) {
    for (const [x, y, z] of vertices) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/**
 * Compute the volume of a closed surface mesh via the divergence theorem.
 *
 * Accurate for watertight (closed) manifolds. Open shells return a meaningless
 * value — callers should validate closure before trusting the result.
 *
 * Formula: V = (1/6) * |Σ dot(v0, cross(v1, v2))|
 */
export function computeVolumeMm3(triangles: Triangle[]): number {
  let signedSum = 0;
  for (const { vertices: [v0, v1, v2] } of triangles) {
    // Scalar triple product: dot(v0, cross(v1, v2))
    const cx = v1[1] * v2[2] - v1[2] * v2[1];
    const cy = v1[2] * v2[0] - v1[0] * v2[2];
    const cz = v1[0] * v2[1] - v1[1] * v2[0];
    signedSum += v0[0] * cx + v0[1] * cy + v0[2] * cz;
  }
  return Math.abs(signedSum) / 6;
}

/** Compute the area of a single triangle in mm². */
export function triangleArea(
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
): number {
  const e1: [number, number, number] = [
    v1[0] - v0[0],
    v1[1] - v0[1],
    v1[2] - v0[2],
  ];
  const e2: [number, number, number] = [
    v2[0] - v0[0],
    v2[1] - v0[1],
    v2[2] - v0[2],
  ];
  const cx = e1[1] * e2[2] - e1[2] * e2[1];
  const cy = e1[2] * e2[0] - e1[0] * e2[2];
  const cz = e1[0] * e2[1] - e1[1] * e2[0];
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** Centroid of a triangle: average of the three vertices. */
export function triangleCentroid(
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
): [number, number, number] {
  return [
    (v0[0] + v1[0] + v2[0]) / 3,
    (v0[1] + v1[1] + v2[1]) / 3,
    (v0[2] + v1[2] + v2[2]) / 3,
  ];
}

/** Normalize a 3-vector; returns [0,0,0] for zero-length input. */
export function normalize(
  v: [number, number, number],
): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Dot product of two 3-vectors. */
export function dot(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Cross product of two 3-vectors. */
export function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Angle in degrees between the outward face normal and the downward direction
 * (-build_direction). This is the "overhang angle" used by DFM tools:
 *
 *   0°  → face points straight down  (worst overhang, always needs support)
 *  90°  → face is vertical           (no overhang from below)
 * 180°  → face points straight up    (self-supporting)
 *
 * A face with overhang angle < threshold requires supports.
 */
export function overhangAngleDeg(
  faceNormal: [number, number, number],
  buildDirection: [number, number, number],
): number {
  const n = normalize(faceNormal);
  const bd = normalize(buildDirection);
  // Downward direction = -build_direction
  const downward: [number, number, number] = [-bd[0], -bd[1], -bd[2]];
  const d = dot(n, downward);
  // Clamp to [-1, 1] before acos to handle floating-point rounding
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

export interface ViolationZone {
  /** Axis-aligned bounding box of all triangles in this cluster (mm). */
  bbox: BoundingBox;
  /** Total area of violation triangles in this zone (mm²). */
  area_mm2: number;
  /** Representative centroid of the cluster (mm). */
  centroid_mm: [number, number, number];
}

/**
 * Cluster an array of (centroid, area) pairs into spatial zones.
 *
 * Uses a simple greedy grouping: points within `clusterRadius` mm of each
 * other's bounding box are merged. This is not DBSCAN — it is intentionally
 * simple and deterministic.
 */
export function clusterViolations(
  items: {
    centroid: [number, number, number];
    area: number;
    vertices: Triangle["vertices"];
  }[],
  clusterRadius: number,
): ViolationZone[] {
  if (items.length === 0) return [];

  // Build one zone per item, then merge overlapping zones.
  const zones: Array<{
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    area: number;
    count: number;
    cx: number;
    cy: number;
    cz: number;
  }> = [];

  for (const { centroid, area, vertices } of items) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of vertices) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    zones.push({
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      area,
      count: 1,
      cx: centroid[0],
      cy: centroid[1],
      cz: centroid[2],
    });
  }

  // Merge zones whose expanded bounding boxes overlap.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i], b = zones[j];
        if (
          a.minX - clusterRadius <= b.maxX &&
          a.maxX + clusterRadius >= b.minX &&
          a.minY - clusterRadius <= b.maxY &&
          a.maxY + clusterRadius >= b.minY &&
          a.minZ - clusterRadius <= b.maxZ &&
          a.maxZ + clusterRadius >= b.minZ
        ) {
          // Merge b into a
          const totalArea = a.area + b.area;
          a.cx = (a.cx * a.count + b.cx * b.count) / (a.count + b.count);
          a.cy = (a.cy * a.count + b.cy * b.count) / (a.count + b.count);
          a.cz = (a.cz * a.count + b.cz * b.count) / (a.count + b.count);
          a.count += b.count;
          a.area = totalArea;
          a.minX = Math.min(a.minX, b.minX);
          a.minY = Math.min(a.minY, b.minY);
          a.minZ = Math.min(a.minZ, b.minZ);
          a.maxX = Math.max(a.maxX, b.maxX);
          a.maxY = Math.max(a.maxY, b.maxY);
          a.maxZ = Math.max(a.maxZ, b.maxZ);
          zones.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  return zones.map((z) => ({
    bbox: {
      min: [z.minX, z.minY, z.minZ],
      max: [z.maxX, z.maxY, z.maxZ],
      size: [z.maxX - z.minX, z.maxY - z.minY, z.maxZ - z.minZ],
    },
    area_mm2: z.area,
    centroid_mm: [z.cx, z.cy, z.cz],
  }));
}
