/**
 * Gmsh bridge — STEP file → surface STL for DFM geometry analysis.
 *
 * DFM checks need only the surface mesh (2D triangles in 3D space), not a
 * volume mesh. We invoke `gmsh -2 -format stl` to produce ASCII STL from
 * the STEP solid.
 *
 * Runtime dependency: `gmsh` must be on PATH.
 * Install: `apt install gmsh` (Debian/Ubuntu), `brew install gmsh` (macOS).
 *
 * @module lib/dfm/api/gmsh
 */

/** Raised when the gmsh executable cannot be found on PATH. */
export class GmshNotFoundError extends Error {
  constructor() {
    super(
      "The gmsh executable was not found on PATH. " +
        "Install it first: `apt install gmsh` (Debian/Ubuntu) or " +
        "`brew install gmsh` (macOS).",
    );
    this.name = "GmshNotFoundError";
  }
}

/** Raised on tessellation failures, with gmsh's own output attached. */
export class TessellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TessellationError";
  }
}

export interface TessellationOptions {
  stepPath: string;
  /** Target surface element size in mm. Explicit — no sensible default. */
  meshSizeMm: number;
  timeoutMs: number;
}

export interface Triangle {
  /** Outward unit normal declared by gmsh. */
  normal: [number, number, number];
  /** Three vertices, each [x, y, z] in mm. */
  vertices: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
}

export interface TessellationResult {
  triangles: Triangle[];
  triangleCount: number;
}

/**
 * Tessellate a STEP file into surface triangles using Gmsh (-2 surface mesh).
 *
 * The path is interpolated into a .geo script; a quote in the path would be a
 * command injection vector and is rejected before any subprocess starts.
 */
export async function tessellateStep(
  options: TessellationOptions,
): Promise<TessellationResult> {
  if (/["\\\r\n]/.test(options.stepPath)) {
    throw new TessellationError(
      `STEP path contains characters that cannot be embedded safely in a ` +
        `.geo script (quote, backslash or newline): ${options.stepPath}`,
    );
  }
  try {
    await Deno.stat(options.stepPath);
  } catch {
    throw new TessellationError(`STEP file not found: ${options.stepPath}`);
  }

  const workDir = await Deno.makeTempDir({ prefix: "dfm-mesh-" });
  const stlPath = `${workDir}/surface.stl`;
  const geoScript = `Merge "${options.stepPath}";\n` +
    `Mesh.CharacteristicLengthMax = ${options.meshSizeMm};\n` +
    `Mesh 2;\n` +
    `Save "${stlPath}";\n`;

  const geoPath = `${workDir}/surface.geo`;
  await Deno.writeTextFile(geoPath, geoScript);

  let child;
  try {
    child = new Deno.Command("gmsh", {
      args: [geoPath, "-format", "stl"],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (e) {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
    if (e instanceof Deno.errors.NotFound) throw new GmshNotFoundError();
    throw e;
  }

  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch { /* already exited */ }
  }, options.timeoutMs);
  const { success, stdout, stderr } = await child.output();
  clearTimeout(timer);

  if (!success) {
    const log = new TextDecoder().decode(stdout) +
      new TextDecoder().decode(stderr);
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
    throw new TessellationError(
      `gmsh failed (killed after ${options.timeoutMs}ms, or meshing error): ${
        log.slice(-800)
      }`,
    );
  }

  let stlText: string;
  try {
    stlText = await Deno.readTextFile(stlPath);
  } catch {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
    throw new TessellationError("gmsh reported success but wrote no STL file.");
  }
  await Deno.remove(workDir, { recursive: true }).catch(() => {});

  return parseAsciiStl(stlText);
}

/**
 * Parse an ASCII STL file into typed triangles.
 *
 * Binary STL is not supported — Gmsh always writes ASCII when invoked with
 * `-format stl` via a .geo script.
 */
export function parseAsciiStl(stlText: string): TessellationResult {
  const triangles: Triangle[] = [];
  let normal: [number, number, number] | null = null;
  const verts: [number, number, number][] = [];

  for (const rawLine of stlText.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("facet normal")) {
      const parts = line.split(/\s+/);
      normal = [
        parseFloat(parts[2]),
        parseFloat(parts[3]),
        parseFloat(parts[4]),
      ];
    } else if (line.startsWith("vertex")) {
      const parts = line.split(/\s+/);
      verts.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3]),
      ]);
    } else if (line.startsWith("endfacet")) {
      if (verts.length === 3 && normal !== null) {
        triangles.push({
          normal,
          vertices: [verts[0], verts[1], verts[2]],
        });
      }
      normal = null;
      verts.length = 0;
    }
  }

  if (triangles.length === 0) {
    throw new TessellationError(
      "STL output contains no triangles — the STEP file may be empty or malformed.",
    );
  }

  return { triangles, triangleCount: triangles.length };
}
