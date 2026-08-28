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

/**
 * Topological evidence derived from the exact triangles emitted by the current
 * Gmsh tessellation. It is deliberately a mesh property, not a claim about
 * the source CAD model or a manufacturing verdict.
 */
export interface MeshTopology {
  /** No boundary edges in the tessellated surface. */
  closed: boolean;
  /**
   * A locally watertight component graph: closed, manifold, consistently
   * oriented, and free of degenerate triangles. This does not classify the
   * global orientation or nesting of multiple disconnected shells.
   */
  watertight: boolean;
  /** Edge and vertex-link manifold check on this tessellated surface. */
  manifold: boolean;
  /** Every shared edge has two oppositely directed triangle uses. */
  orientation_consistent: boolean;
  /** Connected components formed by triangles sharing a tessellated vertex. */
  connected_component_count: number;
  /** Edges with exactly one incident triangle. */
  boundary_edge_count: number;
  /** Edges with more than two incident triangles. */
  non_manifold_edge_count: number;
  /** Vertices whose incident-triangle link is not one manifold fan. */
  non_manifold_vertex_count: number;
  /** Triangles with repeated, non-finite, or zero-area vertices. */
  degenerate_triangle_count: number;
}

interface EdgeUse {
  direction: 1 | -1;
}

interface EdgeRecord {
  vertices: [number, number];
  uses: EdgeUse[];
}

/**
 * Check the topology of a tessellated surface without introducing a second
 * geometry runtime. Coordinate identity is intentional here: the input is the
 * single ASCII STL snapshot emitted by Gmsh, so shared mesh vertices carry the
 * same parsed coordinates.
 */
export function analyzeMeshTopology(triangles: Triangle[]): MeshTopology {
  if (triangles.length === 0) {
    return {
      closed: false,
      watertight: false,
      manifold: false,
      orientation_consistent: false,
      connected_component_count: 0,
      boundary_edge_count: 0,
      non_manifold_edge_count: 0,
      non_manifold_vertex_count: 0,
      degenerate_triangle_count: 0,
    };
  }

  const vertexIds = new Map<string, number>();
  const firstTriangleByVertex = new Map<number, number>();
  const edgeRecords = new Map<string, EdgeRecord>();
  const vertexLinkEdges = new Map<number, Array<[number, number]>>();
  const parents = triangles.map((_, index) => index);
  let degenerateTriangleCount = 0;

  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };

  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  const vertexId = (vertex: [number, number, number]): number => {
    const normalized = vertex.map((coordinate) =>
      Object.is(coordinate, -0) ? 0 : coordinate
    );
    const key = normalized.join(",");
    const existing = vertexIds.get(key);
    if (existing !== undefined) return existing;
    const created = vertexIds.size;
    vertexIds.set(key, created);
    return created;
  };

  const recordEdge = (start: number, end: number): void => {
    if (start === end) return;
    const [low, high] = start < end ? [start, end] : [end, start];
    const key = `${low}:${high}`;
    const record = edgeRecords.get(key) ?? {
      vertices: [low, high],
      uses: [],
    };
    record.uses.push({ direction: start === low ? 1 : -1 });
    edgeRecords.set(key, record);
  };

  const recordLink = (center: number, left: number, right: number): void => {
    const links = vertexLinkEdges.get(center) ?? [];
    links.push([left, right]);
    vertexLinkEdges.set(center, links);
  };

  for (const [triangleIndex, triangle] of triangles.entries()) {
    const ids = triangle.vertices.map(vertexId) as [number, number, number];
    for (const id of ids) {
      const first = firstTriangleByVertex.get(id);
      if (first === undefined) firstTriangleByVertex.set(id, triangleIndex);
      else union(first, triangleIndex);
    }

    const allFinite = triangle.vertices.every((vertex) =>
      vertex.every((coordinate) => Number.isFinite(coordinate))
    );
    const hasRepeatedVertex = new Set(ids).size !== 3;
    const area = triangleArea(
      triangle.vertices[0],
      triangle.vertices[1],
      triangle.vertices[2],
    );
    if (!allFinite || hasRepeatedVertex || !Number.isFinite(area) || area <= 1e-12) {
      degenerateTriangleCount++;
      continue;
    }

    recordEdge(ids[0], ids[1]);
    recordEdge(ids[1], ids[2]);
    recordEdge(ids[2], ids[0]);
    recordLink(ids[0], ids[1], ids[2]);
    recordLink(ids[1], ids[2], ids[0]);
    recordLink(ids[2], ids[0], ids[1]);
  }

  const boundaryVertices = new Set<number>();
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let orientationConsistent = degenerateTriangleCount === 0;

  for (const record of edgeRecords.values()) {
    if (record.uses.length === 1) {
      boundaryEdgeCount++;
      boundaryVertices.add(record.vertices[0]);
      boundaryVertices.add(record.vertices[1]);
    } else if (record.uses.length > 2) {
      nonManifoldEdgeCount++;
      orientationConsistent = false;
    } else if (record.uses[0].direction === record.uses[1].direction) {
      orientationConsistent = false;
    }
  }

  let nonManifoldVertexCount = 0;
  for (const [center, links] of vertexLinkEdges) {
    const degrees = new Map<number, number>();
    const neighbors = new Map<number, Set<number>>();
    for (const [left, right] of links) {
      degrees.set(left, (degrees.get(left) ?? 0) + 1);
      degrees.set(right, (degrees.get(right) ?? 0) + 1);
      const leftNeighbors = neighbors.get(left) ?? new Set<number>();
      leftNeighbors.add(right);
      neighbors.set(left, leftNeighbors);
      const rightNeighbors = neighbors.get(right) ?? new Set<number>();
      rightNeighbors.add(left);
      neighbors.set(right, rightNeighbors);
    }

    const firstNeighbor = degrees.keys().next().value as number | undefined;
    const visited = new Set<number>();
    if (firstNeighbor !== undefined) {
      const stack = [firstNeighbor];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const adjacent of neighbors.get(current) ?? []) stack.push(adjacent);
      }
    }

    const degreeValues = [...degrees.values()];
    const connected = visited.size === degrees.size && degrees.size > 0;
    const hasBoundary = boundaryVertices.has(center);
    const validFan = hasBoundary
      ? degreeValues.filter((degree) => degree === 1).length === 2 &&
        degreeValues.every((degree) => degree === 1 || degree === 2)
      : degreeValues.every((degree) => degree === 2);
    if (!connected || !validFan) nonManifoldVertexCount++;
  }

  const componentRoots = new Set<number>();
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) {
    componentRoots.add(find(triangleIndex));
  }

  const manifold = degenerateTriangleCount === 0 &&
    nonManifoldEdgeCount === 0 && nonManifoldVertexCount === 0;
  const closed = degenerateTriangleCount === 0 && boundaryEdgeCount === 0;

  return {
    closed,
    watertight: closed && manifold && orientationConsistent,
    manifold,
    orientation_consistent: orientationConsistent,
    connected_component_count: componentRoots.size,
    boundary_edge_count: boundaryEdgeCount,
    non_manifold_edge_count: nonManifoldEdgeCount,
    non_manifold_vertex_count: nonManifoldVertexCount,
    degenerate_triangle_count: degenerateTriangleCount,
  };
}

/**
 * Establish the narrow volume subset this mesh-only pass can support.
 *
 * With exactly one watertight component, the absolute divergence-theorem
 * magnitude is invariant if the complete shell is globally reversed, and
 * there is no second shell whose nesting or orientation could alter a material
 * volume. More than one component is deliberately left unverified: this
 * lightweight topology pass does not prove global shell containment or resolve
 * their relative orientation.
 */
export function hasSingleShellVolumeEvidence(topology: MeshTopology): boolean {
  return topology.watertight && topology.connected_component_count === 1;
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
 * Compute the numerical absolute divergence-theorem volume of a surface mesh.
 *
 * A single watertight component has orientation-invariant magnitude. Multiple
 * components are summed before the absolute value, so their relative global
 * orientation can cancel; callers must use hasSingleShellVolumeEvidence before
 * treating this as a computed material volume. Open shells also return only a
 * diagnostic numerical value.
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
 * A face with overhang angle < threshold is reported against that caller-declared limit.
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
