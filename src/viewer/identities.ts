/**
 * App, resource, and recorded-session identities owned by mcp-dfm.
 *
 * Package, server, and App versions are 0.4.0. The App is the shipped
 * read-only viewer for this release; it does not recompute measurements
 * or declare a part manufacturable.
 */

export const DFM_RESULTS_VIEWER_URI = "ui://mcp-dfm/results-viewer" as const;
export const DFM_VIEW_APP_MANIFEST_URI = "ui://mcp-dfm/app-manifest" as const;

export const DFM_VIEW_APP_ID = "io.casys.mcp-dfm.results" as const;
export const DFM_VIEW_APP_TITLE = "DFM Measured Checks" as const;
export const DFM_VIEW_APP_VERSION = "0.4.0" as const;

export const DFM_VIEWER_SESSION_SCHEMA =
  "io.casys.mcp-dfm.recorded-checks-session/1.0" as const;
export const DFM_VIEWER_SESSION_KIND = "dfm.measured-checks" as const;

export const DFM_RECORDED_CHECKS_SCHEMA =
  "io.casys.mcp-dfm.recorded-checks/1.0" as const;
export const DFM_ENVELOPE_RAW_SCHEMA = "io.casys.mcp-dfm.envelope-raw/1.0" as const;
export const DFM_THICKNESS_RAW_SCHEMA =
  "io.casys.mcp-dfm.min-thickness-raw/1.0" as const;
export const DFM_OVERHANGS_RAW_SCHEMA = "io.casys.mcp-dfm.overhangs-raw/1.0" as const;

export const DFM_RESULT_SCHEMA_IDS = {
  recordedChecks: DFM_RECORDED_CHECKS_SCHEMA,
  envelopeRaw: DFM_ENVELOPE_RAW_SCHEMA,
  thicknessRaw: DFM_THICKNESS_RAW_SCHEMA,
  overhangsRaw: DFM_OVERHANGS_RAW_SCHEMA,
} as const;

export const DFM_CAPTURE_URI_PREFIX = "casys://dfm-check-capture/sha256/" as const;
export const DFM_CAPTURE_URI_PATTERN =
  /^casys:\/\/dfm-check-capture\/sha256\/([a-f0-9]{64})$/;

export const DFM_INDUSTRIALIZE_OPERATION = "industrialize.run-dfm-checks@1" as const;

export const DFM_ENVELOPE_TOOL = "dfm_check_envelope" as const;
export const DFM_THICKNESS_TOOL = "dfm_check_min_thickness" as const;
export const DFM_OVERHANG_TOOL = "dfm_check_overhangs" as const;

export const DFM_TARGET_MEDIA_TYPE = "model/step" as const;

export const QUALITY_UNAVAILABLE_REASON = "not recorded on the capture" as const;
export const QUALITY_ABSENT_ON_RESULT_REASON =
  "not present on the tool result" as const;

export const DIGITAL_THREAD_EVALUATION_OWNER = "digital-thread" as const;
