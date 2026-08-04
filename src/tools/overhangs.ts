/**
 * dfm_check_overhangs — surface overhang detection against a declared build direction.
 *
 * Algorithm: Gmsh STEP → surface STL → per-triangle angle between outward normal
 * and the downward direction (-build_direction). Triangles with angle < threshold
 * are violations; they are clustered into spatial zones for reporting.
 *
 * @module lib/dfm/tools/overhangs
 */

import type { DfmTool } from "./types.ts";
import { tessellateStep } from "../api/gmsh.ts";
import {
  clusterViolations,
  normalize,
  overhangAngleDeg,
  triangleArea,
  triangleCentroid,
} from "../api/stl-geometry.ts";
import { snapshotStepArtifact } from "../api/input-artifact.ts";

const TOOL_NAME = "dfm_check_overhangs";

const NOT_CHECKED = [
  "The print-bed contact face is not excluded — the bottommost face of the part always appears as a violation (angle = 0°). Callers should filter by the Z position of the part's minimum Z face.",
  "Support structure feasibility, cost, or optimal placement is not modelled.",
  "Curved surfaces are approximated by the tessellation; tighter mesh_size_mm improves accuracy at the cost of runtime.",
  "Material-specific bridging distance limits are not considered.",
  "Self-supporting geometry rules (bridges, overhangs supported by walls) are not modelled.",
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
        "Spatial clusters of overhang triangles exceeding the threshold.",
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
        "total_surface_area_mm2",
        "overhang_area_mm2",
        "overhang_triangle_count",
        "total_triangle_count",
      ],
      properties: {
        total_surface_area_mm2: { type: "number" },
        overhang_area_mm2: { type: "number" },
        overhang_triangle_count: { type: "number" },
        total_triangle_count: { type: "number" },
      },
    },
    limits_declared: {
      type: "object",
      additionalProperties: false,
      required: ["max_overhang_deg", "build_direction"],
      properties: {
        max_overhang_deg: { type: "number" },
        build_direction: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
        },
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

export const overhangTools: DfmTool[] = [
  {
    name: TOOL_NAME,
    description:
      "DFM check: surface overhang detection. Tessellates the STEP with Gmsh, then " +
      "computes the angle between each triangle's outward normal and the declared " +
      "build_direction. Triangles whose angle from the downward direction " +
      "(-build_direction) is below max_overhang_deg are violation zones requiring " +
      "supports. Returns total overhang area and bounding boxes of violation clusters. " +
      "Requires gmsh on PATH. Units: mm, degrees. " +
      "NOT CHECKED: the print-bed contact face is always counted as a violation; " +
      "support feasibility/cost not modelled; bridging limits not considered; " +
      "curved surfaces approximated by tessellation.",
    category: "overhangs",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    outputSchema: OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      required: [
        "step_path",
        "build_direction",
        "max_overhang_deg",
        "mesh_size_mm",
      ],
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
        build_direction: {
          type: "array",
          items: { type: "number" },
          minItems: 3,
          maxItems: 3,
          description:
            "Unit vector of the build direction (printing upward). [0, 0, 1] = +Z upward. " +
            "Explicit — no default. The downward direction (-build_direction) is used to " +
            "detect faces that require supports.",
        },
        max_overhang_deg: {
          type: "number",
          minimum: 0,
          maximum: 90,
          description:
            "Overhang threshold in degrees from the downward direction. " +
            "Faces within this angle from downward (-build_direction) are violations. " +
            "Typical values: 45 (FDM), 30 (SLA/SLS). Explicit — no default.",
        },
        mesh_size_mm: {
          type: "number",
          description:
            "Gmsh surface element size in mm. Finer mesh = more accurate overhang " +
            "area; tighten to 1 mm for small features, use 5–10 mm for large parts.",
        },
        cluster_radius_mm: {
          type: "number",
          description:
            "Spatial radius for merging adjacent violation triangles into one zone " +
            "(default: 3× mesh_size_mm). Larger values produce fewer, coarser zones.",
        },
        timeout_ms: {
          type: "number",
          description:
            "Time limit for the Gmsh subprocess in ms (default 60000).",
        },
      },
    },
    handler: async (args) => {
      const stepPath = args.step_path as string;
      const buildDirection = args.build_direction as [number, number, number];
      const maxOverhangDeg = args.max_overhang_deg as number;
      const meshSizeMm = args.mesh_size_mm as number;
      const clusterRadiusMm = (args.cluster_radius_mm as number | undefined) ??
        meshSizeMm * 3;
      const timeoutMs = (args.timeout_ms as number) ?? 60_000;

      // Reject zero-length build direction before any subprocess.
      const normBd = normalize(buildDirection);
      if (normBd[0] === 0 && normBd[1] === 0 && normBd[2] === 0) {
        throw new TypeError(
          `[${TOOL_NAME}] build_direction must not be a zero vector.`,
        );
      }

      const snapshot = await snapshotStepArtifact(
        TOOL_NAME,
        stepPath,
        args.expected_step_sha256 as string | undefined,
      );

      try {
        const tess = await tessellateStep({
          stepPath: snapshot.artifact.path,
          meshSizeMm,
          timeoutMs,
        });

        let totalSurfaceArea = 0;
        let overhangArea = 0;
        let overhangTriangleCount = 0;
        const violationItems: {
          centroid: [number, number, number];
          area: number;
          vertices: [
            [number, number, number],
            [number, number, number],
            [number, number, number],
          ];
        }[] = [];

        for (const tri of tess.triangles) {
          const area = triangleArea(
            tri.vertices[0],
            tri.vertices[1],
            tri.vertices[2],
          );
          totalSurfaceArea += area;

          const angleDeg = overhangAngleDeg(tri.normal, buildDirection);
          if (angleDeg < maxOverhangDeg) {
            overhangArea += area;
            overhangTriangleCount++;
            violationItems.push({
              centroid: triangleCentroid(
                tri.vertices[0],
                tri.vertices[1],
                tri.vertices[2],
              ),
              area,
              vertices: tri.vertices,
            });
          }
        }

        const zones = clusterViolations(violationItems, clusterRadiusMm);

        const structuredContent = {
          violations: zones.map((z) => ({
            area_mm2: z.area_mm2,
            centroid_mm: z.centroid_mm,
            bbox: z.bbox,
          })),
          measured: {
            total_surface_area_mm2: totalSurfaceArea,
            overhang_area_mm2: overhangArea,
            overhang_triangle_count: overhangTriangleCount,
            total_triangle_count: tess.triangleCount,
          },
          limits_declared: {
            max_overhang_deg: maxOverhangDeg,
            build_direction: buildDirection,
          },
          not_checked: NOT_CHECKED,
          input_artifact: {
            sha256: snapshot.artifact.sha256,
            bytes: snapshot.artifact.bytes,
            source_path: snapshot.artifact.sourcePath,
          },
        };

        const summary = zones.length === 0
          ? `No overhang violations (threshold ${maxOverhangDeg}°, build direction [${
            buildDirection.join(", ")
          }]).`
          : `${zones.length} overhang zone(s): ${
            overhangArea.toFixed(1)
          } mm² total requires supports.`;

        return {
          content:
            `[${TOOL_NAME}] sha256:${snapshot.artifact.sha256}: ${summary}`,
          structuredContent,
        };
      } finally {
        await snapshot.cleanup();
      }
    },
  },
];
