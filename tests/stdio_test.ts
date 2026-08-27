/**
 * Native stdio is the public desktop and catalog path. Exercise the actual
 * server process so protocol-era negotiation cannot diverge from HTTP tests.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { TextLineStream } from "@std/streams/text-line-stream";
import denoConfig from "../deno.json" with { type: "json" };

const PACKAGE_VERSION = denoConfig.version;
const encoder = new TextEncoder();

async function collectResponses(
  stdout: ReadableStream<Uint8Array>,
  expected: number,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const responses: Record<string, unknown>[] = [];
  const lines = stdout
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());
  const deadline = AbortSignal.timeout(timeoutMs);
  const reader = lines.getReader();
  try {
    while (responses.length < expected) {
      if (deadline.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      if (value.trim() === "") continue;
      responses.push(JSON.parse(value) as Record<string, unknown>);
    }
  } finally {
    reader.releaseLock();
  }
  return responses;
}

Deno.test(
  "native stdio negotiates legacy initialize and reaches tool schema validation",
  async () => {
    const server = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        new URL("../server.ts", import.meta.url).pathname,
        "--stdio",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();

    const writer = server.stdin.getWriter();
    const send = (message: Record<string, unknown>) =>
      writer.write(encoder.encode(JSON.stringify(message) + "\n"));

    try {
      await send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "native-stdio-test", version: "0" },
        },
      });
      await send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "dfm_check_envelope",
          arguments: {},
        },
      });

      const responses = await collectResponses(server.stdout, 2, 30_000);
      assertEquals(responses.length, 2, "expected initialize and tools/call responses");

      const initialize = responses[0].result as Record<string, unknown>;
      assertEquals(responses[0].id, 1);
      assertEquals(initialize.protocolVersion, "2025-06-18");
      const serverInfo = initialize.serverInfo as Record<string, unknown>;
      assertEquals(serverInfo.name, "mcp-dfm");
      assertEquals(serverInfo.version, PACKAGE_VERSION);

      const toolCall = responses[1];
      assertEquals(toolCall.id, 2);
      assertStringIncludes(
        JSON.stringify(toolCall),
        "Invalid arguments for dfm_check_envelope",
      );
    } finally {
      await writer.close();
      server.kill("SIGTERM");
      await server.status;
    }
  },
);

Deno.test(
  "native stdio serves modern server/discover before legacy initialization",
  async () => {
    const server = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        new URL("../server.ts", import.meta.url).pathname,
        "--stdio",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();

    const writer = server.stdin.getWriter();
    try {
      await writer.write(encoder.encode(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": {
                name: "native-stdio-modern-test",
                version: "0",
              },
            },
          },
        }) + "\n",
      ));

      const responses = await collectResponses(server.stdout, 1, 30_000);
      assertEquals(responses.length, 1, "expected a modern server/discover response");
      assertEquals(responses[0].id, 3);
      const result = responses[0].result as Record<string, unknown>;
      assertEquals(result.resultType, "complete");
      const meta = result._meta as Record<string, unknown>;
      const serverInfo = meta["io.modelcontextprotocol/serverInfo"] as Record<
        string,
        unknown
      >;
      assertEquals(serverInfo.name, "mcp-dfm");
      assertEquals(serverInfo.version, PACKAGE_VERSION);
    } finally {
      await writer.close();
      server.kill("SIGTERM");
      await server.status;
    }
  },
);
