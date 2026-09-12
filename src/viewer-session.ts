/**
 * App-owned, read-only projection contract for reopening DFM measured checks.
 *
 * The Digital Thread host transports this envelope unchanged through
 * `viewer.session.apply`. The provider does not run a solver, recompute a
 * verdict, or declare a part manufacturable.
 */

export {
  DFM_CAPTURE_URI_PATTERN,
  DFM_CAPTURE_URI_PREFIX,
  DFM_ENVELOPE_RAW_SCHEMA,
  DFM_ENVELOPE_TOOL,
  DFM_INDUSTRIALIZE_OPERATION,
  DFM_OVERHANG_TOOL,
  DFM_OVERHANGS_RAW_SCHEMA,
  DFM_RECORDED_CHECKS_SCHEMA,
  DFM_RESULT_SCHEMA_IDS,
  DFM_RESULTS_VIEWER_URI,
  DFM_TARGET_MEDIA_TYPE,
  DFM_THICKNESS_RAW_SCHEMA,
  DFM_THICKNESS_TOOL,
  DFM_VIEW_APP_ID,
  DFM_VIEW_APP_MANIFEST_URI,
  DFM_VIEW_APP_TITLE,
  DFM_VIEW_APP_VERSION,
  DFM_VIEWER_SESSION_KIND,
  DFM_VIEWER_SESSION_SCHEMA,
  DIGITAL_THREAD_EVALUATION_OWNER,
  QUALITY_ABSENT_ON_RESULT_REASON,
  QUALITY_UNAVAILABLE_REASON,
} from "./viewer/identities.ts";

export {
  DFM_VIEW_APP_MANIFEST,
  DFM_VIEW_APP_MANIFEST_JSON,
  VIEW_APP_MANIFEST_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "./viewer/manifest.ts";
export type { DfmViewAppManifest } from "./viewer/manifest.ts";

export {
  dfmRecordedSessionFingerprint,
  parseDfmViewerSession,
} from "./viewer/session.ts";
export type {
  DfmViewerSession,
  DfmViewerSessionAnchor,
  DfmViewerSessionBasis,
  DfmViewerSessionProjection,
  DfmViewerSessionProvenance,
} from "./viewer/session.ts";

export { parseDfmRecordedChecksResult } from "./viewer/recorded-checks.ts";
export type {
  DfmCheckName,
  DfmCheckStatus,
  DfmCheckVerdict,
  DfmEnvelopeAxisViolation,
  DfmNamedViolation,
  DfmRecordedChecksResult,
  DfmRecordedEvaluations,
  DfmZMinFilterTrace,
  DfmZone,
} from "./viewer/recorded-checks.ts";

export { parseDfmRawToolResult } from "./viewer/raw-result.ts";
export type {
  DfmQuality,
  DfmRawEnvelopeResult,
  DfmRawOverhangResult,
  DfmRawThicknessResult,
  DfmRawToolResult,
} from "./viewer/raw-result.ts";
