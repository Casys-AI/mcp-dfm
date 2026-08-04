# @casys/mcp-dfm

Stateless MCP server for design-for-manufacturability (DFM) geometry checks.
Three oracle checks applied to STEP files — the same verification Protolabs,
Xometry and JLC run automatically at quote time.

Port: **3018** — same toolchain as `mcp-calculix` (3015) and `mcp-build123d` (3014).
Protocol: stateless `2026-07-28`.

## Runtime dependencies

| Dependency | Why | Install |
|---|---|---|
| `gmsh` on PATH | STEP → surface STL tessellation | `apt install gmsh` / `brew install gmsh` |
| `python3` with `numpy` | Ray-triangle intersection for min-thickness check | `pip install numpy` |

The envelope and overhang checks only need `gmsh`. The thickness check additionally
needs `python3 + numpy`. Both are checked at call time and return typed
`GmshNotFoundError` / `PythonRuntimeError` if missing — they do not fail silently.

## Tools

### `dfm_check_envelope`

Bounding box of the STEP file (X/Y/Z in mm) compared against a declared print
volume. Optionally reports mass when `density_kg_m3` is supplied.

**Inputs (all explicit, no defaults):**
- `step_path` — absolute path to the STEP file
- `expected_step_sha256` — optional SHA-256 of the STEP bytes for attestation
- `build_volume_mm` — declared `{x, y, z}` printer volume in mm
- `density_kg_m3` — optional, required for mass reporting
- `mesh_size_mm` — Gmsh tessellation fineness (coarser is faster for envelope)

**Output structure:**
```json
{
  "violations": [],
  "measured": { "x_mm": 40, "y_mm": 30, "z_mm": 20, "volume_mm3": 24000 },
  "limits_declared": { "build_volume_mm": { "x": 200, "y": 200, "z": 200 } },
  "not_checked": [
    "Part orientation is not optimised — the tightest fit is not computed.",
    "Support structure volume is not included in the envelope.",
    "Mass is not reported when density_kg_m3 is omitted."
  ],
  "input_artifact": { "sha256": "...", "bytes": 15456 }
}
```

### `dfm_check_overhangs`

Surface overhang detection. Tessellates the STEP with Gmsh, then computes the
angle between each triangle's outward normal and the declared `build_direction`.
Triangles whose angle from the downward direction is below `max_overhang_deg`
are reported as violations.

**Inputs (all explicit):**
- `step_path`, `expected_step_sha256`
- `build_direction` — unit vector `[x, y, z]`; `[0, 0, 1]` = build along +Z
- `max_overhang_deg` — threshold (e.g. 45); faces within this angle from downward
  need supports
- `mesh_size_mm` — tessellation fineness

**What is NOT checked (declared in every response):**
- Support structure feasibility or cost is not modelled.
- The print-bed contact face is not excluded — the bottommost face always appears
  as a violation; callers should filter it by Z position.
- Curved surfaces are approximated by the tessellation; tighter `mesh_size_mm`
  improves accuracy at the cost of runtime.
- Material-specific bridging limits are not considered.

### `dfm_check_min_thickness`

Minimum wall thickness by bidirectional ray casting. Tessellates the STEP with
Gmsh, then for each sampled triangle centre shoots a ray along the inward normal
and records the first intersection distance.

**Algorithm:** Möller-Trumbore ray-triangle intersection in numpy (pure Python,
no trimesh). Sampling density is controlled by `sample_count`.

**Inputs (all explicit):**
- `step_path`, `expected_step_sha256`
- `min_thickness_mm` — violation threshold declared by the caller
- `mesh_size_mm` — tessellation fineness (finer mesh = more accurate but slower)
- `sample_count` — number of triangle centres sampled (default 500)

**What is NOT checked (declared in every response):**
- Sampling may miss a wall thinner than the triangle edge length — tighten
  `mesh_size_mm` to reduce this risk.
- Only works on closed (watertight) surface meshes; open shells return an error.
- Internal features (pockets, channels) are measured if their surface is captured
  by the tessellation.
- Material-specific minimum feature rules (e.g. SLS vs FDM) are not applied.

## Attestation pattern

Every tool copies the input STEP into a private temp directory, hashes the copy
with SHA-256, then optionally checks it against `expected_step_sha256`. The
hash of the bytes actually consumed is returned in `input_artifact.sha256`,
regardless of whether the caller provided an expectation.

## License

MIT
