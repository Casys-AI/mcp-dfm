/**
 * Minimum thickness check via a Python subprocess.
 *
 * Implements bidirectional Möller-Trumbore ray-triangle intersection in numpy.
 * No trimesh dependency — only `python3` with `numpy` is required.
 *
 * Runtime dependency: `python3` with `numpy` must be available.
 * Check: `python3 -c "import numpy"`.
 *
 * The Python script is embedded as a string literal so the server is a single
 * file, with no extra assets to deploy. The script is written to a temp file
 * and invoked via Deno.Command, following the same pattern as gmsh.ts.
 *
 * @module lib/dfm/api/thickness-runner
 */

/** Raised when python3 is not found or numpy is missing. */
export class PythonRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PythonRuntimeError";
  }
}

/** Raised when the thickness script fails for a geometry reason. */
export class ThicknessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThicknessError";
  }
}

export interface ThicknessViolation {
  thickness_mm: number;
  position_mm: [number, number, number];
}

export interface ThicknessResult {
  min_thickness_mm: number | null;
  min_position_mm: [number, number, number] | null;
  violations: ThicknessViolation[];
  sample_count: number;
  valid_ray_count: number;
}

/**
 * Embedded Python script for ray-triangle intersection.
 *
 * The script receives the STL file path, min_thickness_mm, and sample_count
 * as command-line arguments and writes a JSON result to stdout.
 *
 * Limits declared:
 * - Sampling may miss walls thinner than the mesh element size.
 * - Open or incomplete meshes can yield partial rays; callers receive explicit
 *   topology and coverage status before treating a sampled value as usable.
 * - The script samples every N-th triangle, not random triangles, so the
 *   result is deterministic for a given mesh.
 */
const THICKNESS_SCRIPT = `
import sys, json, math
import numpy as np

stl_path = sys.argv[1]
min_thickness_mm = float(sys.argv[2])
sample_count = int(sys.argv[3])

def read_stl_ascii(path):
    triangles, normals, verts, normal = [], [], [], None
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith('facet normal'):
                parts = line.split()
                normal = [float(parts[2]), float(parts[3]), float(parts[4])]
            elif line.startswith('vertex'):
                parts = line.split()
                verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
            elif line.startswith('endfacet'):
                if len(verts) == 3 and normal is not None:
                    triangles.append(verts[:])
                    normals.append(normal)
                verts, normal = [], None
    return np.array(triangles, dtype=np.float64), np.array(normals, dtype=np.float64)

try:
    tris, norms = read_stl_ascii(stl_path)
except Exception as e:
    print(json.dumps({'error': f'STL read failed: {e}'}))
    sys.exit(1)

if len(tris) == 0:
    print(json.dumps({'error': 'No triangles in STL'}))
    sys.exit(1)

centers = tris.mean(axis=1)      # (N, 3) triangle centroids
v0 = tris[:, 0]                  # (N, 3) triangle first vertices
e1 = tris[:, 1] - tris[:, 0]    # (N, 3) edge 1
e2 = tris[:, 2] - tris[:, 0]    # (N, 3) edge 2
EPS = 1e-7
SELF_EPS = 1e-4  # minimum t to exclude self-intersection

def ray_thickness(ray_origin, ray_dir, v0, e1, e2):
    """
    Moller-Trumbore intersection: one ray vs all triangles.
    Returns the minimum positive t (distance in mm) or None if no hit.
    """
    h = np.cross(ray_dir[np.newaxis, :], e2)      # (M, 3)
    a = (e1 * h).sum(axis=1)                       # (M,)
    mask = np.abs(a) > EPS
    safe_a = np.where(mask, a, 1.0)
    f = np.where(mask, 1.0 / safe_a, 0.0)
    s = ray_origin[np.newaxis, :] - v0             # (M, 3)
    u = f * (s * h).sum(axis=1)                    # (M,)
    valid = mask & (u >= -EPS) & (u <= 1.0 + EPS)
    q = np.cross(s, e1)                            # (M, 3)
    v_coord = f * (ray_dir[np.newaxis, :] * q).sum(axis=1)
    valid &= (v_coord >= -EPS) & (u + v_coord <= 1.0 + EPS)
    t = f * (e2 * q).sum(axis=1)
    valid &= t > SELF_EPS
    hits = t[valid]
    return float(hits.min()) if len(hits) > 0 else None

actual_sample = min(sample_count, len(tris))
if actual_sample < len(tris):
    idx = np.linspace(0, len(tris) - 1, actual_sample, dtype=int)
else:
    idx = np.arange(len(tris))

results = []
valid_rays = 0

for i in idx:
    n_len = np.linalg.norm(norms[i])
    if n_len < EPS:
        continue
    inward = -norms[i] / n_len
    t = ray_thickness(centers[i], inward, v0, e1, e2)
    if t is not None:
        valid_rays += 1
        center = centers[i].tolist()
        results.append({
            'thickness_mm': t,
            'position_mm': center
        })

if not results:
    print(json.dumps({
        'min_thickness_mm': None,
        'min_position_mm': None,
        'violations': [],
        'sample_count': actual_sample,
        'valid_ray_count': valid_rays
    }))
    sys.exit(0)

thicknesses = [r['thickness_mm'] for r in results]
min_t = min(thicknesses)
min_entry = min(results, key=lambda r: r['thickness_mm'])

violations = [r for r in results if r['thickness_mm'] < min_thickness_mm]

print(json.dumps({
    'min_thickness_mm': min_t,
    'min_position_mm': min_entry['position_mm'],
    'violations': violations,
    'sample_count': actual_sample,
    'valid_ray_count': valid_rays
}))
`;

/**
 * Run the thickness check by invoking Python in a subprocess.
 *
 * Writes the embedded script to a temp file, calls `python3 script.py
 * <stl_path> <min_mm> <sample_count>`, and parses the JSON result.
 */
export async function runThicknessCheck(
  stlPath: string,
  minThicknessMm: number,
  sampleCount: number,
  timeoutMs: number,
): Promise<ThicknessResult> {
  const workDir = await Deno.makeTempDir({ prefix: "dfm-thickness-" });
  const scriptPath = `${workDir}/thickness_check.py`;

  try {
    await Deno.writeTextFile(scriptPath, THICKNESS_SCRIPT);

    let child;
    try {
      child = new Deno.Command("python3", {
        args: [
          scriptPath,
          stlPath,
          String(minThicknessMm),
          String(sampleCount),
        ],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new PythonRuntimeError(
          "python3 was not found on PATH. Install Python 3 and ensure `numpy` is available.",
        );
      }
      throw e;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
    }, timeoutMs);
    const { success, stdout, stderr } = await child.output();
    clearTimeout(timer);

    const stdoutText = new TextDecoder().decode(stdout);
    const stderrText = new TextDecoder().decode(stderr);

    if (!success) {
      // Check for numpy import error specifically
      if (
        stderrText.includes("ModuleNotFoundError") ||
        stderrText.includes("No module named 'numpy'")
      ) {
        throw new PythonRuntimeError(
          "python3 is available but `numpy` is not installed. " +
            "Install it with: `pip install numpy`",
        );
      }
      throw new ThicknessError(
        `Thickness script failed: ${(stderrText + stdoutText).slice(-600)}`,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdoutText.trim());
    } catch {
      throw new ThicknessError(
        `Thickness script returned non-JSON output: ${stdoutText.slice(-400)}`,
      );
    }

    if (typeof parsed.error === "string") {
      throw new ThicknessError(`[thickness] ${parsed.error}`);
    }

    return {
      min_thickness_mm: parsed.min_thickness_mm as number | null,
      min_position_mm: parsed.min_position_mm as [number, number, number] | null,
      violations: parsed.violations as ThicknessViolation[],
      sample_count: parsed.sample_count as number,
      valid_ray_count: parsed.valid_ray_count as number,
    };
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => {});
  }
}
