/**
 * @casys/mcp-dfm
 *
 * MCP tools for design-for-manufacturability geometry checks:
 * envelope (bounding box vs build volume), overhang detection, and minimum
 * wall thickness by ray casting. Stateless, attestation-first, no process defaults.
 *
 * @module
 */

export {
  allTools,
  DfmToolsClient,
  getCategories,
  getToolByName,
  getToolsByCategory,
  toolsByCategory,
} from "./src/client.ts";
export type {
  DfmTool,
  DfmToolCategory,
  DfmToolHandler,
  DfmToolsClientOptions,
  MCPToolWireFormat,
} from "./src/client.ts";

export { envelopeTools } from "./src/tools/mod.ts";
export { overhangTools } from "./src/tools/mod.ts";
export { thicknessTools } from "./src/tools/mod.ts";

export {
  GmshNotFoundError,
  parseAsciiStl,
  tessellateStep,
  TessellationError,
} from "./src/api/gmsh.ts";
export type {
  TessellationOptions,
  TessellationResult,
  Triangle,
} from "./src/api/gmsh.ts";

export {
  computeBoundingBox,
  computeVolumeMm3,
  dot,
  normalize,
  overhangAngleDeg,
  triangleArea,
  triangleCentroid,
} from "./src/api/stl-geometry.ts";

export { InputArtifactError, snapshotStepArtifact } from "./src/api/input-artifact.ts";
export type { InputArtifact, StepSnapshot } from "./src/api/input-artifact.ts";

export {
  PythonRuntimeError,
  runThicknessCheck,
  ThicknessError,
} from "./src/api/thickness-runner.ts";

export {
  DFM_CAPTURE_URI_PREFIX,
  DFM_INDUSTRIALIZE_OPERATION,
  DFM_RECORDED_CHECKS_SCHEMA,
  DFM_RESULT_SCHEMA_IDS,
  DFM_RESULTS_VIEWER_URI,
  DFM_VIEW_APP_ID,
  DFM_VIEW_APP_MANIFEST,
  DFM_VIEW_APP_MANIFEST_JSON,
  DFM_VIEW_APP_MANIFEST_URI,
  DFM_VIEW_APP_VERSION,
  DFM_VIEWER_SESSION_KIND,
  DFM_VIEWER_SESSION_SCHEMA,
  dfmRecordedSessionFingerprint,
  parseDfmRawToolResult,
  parseDfmRecordedChecksResult,
  parseDfmViewerSession,
  VIEWER_SESSION_APPLY_ACTION,
} from "./src/viewer-session.ts";
export type {
  DfmRawToolResult,
  DfmRecordedChecksResult,
  DfmViewerSession,
} from "./src/viewer-session.ts";
