/**
 * Closed recorded-session envelope for viewer.session.apply.
 *
 * Basis, anchor and fingerprint match the shared MCP View toolkit. The
 * projection is a sanitized recorded-checks document, never a private capture.
 */

import {
  DFM_CAPTURE_URI_PATTERN,
  DFM_INDUSTRIALIZE_OPERATION,
  DFM_TARGET_MEDIA_TYPE,
  DFM_VIEWER_SESSION_KIND,
  DFM_VIEWER_SESSION_SCHEMA,
} from "./identities.ts";
import {
  assertDigestAddress,
  exactKeys,
  exactRecord,
  fingerprint,
  nonEmpty,
  nonNegativeInteger,
  positiveInteger,
  record,
  rejectForbiddenKeys,
  sha256Fingerprint,
} from "./json.ts";
import {
  type DfmRecordedChecksResult,
  parseDfmRecordedChecksResult,
} from "./recorded-checks.ts";

export interface DfmViewerSessionBasis {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly subjectId: string;
  readonly thread: { readonly id: string; readonly revision: number };
  readonly sessionFingerprint: string;
}

export interface DfmViewerSessionAnchor {
  readonly kind: string;
  readonly id: string;
  readonly uri: string;
  readonly fingerprint: string;
}

export interface DfmViewerSessionProvenance {
  readonly kind: "digital-thread-operation";
  readonly operation: typeof DFM_INDUSTRIALIZE_OPERATION;
  readonly runId: string;
  readonly caseDigest: string;
  readonly captureArtifact: { readonly uri: string; readonly fingerprint: string };
  readonly inputArtifact: {
    readonly uri: string;
    readonly mediaType: typeof DFM_TARGET_MEDIA_TYPE;
    readonly fingerprint: string;
    readonly bytes: number;
  };
  readonly resultArtifact: { readonly uri: string; readonly fingerprint: string };
}

export type DfmViewerSessionProjection =
  | { readonly status: "available"; readonly result: DfmRecordedChecksResult }
  | { readonly status: "unresolved"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

export interface DfmViewerSession {
  readonly schemaVersion: typeof DFM_VIEWER_SESSION_SCHEMA;
  readonly kind: typeof DFM_VIEWER_SESSION_KIND;
  readonly basis: DfmViewerSessionBasis;
  readonly anchor: DfmViewerSessionAnchor;
  readonly provenance: DfmViewerSessionProvenance;
  readonly projection: DfmViewerSessionProjection;
}

/**
 * Strictly validate one opaque session delivered through viewer.session.apply,
 * including the App-owned fingerprint of the complete recorded session.
 */
export async function parseDfmViewerSession(
  value: unknown,
): Promise<DfmViewerSession> {
  rejectForbiddenKeys(value, "viewer session");
  const session = parseDfmViewerSessionStructure(value);
  const actualFingerprint = await dfmRecordedSessionFingerprint(value);
  if (session.basis.sessionFingerprint !== actualFingerprint) {
    throw new TypeError(
      "viewer session.basis.sessionFingerprint does not match the recorded session.",
    );
  }
  assertDfmViewerSessionJoins(session);
  return session;
}

/**
 * SHA-256 of the complete recorded session identity and projection.
 *
 * The canonical subdocument is exactly
 * `{schemaVersion, kind, basis, anchor, provenance, projection}` where basis
 * contains `{projectId, projectRevision, subjectId, thread}`. Only
 * `basis.sessionFingerprint` is omitted to avoid self-reference.
 */
export async function dfmRecordedSessionFingerprint(
  value: unknown,
): Promise<string> {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "basis",
    "anchor",
    "provenance",
    "projection",
  ], "viewer session fingerprint input");
  const basis = exactRecord(root.basis, [
    "projectId",
    "projectRevision",
    "subjectId",
    "thread",
    "sessionFingerprint",
  ], "viewer session fingerprint input.basis");
  return await sha256Fingerprint({
    schemaVersion: root.schemaVersion,
    kind: root.kind,
    basis: {
      projectId: basis.projectId,
      projectRevision: basis.projectRevision,
      subjectId: basis.subjectId,
      thread: basis.thread,
    },
    anchor: root.anchor,
    provenance: root.provenance,
    projection: root.projection,
  }, "viewer session fingerprint document");
}

function parseDfmViewerSessionStructure(value: unknown): DfmViewerSession {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "basis",
    "anchor",
    "provenance",
    "projection",
  ], "viewer session");
  literalSession(root.schemaVersion, DFM_VIEWER_SESSION_SCHEMA, "schemaVersion");
  literalSession(root.kind, DFM_VIEWER_SESSION_KIND, "kind");
  const basisValue = exactRecord(root.basis, [
    "projectId",
    "projectRevision",
    "subjectId",
    "thread",
    "sessionFingerprint",
  ], "viewer session.basis");
  const thread = exactRecord(
    basisValue.thread,
    ["id", "revision"],
    "viewer session.basis.thread",
  );
  const basis: DfmViewerSessionBasis = {
    projectId: nonEmpty(basisValue.projectId, "viewer session.basis.projectId"),
    projectRevision: nonNegativeInteger(
      basisValue.projectRevision,
      "viewer session.basis.projectRevision",
    ),
    subjectId: nonEmpty(basisValue.subjectId, "viewer session.basis.subjectId"),
    thread: {
      id: nonEmpty(thread.id, "viewer session.basis.thread.id"),
      revision: nonNegativeInteger(
        thread.revision,
        "viewer session.basis.thread.revision",
      ),
    },
    sessionFingerprint: fingerprint(
      basisValue.sessionFingerprint,
      "viewer session.basis.sessionFingerprint",
    ),
  };
  const anchorValue = exactRecord(
    root.anchor,
    ["kind", "id", "uri", "fingerprint"],
    "viewer session.anchor",
  );
  const anchor: DfmViewerSessionAnchor = {
    kind: nonEmpty(anchorValue.kind, "viewer session.anchor.kind"),
    id: nonEmpty(anchorValue.id, "viewer session.anchor.id"),
    uri: nonEmpty(anchorValue.uri, "viewer session.anchor.uri"),
    fingerprint: fingerprint(
      anchorValue.fingerprint,
      "viewer session.anchor.fingerprint",
    ),
  };
  return {
    schemaVersion: DFM_VIEWER_SESSION_SCHEMA,
    kind: DFM_VIEWER_SESSION_KIND,
    basis,
    anchor,
    provenance: parseProvenance(root.provenance),
    projection: parseProjection(root.projection),
  };
}

function parseProvenance(value: unknown): DfmViewerSessionProvenance {
  const root = exactRecord(value, [
    "kind",
    "operation",
    "runId",
    "caseDigest",
    "captureArtifact",
    "inputArtifact",
    "resultArtifact",
  ], "viewer session.provenance");
  literalSession(root.kind, "digital-thread-operation", "provenance.kind");
  literalSession(
    root.operation,
    DFM_INDUSTRIALIZE_OPERATION,
    "provenance.operation",
  );
  const input = exactRecord(root.inputArtifact, [
    "uri",
    "mediaType",
    "fingerprint",
    "bytes",
  ], "viewer session.provenance.inputArtifact");
  literalSession(
    input.mediaType,
    DFM_TARGET_MEDIA_TYPE,
    "provenance.inputArtifact.mediaType",
  );
  const caseDigest = nonEmpty(root.caseDigest, "viewer session.provenance.caseDigest");
  if (!/^[a-f0-9]{64}$/.test(caseDigest)) {
    throw new TypeError("viewer session.provenance.caseDigest has an invalid format.");
  }
  return {
    kind: "digital-thread-operation",
    operation: DFM_INDUSTRIALIZE_OPERATION,
    runId: nonEmpty(root.runId, "viewer session.provenance.runId"),
    caseDigest,
    captureArtifact: evidenceArtifact(
      root.captureArtifact,
      "viewer session.provenance.captureArtifact",
    ),
    inputArtifact: {
      uri: nonEmpty(input.uri, "viewer session.provenance.inputArtifact.uri"),
      mediaType: DFM_TARGET_MEDIA_TYPE,
      fingerprint: fingerprint(
        input.fingerprint,
        "viewer session.provenance.inputArtifact.fingerprint",
      ),
      bytes: positiveInteger(
        input.bytes,
        "viewer session.provenance.inputArtifact.bytes",
      ),
    },
    resultArtifact: evidenceArtifact(
      root.resultArtifact,
      "viewer session.provenance.resultArtifact",
    ),
  };
}

function parseProjection(value: unknown): DfmViewerSessionProjection {
  const root = record(value, "viewer session.projection");
  if (root.status === "available") {
    exactKeys(root, ["status", "result"], "viewer session.projection");
    return {
      status: "available",
      result: parseDfmRecordedChecksResult(root.result),
    };
  }
  if (root.status === "unresolved" || root.status === "unavailable") {
    exactKeys(root, ["status", "reason"], "viewer session.projection");
    return {
      status: root.status,
      reason: nonEmpty(root.reason, "viewer session.projection.reason"),
    };
  }
  throw new TypeError(
    "viewer session.projection.status must be available, unresolved, or unavailable.",
  );
}

function assertDfmViewerSessionJoins(session: DfmViewerSession): void {
  const { captureArtifact, resultArtifact, inputArtifact, caseDigest } =
    session.provenance;
  if (
    captureArtifact.uri !== resultArtifact.uri ||
    captureArtifact.fingerprint !== resultArtifact.fingerprint
  ) {
    throw new TypeError(
      "viewer session capture and result artifacts must identify the same recorded capture.",
    );
  }
  if (
    session.anchor.uri !== resultArtifact.uri ||
    session.anchor.fingerprint !== resultArtifact.fingerprint
  ) {
    throw new TypeError(
      "viewer session.anchor must identify the exact recorded capture artifact.",
    );
  }
  assertDigestAddress(
    captureArtifact.uri,
    captureArtifact.fingerprint,
    DFM_CAPTURE_URI_PATTERN,
    "viewer session.provenance.captureArtifact",
  );
  if (session.projection.status !== "available") return;
  const result = session.projection.result;
  if (result.capture.fingerprint !== captureArtifact.fingerprint) {
    throw new TypeError(
      "viewer session recorded capture fingerprint does not match provenance.",
    );
  }
  if (result.caseDigest !== caseDigest) {
    throw new TypeError(
      "viewer session recorded case digest does not match provenance.",
    );
  }
  if (
    inputArtifact.fingerprint !== `sha256:${result.geometry.sha256}` ||
    inputArtifact.bytes !== result.geometry.byteCount
  ) {
    throw new TypeError(
      "viewer session STEP identity does not match the recorded geometry.",
    );
  }
}

function evidenceArtifact(
  value: unknown,
  name: string,
): { uri: string; fingerprint: string } {
  const root = exactRecord(value, ["uri", "fingerprint"], name);
  return {
    uri: nonEmpty(root.uri, `${name}.uri`),
    fingerprint: fingerprint(root.fingerprint, `${name}.fingerprint`),
  };
}

function literalSession(value: unknown, expected: string, field: string): void {
  if (value !== expected) {
    throw new TypeError(`viewer session.${field} must be ${expected}.`);
  }
}
