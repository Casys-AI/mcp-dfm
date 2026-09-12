/**
 * Discriminated raw DFM tool results for the shared results-viewer resource.
 *
 * Live tool outputs keep their text fallback. This parser never invents a
 * whole-case manufacturable verdict. Optional quality fields that a result
 * does not carry remain unavailable rather than defaulted.
 */

import {
  DFM_ENVELOPE_RAW_SCHEMA,
  DFM_ENVELOPE_TOOL,
  DFM_OVERHANG_TOOL,
  DFM_OVERHANGS_RAW_SCHEMA,
  DFM_THICKNESS_RAW_SCHEMA,
  DFM_THICKNESS_TOOL,
  QUALITY_ABSENT_ON_RESULT_REASON,
} from "./identities.ts";
import {
  denseArray,
  digest,
  exactRecord,
  finiteNumber,
  nonNegativeInteger,
  nonNegativeNumber,
  positiveInteger,
  positiveNumber,
  record,
  strings,
  vector3,
} from "./json.ts";
import type { DfmEnvelopeAxisViolation, DfmZone } from "./recorded-checks.ts";

export type DfmQuality<T> =
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "available"; readonly value: T };

export interface DfmMeshTopology {
  readonly closed: boolean;
  readonly watertight: boolean;
  readonly manifold: boolean;
  readonly orientation_consistent: boolean;
  readonly connected_component_count: number;
  readonly boundary_edge_count: number;
  readonly non_manifold_edge_count: number;
  readonly non_manifold_vertex_count: number;
  readonly degenerate_triangle_count: number;
}

export interface DfmRayCoverage {
  readonly sampled_triangle_count: number;
  readonly valid_ray_count: number;
  readonly unresolved_ray_count: number;
  readonly complete: boolean;
}

export interface DfmRawEnvelopeResult {
  readonly schemaVersion: typeof DFM_ENVELOPE_RAW_SCHEMA;
  readonly kind: "dfm-envelope-raw";
  readonly tool: typeof DFM_ENVELOPE_TOOL;
  readonly measured: {
    readonly xMm: number;
    readonly yMm: number;
    readonly zMm: number;
    readonly volumeMm3: number;
  };
  readonly declaredVolumeMm: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly violations: readonly DfmEnvelopeAxisViolation[];
  readonly notChecked: readonly string[];
  readonly inputArtifact: { readonly sha256: string; readonly bytes: number };
  readonly volumeStatus: DfmQuality<"computed" | "unverified">;
  readonly mass: DfmQuality<{
    readonly status: "not_requested" | "computed" | "unverified";
    readonly massKg?: number;
  }>;
  readonly meshTopology: DfmQuality<DfmMeshTopology>;
}

export interface DfmRawThicknessResult {
  readonly schemaVersion: typeof DFM_THICKNESS_RAW_SCHEMA;
  readonly kind: "dfm-min-thickness-raw";
  readonly tool: typeof DFM_THICKNESS_TOOL;
  readonly measured: {
    readonly minThicknessMm: number | null;
    readonly minPositionMm: readonly [number, number, number] | null;
    readonly sampleCount: number;
    readonly validRayCount: number;
  };
  readonly thresholdMm: number;
  readonly violations: readonly DfmZone[];
  readonly notChecked: readonly string[];
  readonly inputArtifact: { readonly sha256: string; readonly bytes: number };
  readonly minimumThicknessStatus: DfmQuality<"sampled" | "unverified">;
  readonly rayCoverage: DfmQuality<DfmRayCoverage>;
  readonly meshTopology: DfmQuality<DfmMeshTopology>;
}

export interface DfmRawOverhangResult {
  readonly schemaVersion: typeof DFM_OVERHANGS_RAW_SCHEMA;
  readonly kind: "dfm-overhangs-raw";
  readonly tool: typeof DFM_OVERHANG_TOOL;
  readonly measured: {
    readonly totalSurfaceAreaMm2: number;
    readonly overhangAreaMm2: number;
    readonly overhangTriangleCount: number;
    readonly totalTriangleCount: number;
  };
  readonly thresholdDeg: number;
  readonly buildDirection: readonly [number, number, number];
  readonly violations: readonly DfmZone[];
  readonly notChecked: readonly string[];
  readonly inputArtifact: { readonly sha256: string; readonly bytes: number };
  readonly meshTopology: DfmQuality<DfmMeshTopology>;
}

export type DfmRawToolResult =
  | DfmRawEnvelopeResult
  | DfmRawThicknessResult
  | DfmRawOverhangResult;

/** Parse one live DFM tool structuredContent without a whole-case verdict. */
export function parseDfmRawToolResult(value: unknown): DfmRawToolResult {
  const root = record(value, "dfm raw result");
  if (isEnvelopeRaw(root)) return parseEnvelopeRaw(root);
  if (isThicknessRaw(root)) return parseThicknessRaw(root);
  if (isOverhangRaw(root)) return parseOverhangRaw(root);
  throw new TypeError(
    "Expected a dfm_check_envelope, dfm_check_min_thickness or dfm_check_overhangs result.",
  );
}

function isEnvelopeRaw(root: Record<string, unknown>): boolean {
  return isRecord(root.limits_declared) &&
    isRecord((root.limits_declared as Record<string, unknown>).build_volume_mm);
}

function isThicknessRaw(root: Record<string, unknown>): boolean {
  return isRecord(root.limits_declared) &&
    "min_thickness_mm" in (root.limits_declared as Record<string, unknown>);
}

function isOverhangRaw(root: Record<string, unknown>): boolean {
  return isRecord(root.limits_declared) &&
    "max_overhang_deg" in (root.limits_declared as Record<string, unknown>);
}

function parseEnvelopeRaw(root: Record<string, unknown>): DfmRawEnvelopeResult {
  const measured = record(root.measured, "dfm_check_envelope.measured");
  const limits = record(root.limits_declared, "dfm_check_envelope.limits_declared");
  const volume = record(
    limits.build_volume_mm,
    "dfm_check_envelope.limits_declared.build_volume_mm",
  );
  const input = parseInputArtifact(
    root.input_artifact,
    "dfm_check_envelope.input_artifact",
  );
  return {
    schemaVersion: DFM_ENVELOPE_RAW_SCHEMA,
    kind: "dfm-envelope-raw",
    tool: DFM_ENVELOPE_TOOL,
    measured: {
      xMm: nonNegativeNumber(measured.x_mm, "dfm_check_envelope.measured.x_mm"),
      yMm: nonNegativeNumber(measured.y_mm, "dfm_check_envelope.measured.y_mm"),
      zMm: nonNegativeNumber(measured.z_mm, "dfm_check_envelope.measured.z_mm"),
      volumeMm3: nonNegativeNumber(
        measured.volume_mm3,
        "dfm_check_envelope.measured.volume_mm3",
      ),
    },
    declaredVolumeMm: {
      x: positiveNumber(
        volume.x,
        "dfm_check_envelope.limits_declared.build_volume_mm.x",
      ),
      y: positiveNumber(
        volume.y,
        "dfm_check_envelope.limits_declared.build_volume_mm.y",
      ),
      z: positiveNumber(
        volume.z,
        "dfm_check_envelope.limits_declared.build_volume_mm.z",
      ),
    },
    violations: parseEnvelopeViolations(
      root.violations,
      "dfm_check_envelope.violations",
    ),
    notChecked: parseNotChecked(root.not_checked, "dfm_check_envelope.not_checked"),
    inputArtifact: input,
    volumeStatus: optionalEnum(
      measured.volume_status,
      ["computed", "unverified"] as const,
      "dfm_check_envelope.measured.volume_status",
    ),
    mass: parseMassQuality(measured),
    meshTopology: optionalMeshTopology(
      root.mesh_topology,
      "dfm_check_envelope.mesh_topology",
    ),
  };
}

function parseThicknessRaw(root: Record<string, unknown>): DfmRawThicknessResult {
  const measured = record(root.measured, "dfm_check_min_thickness.measured");
  const limits = record(
    root.limits_declared,
    "dfm_check_min_thickness.limits_declared",
  );
  const sampleCount = nonNegativeInteger(
    measured.sample_count,
    "dfm_check_min_thickness.measured.sample_count",
  );
  const validRayCount = nonNegativeInteger(
    measured.valid_ray_count,
    "dfm_check_min_thickness.measured.valid_ray_count",
  );
  if (validRayCount > sampleCount) {
    throw new TypeError(
      "dfm_check_min_thickness valid_ray_count must not exceed sample_count.",
    );
  }
  return {
    schemaVersion: DFM_THICKNESS_RAW_SCHEMA,
    kind: "dfm-min-thickness-raw",
    tool: DFM_THICKNESS_TOOL,
    measured: {
      minThicknessMm: nullableNonNegative(
        measured.min_thickness_mm,
        "dfm_check_min_thickness.measured.min_thickness_mm",
      ),
      minPositionMm: nullableVector3(
        measured.min_position_mm,
        "dfm_check_min_thickness.measured.min_position_mm",
      ),
      sampleCount,
      validRayCount,
    },
    thresholdMm: positiveNumber(
      limits.min_thickness_mm,
      "dfm_check_min_thickness.limits_declared.min_thickness_mm",
    ),
    violations: parseZones(root.violations, "dfm_check_min_thickness.violations"),
    notChecked: parseNotChecked(
      root.not_checked,
      "dfm_check_min_thickness.not_checked",
    ),
    inputArtifact: parseInputArtifact(
      root.input_artifact,
      "dfm_check_min_thickness.input_artifact",
    ),
    minimumThicknessStatus: optionalEnum(
      measured.minimum_thickness_status,
      ["sampled", "unverified"] as const,
      "dfm_check_min_thickness.measured.minimum_thickness_status",
    ),
    rayCoverage: optionalRayCoverage(root.ray_coverage),
    meshTopology: optionalMeshTopology(
      root.mesh_topology,
      "dfm_check_min_thickness.mesh_topology",
    ),
  };
}

function parseOverhangRaw(root: Record<string, unknown>): DfmRawOverhangResult {
  const measured = record(root.measured, "dfm_check_overhangs.measured");
  const limits = record(root.limits_declared, "dfm_check_overhangs.limits_declared");
  const totalSurfaceAreaMm2 = nonNegativeNumber(
    measured.total_surface_area_mm2,
    "dfm_check_overhangs.measured.total_surface_area_mm2",
  );
  const overhangAreaMm2 = nonNegativeNumber(
    measured.overhang_area_mm2,
    "dfm_check_overhangs.measured.overhang_area_mm2",
  );
  if (overhangAreaMm2 > totalSurfaceAreaMm2) {
    throw new TypeError(
      "dfm_check_overhangs overhang_area_mm2 must not exceed total_surface_area_mm2.",
    );
  }
  const overhangTriangleCount = nonNegativeInteger(
    measured.overhang_triangle_count,
    "dfm_check_overhangs.measured.overhang_triangle_count",
  );
  const totalTriangleCount = nonNegativeInteger(
    measured.total_triangle_count,
    "dfm_check_overhangs.measured.total_triangle_count",
  );
  if (overhangTriangleCount > totalTriangleCount) {
    throw new TypeError(
      "dfm_check_overhangs overhang_triangle_count must not exceed total_triangle_count.",
    );
  }
  const thresholdDeg = finiteNumber(
    limits.max_overhang_deg,
    "dfm_check_overhangs.limits_declared.max_overhang_deg",
  );
  if (thresholdDeg < 0 || thresholdDeg > 90) {
    throw new TypeError(
      "dfm_check_overhangs.limits_declared.max_overhang_deg must be between 0 and 90.",
    );
  }
  return {
    schemaVersion: DFM_OVERHANGS_RAW_SCHEMA,
    kind: "dfm-overhangs-raw",
    tool: DFM_OVERHANG_TOOL,
    measured: {
      totalSurfaceAreaMm2,
      overhangAreaMm2,
      overhangTriangleCount,
      totalTriangleCount,
    },
    thresholdDeg,
    buildDirection: vector3(
      limits.build_direction,
      "dfm_check_overhangs.limits_declared.build_direction",
    ),
    violations: parseZones(root.violations, "dfm_check_overhangs.violations"),
    notChecked: parseNotChecked(root.not_checked, "dfm_check_overhangs.not_checked"),
    inputArtifact: parseInputArtifact(
      root.input_artifact,
      "dfm_check_overhangs.input_artifact",
    ),
    meshTopology: optionalMeshTopology(
      root.mesh_topology,
      "dfm_check_overhangs.mesh_topology",
    ),
  };
}

function parseInputArtifact(
  value: unknown,
  name: string,
): { sha256: string; bytes: number } {
  const root = record(value, name);
  return {
    sha256: digest(root.sha256, `${name}.sha256`),
    bytes: positiveInteger(root.bytes, `${name}.bytes`),
  };
}

function parseNotChecked(value: unknown, name: string): readonly string[] {
  if (value === undefined) return [];
  return strings(value, name);
}

function parseEnvelopeViolations(
  value: unknown,
  name: string,
): readonly DfmEnvelopeAxisViolation[] {
  return denseArray(value, name).map((item, index) => {
    const rec = record(item, `${name}[${index}]`);
    const axis = rec.axis;
    if (axis !== "x" && axis !== "y" && axis !== "z") {
      throw new TypeError(`${name}[${index}].axis must be x, y or z.`);
    }
    return {
      axis,
      measured_mm: nonNegativeNumber(rec.measured_mm, `${name}[${index}].measured_mm`),
      limit_mm: nonNegativeNumber(rec.limit_mm, `${name}[${index}].limit_mm`),
    };
  });
}

function parseZones(value: unknown, name: string): readonly DfmZone[] {
  return denseArray(value, name).map((item, index) => {
    const zone = record(item, `${name}[${index}]`);
    return {
      area_mm2: nonNegativeNumber(zone.area_mm2, `${name}[${index}].area_mm2`),
      centroid_mm: vector3(zone.centroid_mm, `${name}[${index}].centroid_mm`),
    };
  });
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): DfmQuality<T> {
  if (value === undefined) {
    return { status: "unavailable", reason: QUALITY_ABSENT_ON_RESULT_REASON };
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${name} is not a supported quality value.`);
  }
  return { status: "available", value: value as T };
}

function parseMassQuality(
  measured: Record<string, unknown>,
): DfmRawEnvelopeResult["mass"] {
  if (measured.mass_status === undefined) {
    return { status: "unavailable", reason: QUALITY_ABSENT_ON_RESULT_REASON };
  }
  if (
    measured.mass_status !== "not_requested" &&
    measured.mass_status !== "computed" &&
    measured.mass_status !== "unverified"
  ) {
    throw new TypeError("dfm_check_envelope.measured.mass_status is invalid.");
  }
  if (measured.mass_status === "computed") {
    return {
      status: "available",
      value: {
        status: "computed",
        massKg: nonNegativeNumber(
          measured.mass_kg,
          "dfm_check_envelope.measured.mass_kg",
        ),
      },
    };
  }
  return { status: "available", value: { status: measured.mass_status } };
}

function optionalMeshTopology(
  value: unknown,
  name: string,
): DfmQuality<DfmMeshTopology> {
  if (value === undefined) {
    return { status: "unavailable", reason: QUALITY_ABSENT_ON_RESULT_REASON };
  }
  const root = exactRecord(value, [
    "closed",
    "watertight",
    "manifold",
    "orientation_consistent",
    "connected_component_count",
    "boundary_edge_count",
    "non_manifold_edge_count",
    "non_manifold_vertex_count",
    "degenerate_triangle_count",
  ], name);
  return {
    status: "available",
    value: {
      closed: requireBoolean(root.closed, `${name}.closed`),
      watertight: requireBoolean(root.watertight, `${name}.watertight`),
      manifold: requireBoolean(root.manifold, `${name}.manifold`),
      orientation_consistent: requireBoolean(
        root.orientation_consistent,
        `${name}.orientation_consistent`,
      ),
      connected_component_count: nonNegativeInteger(
        root.connected_component_count,
        `${name}.connected_component_count`,
      ),
      boundary_edge_count: nonNegativeInteger(
        root.boundary_edge_count,
        `${name}.boundary_edge_count`,
      ),
      non_manifold_edge_count: nonNegativeInteger(
        root.non_manifold_edge_count,
        `${name}.non_manifold_edge_count`,
      ),
      non_manifold_vertex_count: nonNegativeInteger(
        root.non_manifold_vertex_count,
        `${name}.non_manifold_vertex_count`,
      ),
      degenerate_triangle_count: nonNegativeInteger(
        root.degenerate_triangle_count,
        `${name}.degenerate_triangle_count`,
      ),
    },
  };
}

function optionalRayCoverage(value: unknown): DfmQuality<DfmRayCoverage> {
  if (value === undefined) {
    return { status: "unavailable", reason: QUALITY_ABSENT_ON_RESULT_REASON };
  }
  const root = exactRecord(value, [
    "sampled_triangle_count",
    "valid_ray_count",
    "unresolved_ray_count",
    "complete",
  ], "dfm_check_min_thickness.ray_coverage");
  return {
    status: "available",
    value: {
      sampled_triangle_count: nonNegativeInteger(
        root.sampled_triangle_count,
        "dfm_check_min_thickness.ray_coverage.sampled_triangle_count",
      ),
      valid_ray_count: nonNegativeInteger(
        root.valid_ray_count,
        "dfm_check_min_thickness.ray_coverage.valid_ray_count",
      ),
      unresolved_ray_count: nonNegativeInteger(
        root.unresolved_ray_count,
        "dfm_check_min_thickness.ray_coverage.unresolved_ray_count",
      ),
      complete: requireBoolean(
        root.complete,
        "dfm_check_min_thickness.ray_coverage.complete",
      ),
    },
  };
}

function nullableNonNegative(value: unknown, name: string): number | null {
  if (value === null) return null;
  return nonNegativeNumber(value, name);
}

function nullableVector3(
  value: unknown,
  name: string,
): [number, number, number] | null {
  if (value === null) return null;
  return vector3(value, name);
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
