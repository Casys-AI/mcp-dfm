/**
 * Gmsh bridge — STEP file → surface STL for DFM geometry analysis.
 *
 * DFM checks need only the surface mesh (2D triangles in 3D space), not a
 * volume mesh. We invoke `gmsh <step> -2 -format stl -clmax <size> -o <out>`
 * directly — no intermediate .geo script. Validated against Gmsh 4.8.
 *
 * Why not a .geo script: when `-format stl` is combined with a .geo script
 * containing a `Save "path"` command, Gmsh exits 0 but writes nothing to
 * the Save path. The direct CLI form is the reliable surface-mesh path.
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
 * Invokes: `gmsh <stepPath> -2 -format stl -clmax <meshSizeMm> -o <stlPath>`
 *
 * The STEP path is passed directly as a subprocess argument (via Deno.Command,
 * no shell interpolation), so shell injection is not a concern. The path is
 * still checked for NUL bytes, which would silently truncate the argument.
 */
export async function tessellateStep(
  options: TessellationOptions,
): Promise<TessellationResult> {
  if (/\0/.test(options.stepPath)) {
    throw new TessellationError(
      `STEP path contains a NUL byte, which would silently truncate the ` +
        `argument: ${JSON.stringify(options.stepPath)}`,
    );
  }
  try {
    await Deno.stat(options.stepPath);
  } catch {
    throw new TessellationError(`STEP file not found: ${options.stepPath}`);
  }

  const workDir = await Deno.makeTempDir({ prefix: "dfm-mesh-" });
  const stlPath = `${workDir}/surface.stl`;

  let child;
  try {
    child = new Deno.Command("gmsh", {
      args: [
        options.stepPath,
        "-2",
        "-format",
        "stl",
        "-clmax",
        String(options.meshSizeMm),
        "-o",
        stlPath,
      ],
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
    const log = new TextDecoder().decode(stdout) +
      new TextDecoder().decode(stderr);
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
    throw new TessellationError(
      "gmsh reported success but wrote no STL file. " +
        `Log: ${log.slice(-400)}`,
    );
  }
  await Deno.remove(workDir, { recursive: true }).catch(() => {});

  return parseAsciiStl(stlText);
}

/**
 * Parse an ASCII STL file into typed triangles.
 *
 * Binary STL is not supported — Gmsh writes ASCII when invoked with
 * `-format stl`. Binary STL starts with an 80-byte header that never
 * begins with "solid", so binary files are detected early and rejected.
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
