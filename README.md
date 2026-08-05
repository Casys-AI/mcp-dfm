# @casys/mcp-dfm

Stateless MCP server for design-for-manufacturability (DFM) geometry checks.
Three oracle checks applied to STEP files — the same verifications Protolabs,
Xometry and JLC run automatically at quote time.

Port: **3018** — same toolchain as `mcp-calculix` (3015) and `mcp-build123d` (3014).
Protocol: stateless `2026-07-28`.

## Doctrine

The server computes and reports — it never judges. **"Manufacturable" is not its
verdict.** Every tool reports measured values against thresholds that the caller
declares explicitly; no process-specific default is applied silently.

What the server guarantees:
- Every check runs against the exact bytes attested by SHA-256 (see [Attestation](#attestation-pattern)).
- Every output includes a `not_checked` list — what this check does not cover is
  declared in the response, not inferred from silence.
- All units are mm and degrees throughout; mass requires an explicit `density_kg_m3`.
- Errors are typed (`GmshNotFoundError`, `PythonRuntimeError`, `InputArtifactError`) —
  never silent fallbacks.

## Runtime dependencies

| Dependency | Why | Install |
|---|---|---|
| `gmsh` on PATH | STEP → surface STL tessellation (all three tools) | `apt install gmsh` / `brew install gmsh` |
| `python3` with `numpy` | Ray-triangle intersection for `dfm_check_min_thickness` | `pip install numpy` |

The envelope and overhang checks only need `gmsh`. The thickness check additionally
needs `python3 + numpy`. Both are checked at call time and return typed errors if
missing — they do not fail silently.

Fixtures were generated with build123d inside the
`casys-digital-thread-mcp-build123d-1` container (Python 3.12 + gmsh 4.8). The
same container can be used as a runtime host when gmsh/python3 are not on the
host PATH.

## Tools

### `dfm_check_envelope`

Bounding box of the STEP file (X/Y/Z in mm) compared against a declared print
volume. Optionally reports mass when `density_kg_m3` is supplied.

Algorithm: Gmsh STEP → surface STL (`-2 -format stl`) → bounding box from vertex
extrema → volume via the divergence theorem on the closed surface →
mass = volume_mm3 / 1e9 × density_kg_m3.

**Inputs (all explicit, no defaults):**

| Field | Required | Description |
|---|---|---|
| `step_path` | yes | Absolute path to the STEP file |
| `build_volume_mm` | yes | `{x, y, z}` declared printer volume in mm |
| `mesh_size_mm` | yes | Gmsh tessellation fineness (5 mm is fine for a 50 mm part) |
| `expected_step_sha256` | no | SHA-256 hex; mismatch aborts before Gmsh |
| `density_kg_m3` | no | Required to compute `mass_kg`; omit to skip |
| `timeout_ms` | no | Gmsh subprocess timeout in ms (default 60000) |

**Output structure:**

```json
{
  "violations": [],
  "measured": { "x_mm": 40, "y_mm": 30, "z_mm": 20, "volume_mm3": 24000, "mass_kg": 0.216 },
  "limits_declared": { "build_volume_mm": { "x": 200, "y": 200, "z": 200 }, "density_kg_m3": 9000 },
  "not_checked": [
    "Part orientation is not optimised — the bounding box is axis-aligned with the STEP coordinate system; the tightest-fitting orientation is not computed.",
    "Support structure volume is not included in the envelope.",
    "Mass is not reported when density_kg_m3 is omitted.",
    "The volume computation assumes a closed (watertight) surface mesh; open shells yield an inaccurate result."
  ],
  "input_artifact": { "sha256": "a3f4...", "bytes": 15456, "source_path": "/exports/part.step" }
}
```

Measured on the healthy-box fixture (40×30×20 mm, mesh_size 5):
- bbox: 40.0 × 30.0 × 20.0 mm
- volume: 24000.0 mm³ (exact via divergence theorem on closed mesh)

---

### `dfm_check_overhangs`

Surface overhang detection. Tessellates the STEP with Gmsh, then computes the
angle between each triangle's outward normal and the declared `build_direction`.
Triangles whose angle from the downward direction (-build_direction) is below
`max_overhang_deg` are violations. Violation triangles are merged into spatial
clusters for reporting.

Angle convention: 0° = face points straight down (worst overhang); 90° = vertical
face; 180° = face points straight up (self-supporting).

**Inputs (all explicit):**

| Field | Required | Description |
|---|---|---|
| `step_path` | yes | Absolute path to the STEP file |
| `build_direction` | yes | Unit vector `[x, y, z]`; `[0, 0, 1]` = build along +Z |
| `max_overhang_deg` | yes | Threshold from downward direction (e.g. 45 for FDM) |
| `mesh_size_mm` | yes | Tessellation fineness |
| `expected_step_sha256` | no | SHA-256 hex; mismatch aborts before Gmsh |
| `cluster_radius_mm` | no | Merge radius for adjacent violation triangles (default 3× mesh_size_mm) |
| `timeout_ms` | no | Gmsh subprocess timeout in ms (default 60000) |

**What is NOT checked (declared in every response):**

- The print-bed contact face is not excluded — the bottommost face of the part always
  appears as a violation (angle = 0°). Callers should filter by the Z position of the
  part's minimum Z face.
- Support structure feasibility, cost, or optimal placement is not modelled.
- Curved surfaces are approximated by the tessellation; tighter `mesh_size_mm`
  improves accuracy at the cost of runtime.
- Material-specific bridging distance limits are not considered.
- Self-supporting geometry rules (bridges, overhangs supported by walls) are not modelled.

Measured on the overhang L-bracket fixture (mesh_size 3, threshold 45°, build +Z):
- overhang_area_mm2 > 1000 mm² (bottom + horizontal arm underside)
- at least 1 violation zone

---

### `dfm_check_min_thickness`

Minimum wall thickness by bidirectional ray casting. For each sampled triangle
centre, shoots a ray along the inward normal (negated Gmsh outward normal) and
records the first Möller-Trumbore intersection distance.

Algorithm: Gmsh STEP → surface STL → Python subprocess (numpy, embedded script,
no trimesh) → JSON result.

**Inputs (all explicit):**

| Field | Required | Description |
|---|---|---|
| `step_path` | yes | Absolute path to the STEP file |
| `min_thickness_mm` | yes | Violation threshold declared by the caller |
| `mesh_size_mm` | yes | Tessellation fineness (set ≤ min_thickness_mm / 2 to reliably catch the thinnest wall) |
| `expected_step_sha256` | no | SHA-256 hex; mismatch aborts before Gmsh |
| `sample_count` | no | Triangle centres to sample (default 500) |
| `cluster_radius_mm` | no | Merge radius for adjacent violations (default 3× mesh_size_mm) |
| `timeout_ms` | no | Total timeout covering both Gmsh and Python in ms (default 120000) |

**What is NOT checked (declared in every response):**

- Sampling may miss a wall thinner than the triangle edge length — tighten
  `mesh_size_mm` to reduce this risk.
- Only works on closed (watertight) surface meshes; open shells return an error.
- Internal features (blind holes, pockets) are measured if their surface is captured
  by the tessellation.
- Material-specific minimum feature rules (e.g. SLS vs FDM vs SLA) are not applied —
  only the caller-declared threshold is used.
- The algorithm reports thickness along the inward face normal direction, not the true
  minimum wall thickness in all directions; a very thin diagonal wall may be undersampled.

Measured on the thin-wall fixture (hollow box, 0.8 mm wall, mesh_size 0.5, sample_count 300,
threshold 1.0 mm):
- min_thickness_mm: 0.8000 mm (exact)
- 12 sample violations under the 1 mm threshold

---

## Attestation pattern

Every tool:

1. Copies the caller-supplied STEP path into a private temp directory
   (`dfm-input-XXXXX/input.step`).
2. Hashes the private copy with SHA-256 (`crypto.subtle.digest`).
3. If `expected_step_sha256` is provided, compares against the computed value and
   aborts with `InputArtifactError` on mismatch — before any subprocess starts.
4. Sets the snapshot to read-only (`chmod 0o400`) so in-process mutation fails.
5. Returns the computed hash in `input_artifact.sha256`, regardless of whether an
   expectation was provided.

The hash covers the exact bytes Gmsh will consume, even if the source path is
concurrently replaced between the call and the snapshot.

## Running

```bash
# Requires gmsh on PATH and (for thickness) python3+numpy
deno task serve               # port 3018
deno task serve -- --port=3099 --hostname=0.0.0.0

# Quality gate (no gmsh needed)
deno task release:check       # fmt + check + lint + test (19 unit tests)

# Full integration tests (requires gmsh and python3+numpy on PATH)
DFM_RUN_NATIVE=1 deno task test
```

## Docker

Port du parc : **3018** (même toolchain que `mcp-calculix` et `mcp-build123d`).

```bash
# Build (arm64 / amd64 selon la plateforme locale)
docker build -t mcp-dfm:local .

# Run — expose le port 3018 localement
docker run -d --name mcp-dfm -p 3018:3018 mcp-dfm:local

# Smoke test stateless 2026-07-28 (doit lister 3 outils)
curl -s -X POST http://127.0.0.1:3018/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'

docker stop mcp-dfm
```

Le CMD utilise `--hostname=0.0.0.0` (flag CLI natif du serveur) pour que le port
soit accessible depuis l'hôte. Les STEP à analyser doivent être montés dans le
conteneur via `-v /chemin/exports:/exports` et référencés par leur chemin absolu
dans le conteneur.

## JSR publication

`@casys/mcp-dfm` is published to JSR by Erwan (human action, separate from CI).
Running `deno publish` from CI or automation is not authorised. The
`deno task release:check` gate must pass before any publication.

## License

MIT
