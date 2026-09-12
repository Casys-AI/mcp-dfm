import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

Deno.test("viewer build fails closed without every audited split root", async () => {
  const repository = fromFileUrl(new URL("../", import.meta.url));
  const result = await new Deno.Command(Deno.execPath(), {
    cwd: repository,
    args: [
      "run",
      "--config",
      "deno.json",
      "-A",
      "src/ui/results-viewer/build.ts",
    ],
    env: {
      MCP_VIEW_LOCAL_ROOT: "",
      MCP_VIEW_CONTRACTS_LOCAL_ROOT: "",
      MCP_VIEW_COMPONENTS_LOCAL_ROOT: "",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.success, false);
  const error = new TextDecoder().decode(result.stderr);
  assertStringIncludes(error, "Missing MCP_VIEW_LOCAL_ROOT");
  assertStringIncludes(error, "no published compatibility fallback");
});

Deno.test("release check includes the versioned viewer bundle gate", async () => {
  const rootConfig = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks?: Record<string, string> };
  assertStringIncludes(
    rootConfig.tasks?.["release:check"] ?? "",
    "check:ui:bundle",
  );
});

Deno.test("DFM results viewer is one syntactically valid inline module", async () => {
  const viewer = new URL(
    "../src/ui/dist/results-viewer/index.html",
    import.meta.url,
  );
  const html = await Deno.readTextFile(viewer);

  assertEquals(
    (html.match(/<!doctype html>/gi) ?? []).length,
    1,
    "the built viewer must contain exactly one HTML document",
  );

  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assertEquals(scripts.length, 1, "the viewer must contain one inline module");
  const source = scripts[0]![1]!;
  assert(source.trim().length > 0, "the inline module must not be empty");
  assertEquals(source.includes("BUNDLE_PLACEHOLDER"), false);
  assertEquals(source.includes("<!doctype html>"), false);
  new Function(source);
});

Deno.test("built DFM viewer contains its App-owned whole view", async () => {
  const viewer = new URL(
    "../src/ui/dist/results-viewer/index.html",
    import.meta.url,
  );
  const html = await Deno.readTextFile(viewer);

  assert(html.includes("io.casys.mcp.surface/v1"));
  assert(html.includes("io.casys.mcp.view-components/v1"));
  assert(html.includes("dfm.measured-checks"));
  assert(html.includes("mcp-view-semantic-element"));
  assert(html.includes("viewer.session.apply"));
  assert(html.includes("io.casys.mcp-dfm.results"));
  assert(html.includes("whole-view"));
  assert(html.includes("io.casys.mcp-dfm.recorded-checks-session/1.0"));
  assert(html.includes("industrialize.run-dfm-checks"));
  assert(html.includes("Digital Thread"));
  assertEquals(html.includes("manufacturable"), true);
  assertEquals(html.includes("gmsh"), false);
  assert(html.includes("private path or command"));
  assertEquals(html.includes("/exports/"), false);
  assert(html.includes("color-scheme: light dark") || html.includes("data-theme"));
});
