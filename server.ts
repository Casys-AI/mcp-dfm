/** Stateless HTTP MCP server for deterministic DFM geometry checks. */

import { McpApp } from "@casys/mcp-server";
import { DfmToolsClient } from "./src/client.ts";

const VERSION = "0.2.2";
const DEFAULT_PORT = 3018;
const DEFAULT_HOSTNAME = "127.0.0.1";

export interface CreateDfmServerOptions {
  logger?: (message: string) => void;
}

export function createDfmServer(
  options: CreateDfmServerOptions = {},
): { app: McpApp } {
  const client = new DfmToolsClient();
  const handlers = client.buildHandlersMap();

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
    logger: options.logger ??
      ((message) => console.error(`[mcp-dfm] ${message}`)),
  });
  app.registerTools(client.toMCPFormat(), handlers);
  return { app };
}

if (import.meta.main) {
  const cli = parseCli(Deno.args);
  const { app } = createDfmServer();
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
