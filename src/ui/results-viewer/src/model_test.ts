import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  DFM_VIEW_APP_MANIFEST,
  DFM_VIEWER_SESSION_KIND,
  DFM_VIEWER_SESSION_SCHEMA,
  dfmRecordedSessionFingerprint,
  QUALITY_ABSENT_ON_RESULT_REASON,
  QUALITY_UNAVAILABLE_REASON,
  VIEWER_SESSION_APPLY_ACTION,
} from "../../../viewer-session.ts";
import {
  DFM_APP_INFO,
  DFM_STATUS_CLASS,
  dfmSurfaceAppOptions,
  SESSION_REJECTED_CODE,
  toSurfaceState,
} from "./app.ts";
import {
  digitalThreadReasonSummaries,
  displayStateFromToolResult,
  displayStateFromViewerSession,
} from "./model.ts";

const STEP_SHA = "a".repeat(64);
const CASE_SHA = "b".repeat(64);
const CAPTURE_SHA = "c".repeat(64);

Deno.test("recorded session display keeps Digital Thread verdicts and unavailable quality", async () => {
  const state = await displayStateFromViewerSession(await validSession());
  assertEquals(state.kind, "result");
  if (state.kind !== "result") throw new Error("expected result");
  assertEquals(state.result.kind, "digital-thread-measured-checks");
  if (state.result.kind !== "digital-thread-measured-checks") {
    throw new Error("expected recorded checks");
  }
  assertEquals(state.result.evaluations.owner, "digital-thread");
  assertEquals(state.result.evaluations.status, "fail");
  assertEquals("stagedPath" in state.result.geometry, false);
  assertEquals(QUALITY_UNAVAILABLE_REASON, "not recorded on the capture");
});

Deno.test("rejected sessions become a session-rejected surface error", async () => {
  const session = await validSession();
  session.basis.projectId = "other";
  await assertRejects(
    () => displayStateFromViewerSession(session),
    TypeError,
    "sessionFingerprint",
  );
  const surface = toSurfaceState({
    kind: "error",
    message: `Rejected ${DFM_VIEWER_SESSION_SCHEMA} session: fingerprint`,
  });
  assertEquals(surface.kind, "error");
});

Deno.test("historical raw tool results do not invent quality or a whole-case verdict", () => {
  const state = displayStateFromToolResult({
    structuredContent: {
      violations: [],
      measured: { x_mm: 40, y_mm: 30, z_mm: 20, volume_mm3: 24000 },
      limits_declared: { build_volume_mm: { x: 200, y: 200, z: 200 } },
      not_checked: ["orientation"],
      input_artifact: {
        sha256: STEP_SHA,
        bytes: 12,
        source_path: "/exports/private.step",
      },
    },
  });
  assertEquals(state.kind, "result");
  if (state.kind !== "result" || state.result.kind !== "dfm-envelope-raw") {
    throw new Error("expected envelope raw");
  }
  assertEquals(state.result.volumeStatus, {
    status: "unavailable",
    reason: QUALITY_ABSENT_ON_RESULT_REASON,
  });
  assertEquals("source_path" in state.result.inputArtifact, false);
  assertEquals("status" in state.result, false);
});

Deno.test("text fallback remains usable when structuredContent is absent", () => {
  const state = displayStateFromToolResult({
    content: [{
      type: "text",
      text: JSON.stringify({
        violations: [],
        measured: {
          total_surface_area_mm2: 10,
          overhang_area_mm2: 1,
          overhang_triangle_count: 1,
          total_triangle_count: 4,
        },
        limits_declared: {
          max_overhang_deg: 45,
          build_direction: [0, 0, 1],
        },
        not_checked: ["bed"],
        input_artifact: { sha256: STEP_SHA, bytes: 12 },
      }),
    }],
  });
  assertEquals(state.kind, "result");
  if (state.kind !== "result") throw new Error("expected result");
  assertEquals(state.result.kind, "dfm-overhangs-raw");
});

Deno.test("recorded display shows Digital Thread reason summaries without recomputing zones", async () => {
  const state = await displayStateFromViewerSession(await validSession());
  assertEquals(state.kind, "result");
  if (
    state.kind !== "result" ||
    state.result.kind !== "digital-thread-measured-checks"
  ) {
    throw new Error("expected recorded checks");
  }
  assertEquals(
    digitalThreadReasonSummaries(state.result.evaluations.verdicts[0]),
    "none",
  );
  assertEquals(
    digitalThreadReasonSummaries(state.result.evaluations.verdicts[1]),
    "none",
  );
  assertEquals(
    digitalThreadReasonSummaries(state.result.evaluations.verdicts[2]),
    "One overhang zone remains after the declared Z-min filter.",
  );
  assertEquals(state.result.overhang.violations.length, 2);
  assertEquals(state.result.zMinFilter.filtered.length, 1);
  assertEquals(state.result.zMinFilter.remaining.length, 1);
  assertEquals(digitalThreadReasonSummaries(undefined), "unavailable");
});

Deno.test("advertised recorded-checks result schema is parsed on the tool-result path", () => {
  const state = displayStateFromToolResult({
    structuredContent: recordedResult(),
  });
  assertEquals(state.kind, "result");
  if (state.kind !== "result") throw new Error("expected result");
  assertEquals(state.result.kind, "digital-thread-measured-checks");
  if (state.result.kind !== "digital-thread-measured-checks") {
    throw new Error("expected recorded checks");
  }
  assertEquals(state.result.evaluations.owner, "digital-thread");
});

Deno.test("App validate owns only DFM session schema and kind", () => {
  const validate = dfmSurfaceAppOptions({} as HTMLElement).viewerSession!.validate;
  assertEquals(
    validate({
      schemaVersion: DFM_VIEWER_SESSION_SCHEMA,
      kind: DFM_VIEWER_SESSION_KIND,
      extra: "deeper validation stays in toState",
    }),
    true,
  );
  assertEquals(
    validate({
      schemaVersion: "other/1.0",
      kind: DFM_VIEWER_SESSION_KIND,
    }),
    false,
  );
  assertEquals(
    validate({
      schemaVersion: DFM_VIEWER_SESSION_SCHEMA,
      kind: "other.kind",
    }),
    false,
  );
  assertEquals(validate(null), false);
  assertEquals(validate("session"), false);
});

Deno.test("App identity matches the 0.4.1 package", () => {
  assertEquals(DFM_APP_INFO.name, "io.casys.mcp-dfm.results");
  assertEquals(DFM_APP_INFO.version, "0.4.1");
  assertEquals(DFM_STATUS_CLASS, "dfm-viewer-state");
  assertEquals(SESSION_REJECTED_CODE, "session-rejected");
  assertEquals(
    DFM_VIEW_APP_MANIFEST.resources[0].acceptedActions[0],
    VIEWER_SESSION_APPLY_ACTION,
  );
  assertStringIncludes(DFM_VIEWER_SESSION_SCHEMA, "recorded-checks-session");
});

function recordedResult() {
  return {
    schemaVersion: "io.casys.mcp-dfm.recorded-checks/1.0",
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
      owner: "digital-thread",
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

async function validSession() {
  const captureUri = `casys://dfm-check-capture/sha256/${CAPTURE_SHA}`;
  const artifact = () => ({
    uri: captureUri,
    fingerprint: `sha256:${CAPTURE_SHA}`,
  });
  const session = {
    schemaVersion: DFM_VIEWER_SESSION_SCHEMA,
    kind: "dfm.measured-checks",
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
      operation: "industrialize.run-dfm-checks@1",
      runId: "run.dfm-checks",
      caseDigest: CASE_SHA,
      captureArtifact: artifact(),
      inputArtifact: {
        uri: `/api/thread/assets/${STEP_SHA}.step`,
        mediaType: "model/step",
        fingerprint: `sha256:${STEP_SHA}`,
        bytes: 86130,
      },
      resultArtifact: artifact(),
    },
    projection: {
      status: "available" as const,
      result: recordedResult(),
    },
  };
  session.basis.sessionFingerprint = await dfmRecordedSessionFingerprint(
    session,
  );
  return session;
}
