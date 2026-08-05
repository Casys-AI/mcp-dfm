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
