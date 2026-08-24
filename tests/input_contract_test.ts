/**
 * Input-contract hardening: closed schemas, unknown-property rejection, and
 * finite strictly-positive numeric bounds before any STEP snapshot or native
 * subprocess. Direct-handler cases always use a missing step_path so a
 * skipped guard would surface as InputArtifactError rather than TypeError.
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createDfmServer } from "../server.ts";
import { InputArtifactError } from "../src/api/input-artifact.ts";
import { allTools } from "../src/tools/mod.ts";
import type { DfmTool } from "../src/tools/types.ts";

const PROTOCOL_VERSION = "2026-07-28";
const META = {
  "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "mcp-dfm-input-contract-test",
    version: "0.1.0",
  },
};

const MISSING_STEP = "/nonexistent/mcp-dfm-contract/part.step";

const ENVELOPE = "dfm_check_envelope";
const OVERHANGS = "dfm_check_overhangs";
const THICKNESS = "dfm_check_min_thickness";

function tool(name: string): DfmTool {
  const found = allTools.find((candidate) => candidate.name === name);
  assert(found, `missing tool ${name}`);
  return found;
}

function schemaObject(value: unknown): Record<string, unknown> {
  assert(typeof value === "object" && value !== null);
  return value as Record<string, unknown>;
}

function propertiesOf(schema: Record<string, unknown>): Record<string, unknown> {
  return schemaObject(schema.properties);
}

function numberSchema(properties: Record<string, unknown>, key: string) {
  return schemaObject(properties[key]);
}

function envelopeArgs(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step_path: MISSING_STEP,
    build_volume_mm: { x: 200, y: 200, z: 200 },
    mesh_size_mm: 5,
    ...overrides,
  };
}

function overhangArgs(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step_path: MISSING_STEP,
    build_direction: [0, 0, 1],
    max_overhang_deg: 45,
    mesh_size_mm: 5,
    ...overrides,
  };
}

function thicknessArgs(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    step_path: MISSING_STEP,
    min_thickness_mm: 1,
    mesh_size_mm: 0.5,
    ...overrides,
  };
}

async function handlerRejectsUnknownOrInvalid(
  name: string,
  args: Record<string, unknown>,
  message: string,
): Promise<void> {
  const error = await assertRejects(
    () => Promise.resolve(tool(name).handler(args)),
    TypeError,
    message,
  );
  assert(
    !(error instanceof InputArtifactError),
    `${name} must not snapshot a STEP before rejecting ${message}`,
  );
}

// ── Registered schemas ─────────────────────────────────────────────────────

Deno.test("every registered tool input schema is closed", () => {
  for (const candidate of allTools) {
    assertEquals(
      candidate.inputSchema.additionalProperties,
      false,
      `${candidate.name} inputSchema.additionalProperties must be false`,
    );
  }
});

Deno.test("numeric size fields are schema-bounded as finite strictly positive", () => {
  const envelope = propertiesOf(tool(ENVELOPE).inputSchema);
  const volume = propertiesOf(schemaObject(envelope.build_volume_mm));
  for (const axis of ["x", "y", "z"]) {
    assertEquals(numberSchema(volume, axis).exclusiveMinimum, 0);
  }
  assertEquals(numberSchema(envelope, "mesh_size_mm").exclusiveMinimum, 0);
  assertEquals(numberSchema(envelope, "density_kg_m3").exclusiveMinimum, 0);
  assertEquals(numberSchema(envelope, "timeout_ms").exclusiveMinimum, 0);

  const overhangs = propertiesOf(tool(OVERHANGS).inputSchema);
  const maxOverhang = numberSchema(overhangs, "max_overhang_deg");
  assertEquals(maxOverhang.minimum, 0);
  assertEquals(maxOverhang.maximum, 90);
  assertEquals(numberSchema(overhangs, "mesh_size_mm").exclusiveMinimum, 0);
  assertEquals(numberSchema(overhangs, "cluster_radius_mm").exclusiveMinimum, 0);
  assertEquals(numberSchema(overhangs, "timeout_ms").exclusiveMinimum, 0);

  const thickness = propertiesOf(tool(THICKNESS).inputSchema);
  assertEquals(numberSchema(thickness, "min_thickness_mm").exclusiveMinimum, 0);
  assertEquals(numberSchema(thickness, "mesh_size_mm").exclusiveMinimum, 0);
  assertEquals(numberSchema(thickness, "cluster_radius_mm").exclusiveMinimum, 0);
  assertEquals(numberSchema(thickness, "timeout_ms").exclusiveMinimum, 0);
  const sampleCount = numberSchema(thickness, "sample_count");
  assertEquals(sampleCount.type, "integer");
  assertEquals(sampleCount.exclusiveMinimum, 0);
});

// ── Direct handlers: fail before snapshot ──────────────────────────────────

Deno.test("direct handlers reject unknown properties before a missing STEP is snapshotted", async () => {
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ surprise: true }),
    "unknown argument 'surprise'",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ extra_flag: 1 }),
    "unknown argument 'extra_flag'",
  );
  await handlerRejectsUnknownOrInvalid(
    THICKNESS,
    thicknessArgs({ injected: "nope" }),
    "unknown argument 'injected'",
  );
});

Deno.test("direct handlers reject invalid sizes before a missing STEP is snapshotted", async () => {
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ mesh_size_mm: 0 }),
    "mesh_size_mm must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ mesh_size_mm: -1 }),
    "mesh_size_mm must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ mesh_size_mm: Number.POSITIVE_INFINITY }),
    "mesh_size_mm must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ mesh_size_mm: Number.NaN }),
    "mesh_size_mm must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ build_volume_mm: { x: 0, y: 200, z: 200 } }),
    "build_volume_mm.x must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ build_volume_mm: { x: 200, y: 200, z: 200, w: 1 } }),
    "build_volume_mm has unknown property 'w'",
  );
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ density_kg_m3: 0 }),
    "density_kg_m3 must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    ENVELOPE,
    envelopeArgs({ timeout_ms: -5 }),
    "timeout_ms must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ cluster_radius_mm: 0 }),
    "cluster_radius_mm must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ timeout_ms: Number.POSITIVE_INFINITY }),
    "timeout_ms must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    THICKNESS,
    thicknessArgs({ min_thickness_mm: 0 }),
    "min_thickness_mm must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    THICKNESS,
    thicknessArgs({ min_thickness_mm: Number.NaN }),
    "min_thickness_mm must be a finite positive number",
  );
  await handlerRejectsUnknownOrInvalid(
    THICKNESS,
    thicknessArgs({ sample_count: 0 }),
    "sample_count must be a finite positive integer",
  );
  await handlerRejectsUnknownOrInvalid(
    THICKNESS,
    thicknessArgs({ sample_count: 1.5 }),
    "sample_count must be a finite positive integer",
  );
  await handlerRejectsUnknownOrInvalid(
    THICKNESS,
    thicknessArgs({ sample_count: Number.POSITIVE_INFINITY }),
    "sample_count must be a finite positive integer",
  );
  await handlerRejectsUnknownOrInvalid(
    THICKNESS,
    thicknessArgs({ cluster_radius_mm: -1 }),
    "cluster_radius_mm must be a finite positive number",
  );
});

Deno.test("direct overhang handler preserves 0–90° bounds and rejects non-finite values", async () => {
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ max_overhang_deg: -0.1 }),
    "max_overhang_deg must be a finite number between 0 and 90",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ max_overhang_deg: 90.1 }),
    "max_overhang_deg must be a finite number between 0 and 90",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ max_overhang_deg: Number.NaN }),
    "max_overhang_deg must be a finite number between 0 and 90",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ max_overhang_deg: Number.POSITIVE_INFINITY }),
    "max_overhang_deg must be a finite number between 0 and 90",
  );
});

Deno.test("direct overhang handler rejects a zero or non-finite build direction before snapshot", async () => {
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ build_direction: [0, 0, 0] }),
    "build_direction must not be a zero vector",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ build_direction: [Number.NaN, 0, 1] }),
    "build_direction must be an array of three finite numbers",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ build_direction: [Number.POSITIVE_INFINITY, 0, 0] }),
    "build_direction must be an array of three finite numbers",
  );
  await handlerRejectsUnknownOrInvalid(
    OVERHANGS,
    overhangArgs({ build_direction: [0, 1] }),
    "build_direction must be an array of three finite numbers",
  );
});

Deno.test("valid direct-handler arguments still snapshot a missing STEP", async () => {
  await assertRejects(
    () => Promise.resolve(tool(ENVELOPE).handler(envelopeArgs())),
    InputArtifactError,
    "STEP file not found",
  );
  await assertRejects(
    () =>
      Promise.resolve(
        tool(OVERHANGS).handler(overhangArgs({ max_overhang_deg: 0 })),
      ),
    InputArtifactError,
    "STEP file not found",
  );
  await assertRejects(
    () =>
      Promise.resolve(
        tool(OVERHANGS).handler(overhangArgs({ max_overhang_deg: 90 })),
      ),
    InputArtifactError,
    "STEP file not found",
  );
  await assertRejects(
    () => Promise.resolve(tool(THICKNESS).handler(thicknessArgs({ sample_count: 1 }))),
    InputArtifactError,
    "STEP file not found",
  );
});

const DIRECT_HANDLERS: Array<
  [string, (overrides?: Record<string, unknown>) => Record<string, unknown>]
> = [
  [ENVELOPE, envelopeArgs],
  [OVERHANGS, overhangArgs],
  [THICKNESS, thicknessArgs],
];

Deno.test("direct handlers reject invalid step_path before a missing STEP is snapshotted", async () => {
  for (const [name, args] of DIRECT_HANDLERS) {
    await handlerRejectsUnknownOrInvalid(
      name,
      args({ step_path: 12 }),
      "step_path must be a non-empty string",
    );
    await handlerRejectsUnknownOrInvalid(
      name,
      args({ step_path: "" }),
      "step_path must be a non-empty string",
    );
    await handlerRejectsUnknownOrInvalid(
      name,
      args({ step_path: " \t\n" }),
      "step_path must be a non-empty string",
    );
  }
});

Deno.test("direct handlers reject malformed expected_step_sha256 before a missing STEP is snapshotted", async () => {
  for (const [name, args] of DIRECT_HANDLERS) {
    await handlerRejectsUnknownOrInvalid(
      name,
      args({ expected_step_sha256: "not-a-sha256" }),
      "expected_step_sha256 must be a 64-character hexadecimal SHA-256 digest",
    );
    await handlerRejectsUnknownOrInvalid(
      name,
      args({ expected_step_sha256: 1 }),
      "expected_step_sha256 must be a 64-character hexadecimal SHA-256 digest",
    );
  }
});

Deno.test("direct handlers accept an uppercase expected digest and still snapshot a missing STEP", async () => {
  const digest = "ABCDEF0123456789".repeat(4);
  for (const [name, args] of DIRECT_HANDLERS) {
    await assertRejects(
      () => Promise.resolve(tool(name).handler(args({ expected_step_sha256: digest }))),
      InputArtifactError,
      "STEP file not found",
    );
  }
});

// ── Wire-level MCP schema rejection ────────────────────────────────────────

Deno.test("MCP schema validation rejects unknown and invalid arguments before handlers run", async () => {
  const { app } = createDfmServer({ logger: () => {} });
  const port = freePort();
  const http = await app.startHttp({
    port,
    hostname: "127.0.0.1",
    onListen: () => {},
  });
  const url = `http://127.0.0.1:${port}/mcp`;

  try {
    const listed = await rpc(url, "tools/list");
    const tools = schemaObject(listed.result).tools as Array<
      Record<string, unknown>
    >;
    for (const listedTool of tools) {
      const inputSchema = schemaObject(listedTool.inputSchema);
      assertEquals(
        inputSchema.additionalProperties,
        false,
        `${listedTool.name} wire inputSchema must be closed`,
      );
    }

    await assertSchemaRejected(
      url,
      ENVELOPE,
      envelopeArgs({ surprise: true }),
      "Unknown property: surprise",
    );
    await assertSchemaRejected(
      url,
      ENVELOPE,
      envelopeArgs({ build_volume_mm: { x: 200, y: 200, z: 200, w: 1 } }),
      "Unknown property: w",
    );
    await assertSchemaRejected(
      url,
      ENVELOPE,
      envelopeArgs({ mesh_size_mm: 0 }),
      "must be > 0",
    );
    await assertSchemaRejected(
      url,
      OVERHANGS,
      overhangArgs({ max_overhang_deg: 91 }),
      "must be <= 90",
    );
    await assertSchemaRejected(
      url,
      THICKNESS,
      thicknessArgs({ sample_count: 1.5 }),
      "must be integer",
    );
  } finally {
    await http.shutdown();
  }
});

async function assertSchemaRejected(
  url: string,
  name: string,
  args: Record<string, unknown>,
  detail: string,
): Promise<void> {
  const body = await rpc(url, "tools/call", { name, arguments: args });
  assertEquals(body.result, undefined);
  const error = schemaObject(body.error);
  const message = error.message;
  assert(typeof message === "string");
  assertStringIncludes(message, `Invalid arguments for ${name}`);
  assertStringIncludes(message, detail);
  assert(
    !message.includes("STEP file not found"),
    "schema rejection must happen before STEP snapshot",
  );
}

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
): Promise<Record<string, unknown>> {
  const name = method === "tools/call" ? params.name : undefined;
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
  const body: unknown = await response.json();
  assert(typeof body === "object" && body !== null);
  return body as Record<string, unknown>;
}
