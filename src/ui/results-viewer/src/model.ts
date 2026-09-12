import {
  DFM_RECORDED_CHECKS_SCHEMA,
  type DfmCheckVerdict,
  type DfmRawToolResult,
  type DfmRecordedChecksResult,
  type DfmViewerSession,
  parseDfmRawToolResult,
  parseDfmRecordedChecksResult,
  parseDfmViewerSession,
  QUALITY_UNAVAILABLE_REASON,
} from "../../../viewer-session.ts";

export type DfmResultsViewData = DfmRecordedChecksResult | DfmRawToolResult;

export type DisplayState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string }
  | {
    readonly kind: "unresolved";
    readonly status: "unresolved";
    readonly reason: string;
  }
  | {
    readonly kind: "unavailable";
    readonly status: "unavailable";
    readonly reason: string;
  }
  | { readonly kind: "result"; readonly result: DfmResultsViewData };

export function qualityUnavailableLabel(): string {
  return QUALITY_UNAVAILABLE_REASON;
}

export function displayStateFromToolResult(
  value: unknown,
): DisplayState {
  const result = record(value, "tool result");
  if (result.isError === true) {
    return { kind: "error", message: toolErrorMessage(result) };
  }
  const structured = result.structuredContent !== undefined
    ? (isRecord(result.structuredContent) ? result.structuredContent : undefined)
    : jsonTextFallback(result.content);
  if (structured === undefined) return { kind: "empty" };
  if (isRecordedChecksDocument(structured)) {
    return { kind: "result", result: parseDfmRecordedChecksResult(structured) };
  }
  return { kind: "result", result: parseDfmRawToolResult(structured) };
}

export async function displayStateFromViewerSession(
  value: unknown,
): Promise<DisplayState> {
  const session: DfmViewerSession = await parseDfmViewerSession(value);
  if (session.projection.status === "unresolved") {
    return {
      kind: "unresolved",
      status: "unresolved",
      reason: session.projection.reason,
    };
  }
  if (session.projection.status === "unavailable") {
    return {
      kind: "unavailable",
      status: "unavailable",
      reason: session.projection.reason,
    };
  }
  return { kind: "result", result: session.projection.result };
}

export function toolErrorMessage(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return "The DFM check reported an error.";
  }
  const text = value.content.find((item) => isRecord(item) && item.type === "text")
    ?.text;
  return typeof text === "string" && text.trim()
    ? text
    : "The DFM check reported an error.";
}

export function isRecordedChecks(
  value: DfmResultsViewData,
): value is DfmRecordedChecksResult {
  return value.kind === "digital-thread-measured-checks";
}

function isRecordedChecksDocument(value: Record<string, unknown>): boolean {
  return value.schemaVersion === DFM_RECORDED_CHECKS_SCHEMA &&
    value.kind === "digital-thread-measured-checks";
}

/** Display the recorded Digital Thread summaries; do not recompute a verdict. */
export function digitalThreadReasonSummaries(
  verdict: DfmCheckVerdict | undefined,
): string {
  if (verdict === undefined) return "unavailable";
  if (verdict.violations.length === 0) return "none";
  return verdict.violations.map((item) => item.summary).join("; ");
}

function jsonTextFallback(
  content: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (
      !isRecord(item) || item.type !== "text" || typeof item.text !== "string"
    ) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(item.text);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Human-readable summaries remain valid text blocks; try the next block.
    }
  }
  return undefined;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
