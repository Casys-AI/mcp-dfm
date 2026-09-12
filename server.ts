/** Stateless HTTP MCP server for deterministic DFM geometry checks. */

import { McpApp, type RegisterViewersSummary } from "@casys/mcp-server";
import { DfmToolsClient } from "./src/client.ts";
import {
  DFM_RESULTS_VIEWER_URI,
  DFM_VIEW_APP_MANIFEST,
  DFM_VIEW_APP_MANIFEST_JSON,
  DFM_VIEW_APP_MANIFEST_URI,
} from "./src/viewer-session.ts";

const VERSION = "0.4.0";
const DEFAULT_PORT = 3018;
const DEFAULT_HOSTNAME = "127.0.0.1";

export interface CreateDfmServerOptions {
  logger?: (message: string) => void;
  viewerFileSystem?: DfmResultsViewerFileSystem;
  viewerModuleUrl?: string;
}

export interface DfmResultsViewerFileSystem {
  exists(path: string): boolean;
  readFile(path: string): string | Promise<string>;
}

export function createDfmServer(
  options: CreateDfmServerOptions = {},
): { app: McpApp; hasResultsViewer: boolean } {
  const client = new DfmToolsClient();
  const handlers = client.buildHandlersMap();
  const tools = client.toMCPFormat();

  const logger = options.logger ??
    ((message: string) => console.error(`[mcp-dfm] ${message}`));
  const app = new McpApp({
    name: "mcp-dfm",
    version: VERSION,
    transport: "stateless",
    maxConcurrent: 4,
    backpressureStrategy: "queue",
    validateSchema: true,
    instructions:
      "DFM geometry checks (envelope, overhangs, minimum wall thickness). " +
      "Each tool reports measured values and violations against caller-declared thresholds. " +
      "No verdict — the tool never declares a part manufacturable or not. " +
      "All thresholds must be supplied explicitly; no process defaults are applied.",
    logger,
  });
  const viewerRegistration = registerDfmResultsViewer(
    app,
    options.viewerFileSystem,
    options.viewerModuleUrl,
  );
  const hasResultsViewer = viewerRegistration.registered.includes(
    "results-viewer",
  );
  if (hasResultsViewer) {
    for (const tool of tools) {
      tool._meta = { ui: { resourceUri: DFM_RESULTS_VIEWER_URI } };
    }
    registerDfmViewAppManifest(app);
  }
  app.registerTools(tools, handlers);
  return { app, hasResultsViewer };
}

/** Publish the exact serialized App contract next to its HTML resource. */
export function registerDfmViewAppManifest(app: McpApp): void {
  const bytes = new TextEncoder().encode(DFM_VIEW_APP_MANIFEST_JSON);
  app.registerResource(
    {
      uri: DFM_VIEW_APP_MANIFEST_URI,
      name: "DFM View App manifest",
      description:
        `Exact ${DFM_VIEW_APP_MANIFEST.app.id}@${DFM_VIEW_APP_MANIFEST.app.version} ` +
        "whole-view and recorded-session contract.",
      mimeType: "application/json",
      size: bytes.byteLength,
    },
    (requested) => {
      if (requested.toString() !== DFM_VIEW_APP_MANIFEST_URI) {
        throw new Error("Requested URI does not match the DFM App manifest.");
      }
      return {
        uri: DFM_VIEW_APP_MANIFEST_URI,
        mimeType: "application/json",
        text: DFM_VIEW_APP_MANIFEST_JSON,
      };
    },
  );
}

/** Register the built result viewer from a checkout or package. */
export function registerDfmResultsViewer(
  app: McpApp,
  fileSystem: DfmResultsViewerFileSystem = defaultViewerFileSystem,
  moduleUrl: string = import.meta.url,
): RegisterViewersSummary {
  return app.registerViewers({
    prefix: "mcp-dfm",
    viewers: ["results-viewer"],
    moduleUrl,
    exists: fileSystem.exists,
    readFile: fileSystem.readFile,
    humanName: () => "DFM Measured Checks",
  });
}

export function createDfmResultsViewerFileSystem(
  fetchViewer: (url: string) => Promise<Response> = (url) => fetch(url),
): DfmResultsViewerFileSystem {
  return {
    exists(path) {
      if (isRemoteViewerUrl(path)) return true;
      try {
        return Deno.statSync(path).isFile;
      } catch (error) {
        if (
          error instanceof Deno.errors.NotFound ||
          error instanceof Deno.errors.PermissionDenied ||
          (error instanceof Error && error.name === "NotCapable")
        ) {
          return false;
        }
        throw error;
      }
    },
    async readFile(path) {
      if (!isRemoteViewerUrl(path)) return await Deno.readTextFile(path);
      let response: Response;
      try {
        response = await fetchViewer(path);
      } catch (error) {
        throw new Error(
          `Unable to fetch DFM results viewer from ${path}.`,
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new Error(
          `Unable to fetch DFM results viewer from ${path}: HTTP ${response.status} ${response.statusText}.`,
        );
      }
      return await response.text();
    },
  };
}

const defaultViewerFileSystem = createDfmResultsViewerFileSystem();

function isRemoteViewerUrl(path: string): boolean {
  return path.startsWith("https://") || path.startsWith("http://");
}

if (import.meta.main) {
  const cli = parseCli(Deno.args);
  const { app, hasResultsViewer } = createDfmServer();
  if (!hasResultsViewer) {
    console.error(
      "[mcp-dfm] Results viewer is not built; run `deno task build:ui`.",
    );
  }
  if (cli.transport === "stdio") {
    await app.start();
  } else {
    await app.startHttp({
      port: cli.port,
      hostname: cli.hostname,
      corsOrigins: ["http://127.0.0.1", "http://localhost"],
      onListen: ({ hostname, port }) => {
        console.error(
          `[mcp-dfm] Stateless MCP: http://${hostname}:${port}/mcp`,
        );
      },
    });
  }
}

export type CliOptions =
  | { transport: "stdio" }
  | { transport: "http"; port: number; hostname: string };

/** Parse the deliberately small native-stdio or stateless-HTTP command surface. */
export function parseCli(args: readonly string[]): CliOptions {
  if (args.includes("--stdio")) {
    if (args.length !== 1) {
      throw new TypeError("--stdio cannot be combined with HTTP options");
    }
    return { transport: "stdio" };
  }

  let port = integerEnv("MCP_PORT") ?? DEFAULT_PORT;
  let hostname = env("MCP_HOSTNAME") ?? DEFAULT_HOSTNAME;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument.startsWith("--port=")) {
      port = positivePort(argument.slice("--port=".length), "--port");
    } else if (argument === "--port") {
      port = positivePort(args[++index], "--port");
    } else if (argument.startsWith("--hostname=")) {
      hostname = nonEmpty(argument.slice("--hostname=".length), "--hostname");
    } else if (argument === "--hostname") {
      hostname = nonEmpty(args[++index], "--hostname");
    } else {
      throw new TypeError(`Unknown argument '${argument}'.`);
    }
  }
  return { transport: "http", port, hostname };
}

function positivePort(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function integerEnv(name: string): number | undefined {
  const value = env(name);
  return value === undefined ? undefined : positivePort(value, name);
}

function nonEmpty(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new TypeError(`${name} must not be empty`);
  }
  return value;
}

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}
