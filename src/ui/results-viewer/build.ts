import { dirname, fromFileUrl, join } from "@std/path";
import { withAuditedViewerDenoConfig } from "./local-modules.ts";

const here = dirname(fromFileUrl(import.meta.url));
export const VERSIONED_RESULTS_VIEWER = join(
  here,
  "..",
  "dist",
  "results-viewer",
  "index.html",
);

export async function buildResultsViewer(
  output = VERSIONED_RESULTS_VIEWER,
): Promise<void> {
  await withAuditedViewerDenoConfig(async (configPath) => {
    const temporaryDirectory = await Deno.makeTempDir({
      prefix: "mcp-dfm-result-viewer-",
    });
    const bundlePath = join(temporaryDirectory, "result-viewer.js");
    try {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "bundle",
          "--config",
          configPath,
          `--lock=${join(here, "deno.lock")}`,
          "--frozen",
          "--check",
          "--platform=browser",
          "--minify",
          join(here, "src", "main.ts"),
          "--output",
          bundlePath,
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const result = await command.output();
      if (!result.success) {
        throw new Error(new TextDecoder().decode(result.stderr));
      }
      const template = await Deno.readTextFile(join(here, "index.html"));
      const css = await Deno.readTextFile(join(here, "src", "styles.css"));
      const js = await Deno.readTextFile(bundlePath);
      const html = template
        .replace("/* STYLES_PLACEHOLDER */", () => css)
        .replace("/* BUNDLE_PLACEHOLDER */", () => js)
        .replaceAll(/[ \t]+(?=\r?\n)/g, "");
      await Deno.mkdir(dirname(output), { recursive: true });
      await Deno.writeTextFile(output, html);
    } finally {
      await Deno.remove(temporaryDirectory, { recursive: true });
    }
  });
  console.log("[result-viewer] wrote " + output);
}

if (import.meta.main) {
  await buildResultsViewer();
}
