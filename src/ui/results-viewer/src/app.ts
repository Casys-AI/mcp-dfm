import {
  type PreactSurfaceAppOptions,
  renderStatusMessage,
  startPreactSurfaceApp,
  type SurfaceAppHandle,
  type SurfaceDisplayState,
} from "@casys/mcp-view-components/preact";
import { installMcpViewFonts } from "@casys/mcp-view-components/fonts";
import {
  DFM_VIEW_APP_MANIFEST,
  DFM_VIEWER_SESSION_SCHEMA,
} from "../../../viewer-session.ts";
import { DFM_COMPONENT_REGISTRY } from "./components.tsx";
import {
  type DfmResultsViewData,
  type DisplayState,
  displayStateFromToolResult,
  displayStateFromViewerSession,
} from "./model.ts";

export const DFM_APP_INFO = {
  name: DFM_VIEW_APP_MANIFEST.app.id,
  version: DFM_VIEW_APP_MANIFEST.app.version,
} as const;

export const DFM_STATUS_CLASS = "dfm-viewer-state";
export const SESSION_REJECTED_CODE = "session-rejected";

export type DfmSurfaceState = SurfaceDisplayState<DfmResultsViewData>;

export type DfmSurfaceAppOptions = PreactSurfaceAppOptions<
  DfmResultsViewData,
  unknown
>;

export function startDfmResultsApp(
  root: HTMLElement,
): Promise<SurfaceAppHandle<DfmResultsViewData>> {
  installMcpViewFonts(root.ownerDocument);
  return startPreactSurfaceApp(dfmSurfaceAppOptions(root));
}

export function dfmSurfaceAppOptions(
  root: HTMLElement,
): DfmSurfaceAppOptions {
  return {
    root,
    info: DFM_APP_INFO,
    registry: DFM_COMPONENT_REGISTRY,
    strict: true,
    surfaceClassName: "dfm-component-surface",
    statusClassName: DFM_STATUS_CLASS,
    loadingLabel: "Receiving a DFM result or recorded measured-checks session…",
    emptyLabel: "DFM returned no supported result projection.",
    fromToolResult: (result) => toSurfaceState(displayStateFromToolResult(result)),
    viewerSession: {
      validate: (_value: unknown): _value is unknown => true,
      toState: async (value) => {
        try {
          return toSurfaceState(await displayStateFromViewerSession(value));
        } catch (error) {
          return {
            kind: "error",
            title: "Session rejected",
            code: SESSION_REJECTED_CODE,
            message: `Rejected ${DFM_VIEWER_SESSION_SCHEMA} session: ${
              errorMessage(error)
            }`,
          };
        }
      },
    },
    onError: (error) => {
      console.error("[mcp-dfm] Results projection failed", error);
    },
  };
}

export function toSurfaceState(state: DisplayState): DfmSurfaceState {
  switch (state.kind) {
    case "loading":
    case "empty":
    case "error":
    case "result":
      return state;
    case "unresolved":
      return {
        kind: "notice",
        tone: "warning",
        title: "Unresolved recorded evidence",
        message: state.reason,
        code: state.status,
      };
    case "unavailable":
      return {
        kind: "notice",
        tone: "warning",
        title: "Recorded evidence unavailable",
        message: state.reason,
        code: state.status,
      };
  }
}

export function renderStartupFailure(error: unknown): HTMLElement {
  return renderStatusMessage(
    error instanceof Error ? error.message : "The viewer could not start.",
    {
      className: DFM_STATUS_CLASS,
      title: "DFM viewer unavailable",
      tone: "danger",
    },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
