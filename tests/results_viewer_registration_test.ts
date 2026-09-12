import { assert, assertEquals } from "@std/assert";
import { createDfmServer } from "../server.ts";
import {
  DFM_RESULTS_VIEWER_URI,
  DFM_VIEW_APP_MANIFEST_JSON,
  DFM_VIEW_APP_MANIFEST_URI,
} from "../src/viewer-session.ts";

const PROTOCOL_VERSION = "2026-07-28";
const META = {
  "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "mcp-dfm-viewer-test",
    version: "0.1.0",
  },
};

const FAKE_HTML =
  "<!doctype html><html><head><title>DFM Measured Checks</title></head><body>ok</body></html>";

Deno.test("registers the results-viewer and App manifest from a fake HTML bundle", async () => {
  const { app, hasResultsViewer } = createDfmServer({
    logger: () => {},
    viewerFileSystem: {
      exists: () => true,
      readFile: () => FAKE_HTML,
    },
  });
  assertEquals(hasResultsViewer, true);
  const port = freePort();
  const http = await app.startHttp({
    port,
    hostname: "127.0.0.1",
    onListen: () => {},
  });
  const url = `http://127.0.0.1:${port}/mcp`;
  try {
    const listed = await rpc(url, "tools/list");
    const tools = listed.body.result.tools as Array<Record<string, unknown>>;
    assertEquals(tools.map((item) => item.name).sort(), [
      "dfm_check_envelope",
      "dfm_check_min_thickness",
      "dfm_check_overhangs",
    ]);
    for (const tool of tools) {
      assertEquals(
        ((tool._meta as Record<string, unknown>).ui as Record<string, unknown>)
          .resourceUri,
        DFM_RESULTS_VIEWER_URI,
      );
    }

    const resource = await rpc(url, "resources/read", {
      uri: DFM_RESULTS_VIEWER_URI,
    });
    const html = (resource.body.result.contents as Array<Record<string, unknown>>)[0]
      .text as string;
    assertEquals(html, FAKE_HTML);

    const listedResources = await rpc(url, "resources/list");
    const resources = listedResources.body.result.resources as Array<
      Record<string, unknown>
    >;
    assert(resources.some((item) => item.uri === DFM_VIEW_APP_MANIFEST_URI));
    const manifestResource = await rpc(url, "resources/read", {
      uri: DFM_VIEW_APP_MANIFEST_URI,
    });
    const manifestText =
      (manifestResource.body.result.contents as Array<Record<string, unknown>>)[0]
        .text as string;
    assertEquals(manifestText, DFM_VIEW_APP_MANIFEST_JSON);
  } finally {
    await http.shutdown();
  }
});

Deno.test("absence of the viewer bundle does not advertise the App", async () => {
  const { app, hasResultsViewer } = createDfmServer({
    logger: () => {},
    viewerFileSystem: {
      exists: () => false,
      readFile: () => {
        throw new Error("viewer bundle is missing");
      },
    },
  });
  assertEquals(hasResultsViewer, false);
  const port = freePort();
  const http = await app.startHttp({
    port,
    hostname: "127.0.0.1",
    onListen: () => {},
  });
  const url = `http://127.0.0.1:${port}/mcp`;
  try {
    const listed = await rpc(url, "tools/list");
    const tools = listed.body.result.tools as Array<Record<string, unknown>>;
    for (const tool of tools) {
      assertEquals(tool._meta, undefined);
    }
  } finally {
    await http.shutdown();
  }
});

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function rpc(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ response: Response; body: { result: Record<string, unknown> } }> {
  const name = method === "tools/call"
    ? params.name
    : method === "resources/read"
    ? params.uri
    : undefined;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-method": method,
      ...(typeof name === "string" ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: META },
    }),
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  if (
    typeof body !== "object" || body === null ||
    typeof (body as { result?: unknown }).result !== "object"
  ) {
    throw new TypeError("Expected a JSON-RPC response with an object result");
  }
  return {
    response,
    body: { result: (body as { result: Record<string, unknown> }).result },
  };
}
