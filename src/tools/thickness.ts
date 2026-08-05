/**
 * dfm_check_min_thickness — minimum wall thickness via bidirectional ray casting.
 *
 * Algorithm:
 *   1. Gmsh STEP → surface STL (ASCII, watertight).
 *   2. Python subprocess: Möller-Trumbore ray-triangle intersection in numpy.
 *      For each sampled triangle centre, cast a ray along the inward normal
 *      (negated gmsh outward normal) and record the first intersection distance.
 *   3. Report minimum thickness found, its position, and all sample points
 *      below min_thickness_mm declared by the caller.
 *
 * Runtime dependencies:
 *   - `gmsh` on PATH (for STEP → STL tessellation)
 *   - `python3` with `numpy` (for ray-triangle intersection)
 *
 * Why not trimesh: trimesh is not available in the current engineering toolchain
 * environments. The numpy Möller-Trumbore implementation is self-contained
 * (~50 lines, embedded in the subprocess script) and has no extra dependencies.
 *
 * @module lib/dfm/tools/thickness
 */

import type { DfmTool } from "./types.ts";
import { tessellateStep } from "../api/gmsh.ts";
import { clusterViolations } from "../api/stl-geometry.ts";
import { runThicknessCheck } from "../api/thickness-runner.ts";
import { snapshotStepArtifact } from "../api/input-artifact.ts";

const TOOL_NAME = "dfm_check_min_thickness";

const NOT_CHECKED = [
  "Sampling may miss a wall thinner than the mesh triangle edge length — tighten mesh_size_mm to reduce this risk.",
  "Only works on closed (watertight) surface meshes; open shells return an error.",
  "Internal features (blind holes, pockets) are measured if their surface is captured by the tessellation.",
  "Material-specific minimum feature rules (e.g. SLS vs FDM vs SLA) are not applied — only the caller-declared threshold is used.",
  "The algorithm reports thickness along the inward face normal direction, not the true minimum wall thickness in all directions; a very thin diagonal wall may be undersampled.",
];

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "violations",
    "measured",
    "limits_declared",
    "not_checked",
    "input_artifact",
  ],
  properties: {
    violations: {
      type: "array",
      description:
        "Sampled positions where measured thickness is below min_thickness_mm.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area_mm2", "centroid_mm", "bbox"],
        properties: {
          area_mm2: { type: "number" },
          centroid_mm: {
            type: "array",
            items: { type: "number" },
            minItems: 3,
            maxItems: 3,
          },
          bbox: {
            type: "object",
            additionalProperties: false,
            required: ["min", "max", "size"],
            properties: {
              min: {
                type: "array",
                items: { type: "number" },
                minItems: 3,
                maxItems: 3,
              },
              max: {
                type: "array",
                items: { type: "number" },
                minItems: 3,
                maxItems: 3,
              },
              size: {
                type: "array",
                items: { type: "number" },
                minItems: 3,
                maxItems: 3,
              },
            },
          },
        },
      },
    },
    measured: {
      type: "object",
      additionalProperties: false,
      required: [
        "min_thickness_mm",
        "min_position_mm",
        "sample_count",
        "valid_ray_count",
      ],
      properties: {
        min_thickness_mm: { type: "number" },
        min_position_mm: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
        },
        sample_count: { type: "number" },
        valid_ray_count: { type: "number" },
      },
    },
    limits_declared: {
      type: "object",
      additionalProperties: false,
      required: ["min_thickness_mm"],
      properties: {
        min_thickness_mm: { type: "number" },
      },
    },
    not_checked: { type: "array", items: { type: "string" } },
    input_artifact: {
      type: "object",
      additionalProperties: false,
      required: ["sha256", "bytes", "source_path"],
      properties: {
        sha256: { type: "string" },
        bytes: { type: "number" },
        source_path: { type: "string" },
      },
    },
  },
};

export const thicknessTools: DfmTool[] = [
  {
    name: TOOL_NAME,
    description: "DFM check: minimum wall thickness by bidirectional ray casting. " +
      "Tessellates the STEP with Gmsh (surface STL), then invokes a Python subprocess " +
      "using Möller-Trumbore ray-triangle intersection in numpy (no trimesh). " +
      "For each sampled triangle centre, shoots a ray along the inward normal and " +
      "records the first intersection distance. Reports the minimum thickness found, " +
      "its 3D position, and all sample points below the caller-declared min_thickness_mm. " +
      "Requires gmsh on PATH and python3 with numpy. Units: mm. " +
      "NOT CHECKED: sampling may miss walls thinner than the triangle edge length; " +
      "only valid for closed (watertight) meshes; material-specific rules not applied.",
    category: "thickness",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    outputSchema: OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      required: ["step_path", "min_thickness_mm", "mesh_size_mm"],
      properties: {
        step_path: {
          type: "string",
          description: "Absolute path to the STEP file.",
        },
        expected_step_sha256: {
          type: "string",
          pattern: "^[a-fA-F0-9]{64}$",
          description:
            "Optional SHA-256 expected for the STEP bytes. Mismatch aborts before Gmsh.",
        },
        min_thickness_mm: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Violation threshold declared by the caller in mm. " +
            "Only this declared value determines violations — the tool does not " +
            "apply any process-specific default.",
        },
        mesh_size_mm: {
          type: "number",
          description:
            "Gmsh surface element size in mm. Smaller = finer mesh = more accurate " +
            "but slower. Set to ≤ min_thickness_mm / 2 to reliably detect the thinnest wall.",
        },
        sample_count: {
          type: "number",
          description:
            "Number of triangle centres to sample for ray casting (default 500). " +
            "Higher values improve coverage at the cost of runtime.",
        },
        cluster_radius_mm: {
          type: "number",
          description:
            "Spatial radius for merging adjacent violation points into one zone " +
            "(default: 3× mesh_size_mm).",
        },
        timeout_ms: {
          type: "number",
          description:
            "Total time limit in ms covering both Gmsh and Python subprocess (default 120000).",
        },
      },
    },
    handler: async (args) => {
      const stepPath = args.step_path as string;
      const minThicknessMm = args.min_thickness_mm as number;
      const meshSizeMm = args.mesh_size_mm as number;
      const sampleCount = (args.sample_count as number | undefined) ?? 500;
      const clusterRadiusMm = (args.cluster_radius_mm as number | undefined) ??
        meshSizeMm * 3;
      const timeoutMs = (args.timeout_ms as number) ?? 120_000;

      if (minThicknessMm <= 0) {
        throw new TypeError(
          `[${TOOL_NAME}] min_thickness_mm must be positive.`,
        );
      }

      const snapshot = await snapshotStepArtifact(
        TOOL_NAME,
        stepPath,
        args.expected_step_sha256 as string | undefined,
      );

      try {
        // Tessellate in a temp directory; the STL is then passed to the Python script.
        const tessWorkDir = await Deno.makeTempDir({
          prefix: "dfm-thick-stl-",
        });
        const stlPath = `${tessWorkDir}/surface.stl`;

        try {
          // We need the STL on disk for the Python script; tessellateStep uses an
          // internal temp dir so we run Gmsh ourselves to control the output path.
          const tess = await tessellateStep({
            stepPath: snapshot.artifact.path,
            meshSizeMm,
            timeoutMs: timeoutMs / 2,
          });

          // Write the parsed STL back as ASCII for the Python subprocess.
          const lines: string[] = ["solid dfm"];
          for (const tri of tess.triangles) {
            const [nx, ny, nz] = tri.normal;
            lines.push(
              `  facet normal ${nx} ${ny} ${nz}`,
              "    outer loop",
              ...tri.vertices.map(([x, y, z]) => `      vertex ${x} ${y} ${z}`),
              "    endloop",
              "  endfacet",
            );
          }
          lines.push("endsolid dfm");
          await Deno.writeTextFile(stlPath, lines.join("\n"));

          const result = await runThicknessCheck(
            stlPath,
            minThicknessMm,
            sampleCount,
            timeoutMs / 2,
          );

          // Cluster violations into spatial zones.
          const violationItems = result.violations.map((v) => ({
            centroid: v.position_mm,
            area: 0, // point violations have no area
            vertices: [
              v.position_mm,
              v.position_mm,
              v.position_mm,
            ] as [
              [number, number, number],
              [number, number, number],
              [number, number, number],
            ],
          }));
          const zones = clusterViolations(violationItems, clusterRadiusMm);

          const structuredContent = {
            violations: zones.map((z) => ({
              area_mm2: z.area_mm2,
              centroid_mm: z.centroid_mm,
              bbox: z.bbox,
            })),
            measured: {
              min_thickness_mm: result.min_thickness_mm,
              min_position_mm: result.min_position_mm,
              sample_count: result.sample_count,
              valid_ray_count: result.valid_ray_count,
            },
            limits_declared: {
              min_thickness_mm: minThicknessMm,
            },
            not_checked: NOT_CHECKED,
            input_artifact: {
              sha256: snapshot.artifact.sha256,
              bytes: snapshot.artifact.bytes,
              source_path: snapshot.artifact.sourcePath,
            },
          };

          const summary = zones.length === 0
            ? `No thickness violations (min measured: ${
              result.min_thickness_mm.toFixed(3)
            } mm, threshold: ${minThicknessMm} mm).`
            : `${zones.length} thin zone(s): min thickness ${
              result.min_thickness_mm.toFixed(3)
            } mm (threshold: ${minThicknessMm} mm).`;

          return {
            content: `[${TOOL_NAME}] sha256:${snapshot.artifact.sha256}: ${summary}`,
            structuredContent,
          };
        } finally {
          await Deno.remove(tessWorkDir, { recursive: true }).catch(() => {});
        }
      } finally {
        await snapshot.cleanup();
      }
    },
  },
];
