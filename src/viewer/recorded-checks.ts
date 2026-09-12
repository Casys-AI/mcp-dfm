/**
 * Sanitized recorded DFM checks projection.
 *
 * This is the provider-owned view of a Digital Thread DfmCheckCapture.
 * Private staged paths and commands are refused. Mesh/BRep geometry is not
 * invented. Quality fields that historical captures do not record stay absent
 * from this schema; the viewer labels them unavailable.
 */

import {
  DFM_ENVELOPE_TOOL,
  DFM_OVERHANG_TOOL,
  DFM_RECORDED_CHECKS_SCHEMA,
  DFM_TARGET_MEDIA_TYPE,
  DFM_THICKNESS_TOOL,
  DIGITAL_THREAD_EVALUATION_OWNER,
} from "./identities.ts";
import {
  canonicalTimestamp,
  denseArray,
  digest,
  exactRecord,
  fingerprint,
  finiteNumber,
  literal,
  nonEmpty,
  nonNegativeInteger,
  nonNegativeNumber,
  nonZeroVector3,
  positiveInteger,
  positiveNumber,
  strings,
  vector3,
} from "./json.ts";

export type DfmCheckName = "envelope" | "min-thickness" | "overhangs";
export type DfmCheckStatus = "pass" | "fail";
export type DfmEnvelopeAxis = "x" | "y" | "z";

export interface DfmEnvelopeAxisViolation {
  readonly axis: DfmEnvelopeAxis;
  readonly measured_mm: number;
  readonly limit_mm: number;
}

export interface DfmZone {
  readonly area_mm2: number;
  readonly centroid_mm: readonly [number, number, number];
}

export interface DfmNamedViolation {
  readonly name: string;
  readonly check: DfmCheckName;
  readonly summary: string;
}

export interface DfmCheckVerdict {
  readonly check: DfmCheckName;
  readonly status: DfmCheckStatus;
  readonly violations: readonly DfmNamedViolation[];
}

export interface DfmZMinFilterTrace {
  readonly declared: {
    readonly enabled: boolean;
    readonly planeZMm: { readonly value: number; readonly unit: "mm" };
    readonly toleranceMm: { readonly value: number; readonly unit: "mm" };
  };
  readonly applied: boolean;
  readonly filtered: readonly {
    readonly area_mm2: number;
    readonly centroid_mm: readonly [number, number, number];
    readonly reason: "z-min-bed-contact";
    readonly centroidZMm: number;
  }[];
  readonly remaining: readonly DfmZone[];
}

export interface DfmRecordedEnvelope {
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
  readonly inputArtifactSha256: string;
}

export interface DfmRecordedThickness {
  readonly tool: typeof DFM_THICKNESS_TOOL;
  readonly measured: {
    readonly minThicknessMm: number;
    readonly minPositionMm: readonly [number, number, number];
    readonly sampleCount: number;
    readonly validRayCount: number;
  };
  readonly thresholdMm: number;
  readonly violations: readonly DfmZone[];
  readonly notChecked: readonly string[];
  readonly inputArtifactSha256: string;
}

export interface DfmRecordedOverhang {
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
  readonly inputArtifactSha256: string;
}

export interface DfmRecordedEvaluations {
  readonly owner: typeof DIGITAL_THREAD_EVALUATION_OWNER;
  readonly status: DfmCheckStatus;
  readonly verdicts: readonly DfmCheckVerdict[];
}

export interface DfmRecordedChecksResult {
  readonly schemaVersion: typeof DFM_RECORDED_CHECKS_SCHEMA;
  readonly kind: "digital-thread-measured-checks";
  readonly capture: {
    readonly schemaVersion: "dfm-check-capture/1.0";
    readonly fingerprint: string;
    readonly capturedAt: string;
    readonly dispatchedAt: string;
  };
  readonly geometry: {
    readonly artifactId: string;
    readonly sha256: string;
    readonly byteCount: number;
    readonly mediaType: typeof DFM_TARGET_MEDIA_TYPE;
  };
  readonly caseDigest: string;
  readonly envelope: DfmRecordedEnvelope;
  readonly thickness: DfmRecordedThickness;
  readonly overhang: DfmRecordedOverhang;
  readonly zMinFilter: DfmZMinFilterTrace;
  readonly evaluations: DfmRecordedEvaluations;
  readonly limitations: readonly string[];
}

export function parseDfmRecordedChecksResult(
  value: unknown,
): DfmRecordedChecksResult {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "capture",
    "geometry",
    "caseDigest",
    "envelope",
    "thickness",
    "overhang",
    "zMinFilter",
    "evaluations",
    "limitations",
  ], "recorded checks");
  literal(
    root.schemaVersion,
    DFM_RECORDED_CHECKS_SCHEMA,
    "recorded checks.schemaVersion",
  );
  literal(root.kind, "digital-thread-measured-checks", "recorded checks.kind");
  const capture = exactRecord(
    root.capture,
    ["schemaVersion", "fingerprint", "capturedAt", "dispatchedAt"],
    "recorded checks.capture",
  );
  literal(
    capture.schemaVersion,
    "dfm-check-capture/1.0",
    "recorded checks.capture.schemaVersion",
  );
  const geometry = exactRecord(
    root.geometry,
    ["artifactId", "sha256", "byteCount", "mediaType"],
    "recorded checks.geometry",
  );
  literal(
    geometry.mediaType,
    DFM_TARGET_MEDIA_TYPE,
    "recorded checks.geometry.mediaType",
  );
  const geometrySha256 = digest(geometry.sha256, "recorded checks.geometry.sha256");
  const envelope = parseEnvelope(root.envelope, geometrySha256);
  const thickness = parseThickness(root.thickness, geometrySha256);
  const overhang = parseOverhang(root.overhang, geometrySha256);
  return {
    schemaVersion: DFM_RECORDED_CHECKS_SCHEMA,
    kind: "digital-thread-measured-checks",
    capture: {
      schemaVersion: "dfm-check-capture/1.0",
      fingerprint: fingerprint(
        capture.fingerprint,
        "recorded checks.capture.fingerprint",
      ),
      capturedAt: canonicalTimestamp(
        capture.capturedAt,
        "recorded checks.capture.capturedAt",
      ),
      dispatchedAt: canonicalTimestamp(
        capture.dispatchedAt,
        "recorded checks.capture.dispatchedAt",
      ),
    },
    geometry: {
      artifactId: nonEmpty(
        geometry.artifactId,
        "recorded checks.geometry.artifactId",
      ),
      sha256: geometrySha256,
      byteCount: positiveInteger(
        geometry.byteCount,
        "recorded checks.geometry.byteCount",
      ),
      mediaType: DFM_TARGET_MEDIA_TYPE,
    },
    caseDigest: digest(root.caseDigest, "recorded checks.caseDigest"),
    envelope,
    thickness,
    overhang,
    zMinFilter: parseZMinFilter(root.zMinFilter),
    evaluations: parseEvaluations(root.evaluations),
    limitations: strings(root.limitations, "recorded checks.limitations"),
  };
}

function parseEnvelope(
  value: unknown,
  expectedSha256: string,
): DfmRecordedEnvelope {
  const root = exactRecord(value, [
    "tool",
    "measured",
    "declaredVolumeMm",
    "violations",
    "notChecked",
    "inputArtifactSha256",
  ], "recorded checks.envelope");
  literal(root.tool, DFM_ENVELOPE_TOOL, "recorded checks.envelope.tool");
  const measured = exactRecord(
    root.measured,
    ["xMm", "yMm", "zMm", "volumeMm3"],
    "recorded checks.envelope.measured",
  );
  const declared = exactRecord(
    root.declaredVolumeMm,
    ["x", "y", "z"],
    "recorded checks.envelope.declaredVolumeMm",
  );
  const sha256 = digest(
    root.inputArtifactSha256,
    "recorded checks.envelope.inputArtifactSha256",
  );
  if (sha256 !== expectedSha256) {
    throw new TypeError(
      "recorded checks.envelope.inputArtifactSha256 does not match geometry.",
    );
  }
  return {
    tool: DFM_ENVELOPE_TOOL,
    measured: {
      xMm: nonNegativeNumber(
        measured.xMm,
        "recorded checks.envelope.measured.xMm",
      ),
      yMm: nonNegativeNumber(
        measured.yMm,
        "recorded checks.envelope.measured.yMm",
      ),
      zMm: nonNegativeNumber(
        measured.zMm,
        "recorded checks.envelope.measured.zMm",
      ),
      volumeMm3: nonNegativeNumber(
        measured.volumeMm3,
        "recorded checks.envelope.measured.volumeMm3",
      ),
    },
    declaredVolumeMm: {
      x: positiveNumber(
        declared.x,
        "recorded checks.envelope.declaredVolumeMm.x",
      ),
      y: positiveNumber(
        declared.y,
        "recorded checks.envelope.declaredVolumeMm.y",
      ),
      z: positiveNumber(
        declared.z,
        "recorded checks.envelope.declaredVolumeMm.z",
      ),
    },
    violations: parseEnvelopeViolations(
      root.violations,
      "recorded checks.envelope.violations",
    ),
    notChecked: strings(
      root.notChecked,
      "recorded checks.envelope.notChecked",
    ),
    inputArtifactSha256: sha256,
  };
}

function parseThickness(
  value: unknown,
  expectedSha256: string,
): DfmRecordedThickness {
  const root = exactRecord(value, [
    "tool",
    "measured",
    "thresholdMm",
    "violations",
    "notChecked",
    "inputArtifactSha256",
  ], "recorded checks.thickness");
  literal(root.tool, DFM_THICKNESS_TOOL, "recorded checks.thickness.tool");
  const measured = exactRecord(root.measured, [
    "minThicknessMm",
    "minPositionMm",
    "sampleCount",
    "validRayCount",
  ], "recorded checks.thickness.measured");
  const sampleCount = nonNegativeInteger(
    measured.sampleCount,
    "recorded checks.thickness.measured.sampleCount",
  );
  const validRayCount = nonNegativeInteger(
    measured.validRayCount,
    "recorded checks.thickness.measured.validRayCount",
  );
  if (validRayCount > sampleCount) {
    throw new TypeError(
      "recorded checks.thickness validRayCount must not exceed sampleCount.",
    );
  }
  const sha256 = digest(
    root.inputArtifactSha256,
    "recorded checks.thickness.inputArtifactSha256",
  );
  if (sha256 !== expectedSha256) {
    throw new TypeError(
      "recorded checks.thickness.inputArtifactSha256 does not match geometry.",
    );
  }
  return {
    tool: DFM_THICKNESS_TOOL,
    measured: {
      minThicknessMm: nonNegativeNumber(
        measured.minThicknessMm,
        "recorded checks.thickness.measured.minThicknessMm",
      ),
      minPositionMm: vector3(
        measured.minPositionMm,
        "recorded checks.thickness.measured.minPositionMm",
      ),
      sampleCount,
      validRayCount,
    },
    thresholdMm: positiveNumber(
      root.thresholdMm,
      "recorded checks.thickness.thresholdMm",
    ),
    violations: parseZones(
      root.violations,
      "recorded checks.thickness.violations",
    ),
    notChecked: strings(
      root.notChecked,
      "recorded checks.thickness.notChecked",
    ),
    inputArtifactSha256: sha256,
  };
}

function parseOverhang(
  value: unknown,
  expectedSha256: string,
): DfmRecordedOverhang {
  const root = exactRecord(value, [
    "tool",
    "measured",
    "thresholdDeg",
    "buildDirection",
    "violations",
    "notChecked",
    "inputArtifactSha256",
  ], "recorded checks.overhang");
  literal(root.tool, DFM_OVERHANG_TOOL, "recorded checks.overhang.tool");
  const measured = exactRecord(root.measured, [
    "totalSurfaceAreaMm2",
    "overhangAreaMm2",
    "overhangTriangleCount",
    "totalTriangleCount",
  ], "recorded checks.overhang.measured");
  const totalSurfaceAreaMm2 = nonNegativeNumber(
    measured.totalSurfaceAreaMm2,
    "recorded checks.overhang.measured.totalSurfaceAreaMm2",
  );
  const overhangAreaMm2 = nonNegativeNumber(
    measured.overhangAreaMm2,
    "recorded checks.overhang.measured.overhangAreaMm2",
  );
  if (overhangAreaMm2 > totalSurfaceAreaMm2) {
    throw new TypeError(
      "recorded checks.overhangAreaMm2 must not exceed totalSurfaceAreaMm2.",
    );
  }
  const overhangTriangleCount = nonNegativeInteger(
    measured.overhangTriangleCount,
    "recorded checks.overhang.measured.overhangTriangleCount",
  );
  const totalTriangleCount = nonNegativeInteger(
    measured.totalTriangleCount,
    "recorded checks.overhang.measured.totalTriangleCount",
  );
  if (overhangTriangleCount > totalTriangleCount) {
    throw new TypeError(
      "recorded checks.overhangTriangleCount must not exceed totalTriangleCount.",
    );
  }
  const sha256 = digest(
    root.inputArtifactSha256,
    "recorded checks.overhang.inputArtifactSha256",
  );
  if (sha256 !== expectedSha256) {
    throw new TypeError(
      "recorded checks.overhang.inputArtifactSha256 does not match geometry.",
    );
  }
  const thresholdDeg = finiteNumber(
    root.thresholdDeg,
    "recorded checks.overhang.thresholdDeg",
  );
  if (thresholdDeg < 0 || thresholdDeg > 90) {
    throw new TypeError(
      "recorded checks.overhang.thresholdDeg must be between 0 and 90.",
    );
  }
  return {
    tool: DFM_OVERHANG_TOOL,
    measured: {
      totalSurfaceAreaMm2,
      overhangAreaMm2,
      overhangTriangleCount,
      totalTriangleCount,
    },
    thresholdDeg,
    buildDirection: nonZeroVector3(
      root.buildDirection,
      "recorded checks.overhang.buildDirection",
    ),
    violations: parseZones(
      root.violations,
      "recorded checks.overhang.violations",
    ),
    notChecked: strings(
      root.notChecked,
      "recorded checks.overhang.notChecked",
    ),
    inputArtifactSha256: sha256,
  };
}

function parseZMinFilter(value: unknown): DfmZMinFilterTrace {
  const root = exactRecord(
    value,
    ["declared", "applied", "filtered", "remaining"],
    "recorded checks.zMinFilter",
  );
  const declared = exactRecord(
    root.declared,
    ["enabled", "planeZMm", "toleranceMm"],
    "recorded checks.zMinFilter.declared",
  );
  if (typeof declared.enabled !== "boolean") {
    throw new TypeError(
      "recorded checks.zMinFilter.declared.enabled must be a boolean.",
    );
  }
  if (typeof root.applied !== "boolean") {
    throw new TypeError("recorded checks.zMinFilter.applied must be a boolean.");
  }
  const plane = exactRecord(
    declared.planeZMm,
    ["value", "unit"],
    "recorded checks.zMinFilter.declared.planeZMm",
  );
  literal(
    plane.unit,
    "mm",
    "recorded checks.zMinFilter.declared.planeZMm.unit",
  );
  const tolerance = exactRecord(
    declared.toleranceMm,
    ["value", "unit"],
    "recorded checks.zMinFilter.declared.toleranceMm",
  );
  literal(
    tolerance.unit,
    "mm",
    "recorded checks.zMinFilter.declared.toleranceMm.unit",
  );
  return {
    declared: {
      enabled: declared.enabled,
      planeZMm: {
        value: finiteNumber(
          plane.value,
          "recorded checks.zMinFilter.declared.planeZMm.value",
        ),
        unit: "mm",
      },
      toleranceMm: {
        value: nonNegativeNumber(
          tolerance.value,
          "recorded checks.zMinFilter.declared.toleranceMm.value",
        ),
        unit: "mm",
      },
    },
    applied: root.applied,
    filtered: parseFilteredZones(root.filtered),
    remaining: parseZones(
      root.remaining,
      "recorded checks.zMinFilter.remaining",
    ),
  };
}

function parseFilteredZones(
  value: unknown,
): DfmZMinFilterTrace["filtered"] {
  return denseArray(value, "recorded checks.zMinFilter.filtered").map(
    (item, index) => {
      const zone = exactRecord(
        item,
        ["area_mm2", "centroid_mm", "reason", "centroidZMm"],
        `recorded checks.zMinFilter.filtered[${index}]`,
      );
      literal(
        zone.reason,
        "z-min-bed-contact",
        `recorded checks.zMinFilter.filtered[${index}].reason`,
      );
      return {
        area_mm2: nonNegativeNumber(
          zone.area_mm2,
          `recorded checks.zMinFilter.filtered[${index}].area_mm2`,
        ),
        centroid_mm: vector3(
          zone.centroid_mm,
          `recorded checks.zMinFilter.filtered[${index}].centroid_mm`,
        ),
        reason: "z-min-bed-contact" as const,
        centroidZMm: finiteNumber(
          zone.centroidZMm,
          `recorded checks.zMinFilter.filtered[${index}].centroidZMm`,
        ),
      };
    },
  );
}

function parseEvaluations(value: unknown): DfmRecordedEvaluations {
  const root = exactRecord(
    value,
    ["owner", "status", "verdicts"],
    "recorded checks.evaluations",
  );
  literal(
    root.owner,
    DIGITAL_THREAD_EVALUATION_OWNER,
    "recorded checks.evaluations.owner",
  );
  const status = parseStatus(root.status, "recorded checks.evaluations.status");
  const verdicts = denseArray(
    root.verdicts,
    "recorded checks.evaluations.verdicts",
  ).map((item, index) =>
    parseVerdict(item, `recorded checks.evaluations.verdicts[${index}]`)
  );
  if (verdicts.length !== 3) {
    throw new TypeError(
      "recorded checks.evaluations.verdicts must contain envelope, min-thickness and overhangs.",
    );
  }
  if (
    verdicts[0]!.check !== "envelope" ||
    verdicts[1]!.check !== "min-thickness" ||
    verdicts[2]!.check !== "overhangs"
  ) {
    throw new TypeError(
      "recorded checks.evaluations.verdicts must be envelope, min-thickness, overhangs in that order.",
    );
  }
  const expectedStatus = verdicts.every((item) => item.status === "pass")
    ? "pass"
    : "fail";
  if (status !== expectedStatus) {
    throw new TypeError(
      "recorded checks.evaluations.status does not match the recorded verdicts.",
    );
  }
  return { owner: DIGITAL_THREAD_EVALUATION_OWNER, status, verdicts };
}

function parseVerdict(value: unknown, name: string): DfmCheckVerdict {
  const root = exactRecord(value, ["check", "status", "violations"], name);
  return {
    check: parseCheckName(root.check, `${name}.check`),
    status: parseStatus(root.status, `${name}.status`),
    violations: denseArray(root.violations, `${name}.violations`).map(
      (item, index) => parseNamedViolation(item, `${name}.violations[${index}]`),
    ),
  };
}

function parseNamedViolation(value: unknown, name: string): DfmNamedViolation {
  const root = exactRecord(value, ["name", "check", "summary"], name);
  return {
    name: nonEmpty(root.name, `${name}.name`),
    check: parseCheckName(root.check, `${name}.check`),
    summary: nonEmpty(root.summary, `${name}.summary`),
  };
}

function parseEnvelopeViolations(
  value: unknown,
  name: string,
): readonly DfmEnvelopeAxisViolation[] {
  return denseArray(value, name).map((item, index) => {
    const rec = exactRecord(
      item,
      ["axis", "measured_mm", "limit_mm"],
      `${name}[${index}]`,
    );
    const axis = rec.axis;
    if (axis !== "x" && axis !== "y" && axis !== "z") {
      throw new TypeError(`${name}[${index}].axis must be x, y or z.`);
    }
    return {
      axis,
      measured_mm: nonNegativeNumber(
        rec.measured_mm,
        `${name}[${index}].measured_mm`,
      ),
      limit_mm: nonNegativeNumber(rec.limit_mm, `${name}[${index}].limit_mm`),
    };
  });
}

function parseZones(value: unknown, name: string): readonly DfmZone[] {
  return denseArray(value, name).map((item, index) => {
    const zone = exactRecord(item, ["area_mm2", "centroid_mm"], `${name}[${index}]`);
    return {
      area_mm2: nonNegativeNumber(zone.area_mm2, `${name}[${index}].area_mm2`),
      centroid_mm: vector3(zone.centroid_mm, `${name}[${index}].centroid_mm`),
    };
  });
}

function parseCheckName(value: unknown, name: string): DfmCheckName {
  if (
    value !== "envelope" && value !== "min-thickness" && value !== "overhangs"
  ) {
    throw new TypeError(`${name} is not a measured DFM check.`);
  }
  return value;
}

function parseStatus(value: unknown, name: string): DfmCheckStatus {
  if (value !== "pass" && value !== "fail") {
    throw new TypeError(`${name} must be pass or fail.`);
  }
  return value;
}
