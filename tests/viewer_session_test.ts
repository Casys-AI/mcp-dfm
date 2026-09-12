import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  DFM_INDUSTRIALIZE_OPERATION,
  DFM_RECORDED_CHECKS_SCHEMA,
  DFM_VIEW_APP_MANIFEST,
  DFM_VIEW_APP_VERSION,
  DFM_VIEWER_SESSION_KIND,
  DFM_VIEWER_SESSION_SCHEMA,
  dfmRecordedSessionFingerprint,
  DIGITAL_THREAD_EVALUATION_OWNER,
  parseDfmRawToolResult,
  parseDfmViewerSession,
  QUALITY_ABSENT_ON_RESULT_REASON,
  VIEWER_SESSION_APPLY_ACTION,
} from "../src/viewer-session.ts";

const STEP_SHA = "a".repeat(64);
const CASE_SHA = "b".repeat(64);
const CAPTURE_SHA = "c".repeat(64);

Deno.test("recorded session parses a closed Digital Thread measured-checks envelope", async () => {
  const session = await validSession();
  const parsed = await parseDfmViewerSession(session);
  assertEquals(parsed.schemaVersion, DFM_VIEWER_SESSION_SCHEMA);
  assertEquals(parsed.kind, DFM_VIEWER_SESSION_KIND);
  assertEquals(parsed.provenance.operation, DFM_INDUSTRIALIZE_OPERATION);
  assertEquals(parsed.projection.status, "available");
  if (parsed.projection.status !== "available") throw new Error("expected result");
  assertEquals(parsed.projection.result.schemaVersion, DFM_RECORDED_CHECKS_SCHEMA);
  assertEquals(
    parsed.projection.result.evaluations.owner,
    DIGITAL_THREAD_EVALUATION_OWNER,
  );
  assertEquals(parsed.projection.result.evaluations.status, "fail");
  assertEquals(
    parsed.projection.result.zMinFilter.filtered[0]?.reason,
    "z-min-bed-contact",
  );
  assertEquals(
    "stagedPath" in parsed.projection.result.geometry,
    false,
  );
});

Deno.test("invalid session schema, kind and extra fields are rejected", async () => {
  const session = await validSession();
  session.schemaVersion = "other/1.0";
  await resign(session);
  await assertRejects(
    () => parseDfmViewerSession(session),
    TypeError,
    "schemaVersion",
  );

  const wrongKind = await validSession();
  wrongKind.kind = "other.kind";
  await resign(wrongKind);
  await assertRejects(
    () => parseDfmViewerSession(wrongKind),
    TypeError,
    "kind",
  );

  const extra = await validSession();
  extra.note = "no";
  await assertRejects(
    () => parseDfmViewerSession(extra),
    TypeError,
    "unsupported fields",
  );
});

Deno.test("foreign capture anchor and fingerprint joins are rejected", async () => {
  const foreign = await validSession();
  foreign.anchor.uri = `casys://dfm-check-capture/sha256/${"d".repeat(64)}`;
  foreign.anchor.fingerprint = `sha256:${"d".repeat(64)}`;
  await resign(foreign);
  await assertRejects(
    () => parseDfmViewerSession(foreign),
    TypeError,
    "anchor must identify the exact recorded capture artifact",
  );

  const mismatchedCapture = await validSession();
  mismatchedCapture.provenance.captureArtifact.uri =
    `casys://dfm-check-capture/sha256/${"d".repeat(64)}`;
  mismatchedCapture.provenance.captureArtifact.fingerprint = `sha256:${"d".repeat(64)}`;
  await resign(mismatchedCapture);
  await assertRejects(
    () => parseDfmViewerSession(mismatchedCapture),
    TypeError,
    "same recorded capture",
  );

  const wrongUriHex = await validSession();
  wrongUriHex.anchor.uri = `casys://isolated-output/sha256/${CAPTURE_SHA}`;
  wrongUriHex.provenance.captureArtifact.uri = wrongUriHex.anchor.uri;
  wrongUriHex.provenance.resultArtifact.uri = wrongUriHex.anchor.uri;
  await resign(wrongUriHex);
  await assertRejects(
    () => parseDfmViewerSession(wrongUriHex),
    TypeError,
    "URI and fingerprint must identify the same bytes",
  );
});

Deno.test("tampered session fingerprint and malformed quantities are rejected", async () => {
  const tampered = await validSession();
  tampered.basis.projectId = "other-project";
  await assertRejects(
    () => parseDfmViewerSession(tampered),
    TypeError,
    "sessionFingerprint does not match",
  );

  const nanVolume = await validSession();
  (nanVolume.projection.result as {
    envelope: { measured: { volumeMm3: number } };
  }).envelope.measured.volumeMm3 = Number.NaN;
  await assertRejects(
    () => dfmRecordedSessionFingerprint(nanVolume),
    TypeError,
    "finite",
  );

  const negative = await validSession();
  (negative.projection.result as { thickness: { thresholdMm: number } })
    .thickness.thresholdMm = 0;
  await resign(negative);
  await assertRejects(
    () => parseDfmViewerSession(negative),
    TypeError,
    "positive",
  );
});

Deno.test("private staged paths and commands cannot enter the session", async () => {
  const staged = await validSession();
  const geometry = (staged.projection.result as {
    geometry: Record<string, unknown>;
  }).geometry;
  geometry.stagedPath = `/exports/${STEP_SHA}.step`;
  await assertRejects(
    () => parseDfmViewerSession(staged),
    TypeError,
    "private path or command",
  );

  const command = await validSession();
  command.provenance.command = "gmsh";
  await assertRejects(
    () => parseDfmViewerSession(command),
    TypeError,
    "private path or command",
  );
});

Deno.test("recorded evaluations stay Digital Thread-owned and separate from raw zones", async () => {
  const parsed = await parseDfmViewerSession(await validSession());
  if (parsed.projection.status !== "available") throw new Error("expected result");
  const result = parsed.projection.result;
  assertEquals(result.overhang.violations.length, 2);
  assertEquals(result.zMinFilter.filtered.length, 1);
  assertEquals(result.zMinFilter.remaining.length, 1);
  assertEquals(result.evaluations.verdicts[2]?.check, "overhangs");
  assertEquals(result.evaluations.verdicts[2]?.status, "fail");
  assertEquals(result.evaluations.owner, "digital-thread");
});

Deno.test("unresolved and unavailable projections are preserved", async () => {
  const unresolved = await validSession();
  unresolved.projection = { status: "unresolved", reason: "capture not joined" };
  await resign(unresolved);
  const parsed = await parseDfmViewerSession(unresolved);
  assertEquals(parsed.projection, {
    status: "unresolved",
    reason: "capture not joined",
  });
});

Deno.test("historical live tool results keep missing quality unavailable", () => {
  const envelope = parseDfmRawToolResult({
    violations: [],
    measured: { x_mm: 40, y_mm: 30, z_mm: 20, volume_mm3: 24000 },
    limits_declared: { build_volume_mm: { x: 200, y: 200, z: 200 } },
    not_checked: ["orientation is not optimised"],
    input_artifact: {
      sha256: STEP_SHA,
      bytes: 15456,
      source_path: "/exports/private.step",
    },
  });
  assertEquals(envelope.kind, "dfm-envelope-raw");
  if (envelope.kind !== "dfm-envelope-raw") throw new Error("expected envelope");
  assertEquals(envelope.volumeStatus, {
    status: "unavailable",
    reason: QUALITY_ABSENT_ON_RESULT_REASON,
  });
  assertEquals(envelope.meshTopology.status, "unavailable");
  assertEquals(envelope.inputArtifact, { sha256: STEP_SHA, bytes: 15456 });
  assertEquals("source_path" in envelope.inputArtifact, false);

  const thickness = parseDfmRawToolResult({
    violations: [{ area_mm2: 12, centroid_mm: [1, 2, 3] }],
    measured: {
      min_thickness_mm: 0.8,
      min_position_mm: [1, 2, 3],
      sample_count: 300,
      valid_ray_count: 280,
    },
    limits_declared: { min_thickness_mm: 1 },
    not_checked: ["sampled"],
    input_artifact: { sha256: STEP_SHA, bytes: 100 },
  });
  assertEquals(thickness.kind, "dfm-min-thickness-raw");
  if (thickness.kind !== "dfm-min-thickness-raw") throw new Error("expected thickness");
  assertEquals(thickness.minimumThicknessStatus.status, "unavailable");
  assertEquals(thickness.rayCoverage.status, "unavailable");
});

Deno.test("live 0.3 envelope quality is projected without a whole-case verdict", () => {
  const envelope = parseDfmRawToolResult({
    violations: [],
    measured: {
      x_mm: 40,
      y_mm: 30,
      z_mm: 20,
      volume_mm3: 24000,
      volume_status: "computed",
      mass_status: "not_requested",
    },
    mesh_topology: {
      closed: true,
      watertight: true,
      manifold: true,
      orientation_consistent: true,
      connected_component_count: 1,
      boundary_edge_count: 0,
      non_manifold_edge_count: 0,
      non_manifold_vertex_count: 0,
      degenerate_triangle_count: 0,
    },
    limits_declared: { build_volume_mm: { x: 200, y: 200, z: 200 } },
    not_checked: ["orientation"],
    input_artifact: { sha256: STEP_SHA, bytes: 15456, source_path: "/tmp/x.step" },
  });
  assertEquals(envelope.kind, "dfm-envelope-raw");
  if (envelope.kind !== "dfm-envelope-raw") throw new Error("expected envelope");
  assertEquals(envelope.volumeStatus, { status: "available", value: "computed" });
  assertEquals("verdict" in envelope, false);
  assertEquals("status" in envelope, false);
});

Deno.test("malformed live quantities are rejected", () => {
  assertThrows(
    () =>
      parseDfmRawToolResult({
        violations: [],
        measured: {
          x_mm: 40,
          y_mm: 30,
          z_mm: 20,
          volume_mm3: Number.POSITIVE_INFINITY,
        },
        limits_declared: { build_volume_mm: { x: 200, y: 200, z: 200 } },
        not_checked: [],
        input_artifact: { sha256: STEP_SHA, bytes: 1 },
      }),
    TypeError,
    "finite",
  );
});

Deno.test("raw overhangs reject a zero build direction", () => {
  assertThrows(
    () => parseDfmRawToolResult(rawOverhang([0, 0, 0])),
    TypeError,
    "zero vector",
  );
});

Deno.test("recorded overhangs reject a zero build direction", async () => {
  const session = await validSession();
  (session.projection.result as { overhang: { buildDirection: number[] } })
    .overhang.buildDirection = [0, 0, 0];
  await resign(session);
  await assertRejects(
    () => parseDfmViewerSession(session),
    TypeError,
    "zero vector",
  );
});

Deno.test("live thickness ray_coverage is accepted only when it matches measured counts", () => {
  const thickness = parseDfmRawToolResult(rawThickness());
  assertEquals(thickness.kind, "dfm-min-thickness-raw");
  if (thickness.kind !== "dfm-min-thickness-raw") {
    throw new Error("expected thickness");
  }
  assertEquals(thickness.rayCoverage, {
    status: "available",
    value: {
      sampled_triangle_count: 300,
      valid_ray_count: 280,
      unresolved_ray_count: 20,
      complete: false,
    },
  });

  assertThrows(
    () =>
      parseDfmRawToolResult(rawThickness({
        ray_coverage: {
          sampled_triangle_count: 299,
          valid_ray_count: 280,
          unresolved_ray_count: 19,
          complete: false,
        },
      })),
    TypeError,
    "sampled_triangle_count must equal measured.sample_count",
  );
  assertThrows(
    () =>
      parseDfmRawToolResult(rawThickness({
        ray_coverage: {
          sampled_triangle_count: 300,
          valid_ray_count: 279,
          unresolved_ray_count: 21,
          complete: false,
        },
      })),
    TypeError,
    "valid_ray_count must equal measured.valid_ray_count",
  );
  assertThrows(
    () =>
      parseDfmRawToolResult(rawThickness({
        ray_coverage: {
          sampled_triangle_count: 300,
          valid_ray_count: 280,
          unresolved_ray_count: 0,
          complete: false,
        },
      })),
    TypeError,
    "unresolved_ray_count must equal sampled_triangle_count minus valid_ray_count",
  );
  assertThrows(
    () =>
      parseDfmRawToolResult(rawThickness({
        ray_coverage: {
          sampled_triangle_count: 300,
          valid_ray_count: 280,
          unresolved_ray_count: 20,
          complete: true,
        },
      })),
    TypeError,
    "complete does not match sampled and valid ray counts",
  );
});

Deno.test("App manifest version matches the 0.4.0 package", () => {
  assertEquals(DFM_VIEW_APP_MANIFEST.app.version, DFM_VIEW_APP_VERSION);
  assertEquals(DFM_VIEW_APP_MANIFEST.app.version, "0.4.0");
  assertEquals(
    DFM_VIEW_APP_MANIFEST.resources[0].acceptedActions[0],
    VIEWER_SESSION_APPLY_ACTION,
  );
  assertEquals(
    DFM_VIEW_APP_MANIFEST.resources[0].sessionSchemas[0],
    DFM_VIEWER_SESSION_SCHEMA,
  );
});

function rawOverhang(build_direction: readonly [number, number, number]) {
  return {
    violations: [],
    measured: {
      total_surface_area_mm2: 10,
      overhang_area_mm2: 1,
      overhang_triangle_count: 1,
      total_triangle_count: 4,
    },
    limits_declared: {
      max_overhang_deg: 45,
      build_direction,
    },
    not_checked: ["bed"],
    input_artifact: { sha256: STEP_SHA, bytes: 12 },
  };
}

function rawThickness(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    violations: [{ area_mm2: 12, centroid_mm: [1, 2, 3] }],
    measured: {
      min_thickness_mm: 0.8,
      min_position_mm: [1, 2, 3],
      sample_count: 300,
      valid_ray_count: 280,
    },
    limits_declared: { min_thickness_mm: 1 },
    not_checked: ["sampled"],
    input_artifact: { sha256: STEP_SHA, bytes: 100 },
    ray_coverage: {
      sampled_triangle_count: 300,
      valid_ray_count: 280,
      unresolved_ray_count: 20,
      complete: false,
    },
    ...overrides,
  };
}

function recordedResult() {
  return {
    schemaVersion: DFM_RECORDED_CHECKS_SCHEMA,
    kind: "digital-thread-measured-checks",
    capture: {
      schemaVersion: "dfm-check-capture/1.0",
      fingerprint: `sha256:${CAPTURE_SHA}`,
      capturedAt: "2026-08-15T00:00:00.000Z",
      dispatchedAt: "2026-08-15T00:00:00.000Z",
    },
    geometry: {
      artifactId: "geometry-step-support-bracket",
      sha256: STEP_SHA,
      byteCount: 86130,
      mediaType: "model/step",
    },
    caseDigest: CASE_SHA,
    envelope: {
      tool: "dfm_check_envelope",
      measured: { xMm: 190, yMm: 135, zMm: 18, volumeMm3: 24000 },
      declaredVolumeMm: { x: 250, y: 210, z: 200 },
      violations: [],
      notChecked: ["orientation is not optimised"],
      inputArtifactSha256: STEP_SHA,
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: {
        minThicknessMm: 0.91495,
        minPositionMm: [1, 2, 3],
        sampleCount: 500,
        validRayCount: 498,
      },
      thresholdMm: 0.8,
      violations: [],
      notChecked: ["sampled inward-normal thickness"],
      inputArtifactSha256: STEP_SHA,
    },
    overhang: {
      tool: "dfm_check_overhangs",
      measured: {
        totalSurfaceAreaMm2: 5000,
        overhangAreaMm2: 1300,
        overhangTriangleCount: 40,
        totalTriangleCount: 200,
      },
      thresholdDeg: 45,
      buildDirection: [0, 0, 1],
      violations: [
        { area_mm2: 1200, centroid_mm: [0, 0, -10] },
        { area_mm2: 100, centroid_mm: [10, 0, 4] },
      ],
      notChecked: ["bed contact is not excluded by the provider"],
      inputArtifactSha256: STEP_SHA,
    },
    zMinFilter: {
      declared: {
        enabled: true,
        planeZMm: { value: -10, unit: "mm" },
        toleranceMm: { value: 0.1, unit: "mm" },
      },
      applied: true,
      filtered: [{
        area_mm2: 1200,
        centroid_mm: [0, 0, -10],
        reason: "z-min-bed-contact",
        centroidZMm: -10,
      }],
      remaining: [{ area_mm2: 100, centroid_mm: [10, 0, 4] }],
    },
    evaluations: {
      owner: DIGITAL_THREAD_EVALUATION_OWNER,
      status: "fail",
      verdicts: [
        { check: "envelope", status: "pass", violations: [] },
        { check: "min-thickness", status: "pass", violations: [] },
        {
          check: "overhangs",
          status: "fail",
          violations: [{
            name: "remaining-overhang",
            check: "overhangs",
            summary: "One overhang zone remains after the declared Z-min filter.",
          }],
        },
      ],
    },
    limitations: ["The live mcp-dfm tools analyse STEP, not STL."],
  };
}

type MutableSession = {
  schemaVersion: string;
  kind: string;
  note?: string;
  basis: {
    projectId: string;
    projectRevision: number;
    subjectId: string;
    thread: { id: string; revision: number };
    sessionFingerprint: string;
  };
  anchor: { kind: string; id: string; uri: string; fingerprint: string };
  provenance: {
    kind: string;
    operation: string;
    runId: string;
    caseDigest: string;
    command?: string;
    captureArtifact: { uri: string; fingerprint: string };
    inputArtifact: {
      uri: string;
      mediaType: string;
      fingerprint: string;
      bytes: number;
    };
    resultArtifact: { uri: string; fingerprint: string };
  };
  projection: Record<string, unknown>;
};

async function validSession(): Promise<MutableSession> {
  const captureUri = `casys://dfm-check-capture/sha256/${CAPTURE_SHA}`;
  const artifact = () => ({
    uri: captureUri,
    fingerprint: `sha256:${CAPTURE_SHA}`,
  });
  const session: MutableSession = {
    schemaVersion: DFM_VIEWER_SESSION_SCHEMA,
    kind: DFM_VIEWER_SESSION_KIND,
    basis: {
      projectId: "inspection-drone-id01",
      projectRevision: 882,
      subjectId: "part-support-bracket",
      thread: { id: "thread-118", revision: 118 },
      sessionFingerprint: `sha256:${"0".repeat(64)}`,
    },
    anchor: {
      kind: "dfm-check-capture",
      id: `capture-${CAPTURE_SHA}`,
      ...artifact(),
    },
    provenance: {
      kind: "digital-thread-operation",
      operation: DFM_INDUSTRIALIZE_OPERATION,
      runId: "run.dfm-checks",
      caseDigest: CASE_SHA,
      captureArtifact: artifact(),
      inputArtifact: {
        uri: `casys://isolated-output/sha256/${STEP_SHA}`,
        mediaType: "model/step",
        fingerprint: `sha256:${STEP_SHA}`,
        bytes: 86130,
      },
      resultArtifact: artifact(),
    },
    projection: {
      status: "available",
      result: recordedResult(),
    },
  };
  await resign(session);
  return session;
}

async function resign(
  session: { basis: { sessionFingerprint: string } } & Record<string, unknown>,
): Promise<void> {
  session.basis.sessionFingerprint = await dfmRecordedSessionFingerprint(session);
}
