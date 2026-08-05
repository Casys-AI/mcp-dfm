/**
 * dfm_check_envelope — bounding box and optional mass vs a declared print volume.
 *
 * The simplest and most-used DFM check: does the part fit the printer, and
 * does it meet a declared mass budget?
 *
 * Algorithm: Gmsh STEP → surface STL → bounding box from vertex extrema →
 * volume from divergence theorem (closed surface only) → mass = volume × density.
 *
 * @module lib/dfm/tools/envelope
 */

import type { DfmTool } from "./types.ts";
import { GmshNotFoundError, tessellateStep, TessellationError } from "../api/gmsh.ts";
import { computeBoundingBox, computeVolumeMm3 } from "../api/stl-geometry.ts";
import { snapshotStepArtifact } from "../api/input-artifact.ts";

const TOOL_NAME = "dfm_check_envelope";

const NOT_CHECKED = [
  "Part orientation is not optimised — the bounding box is axis-aligned with the STEP coordinate system; the tightest-fitting orientation is not computed.",
  "Support structure volume is not included in the envelope.",
  "Mass is not reported when density_kg_m3 is omitted.",
  "The volume computation assumes a closed (watertight) surface mesh; open shells yield an inaccurate result.",
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
      items: {
        type: "object",
        additionalProperties: false,
        required: ["axis", "measured_mm", "limit_mm"],
        properties: {
          axis: { type: "string", enum: ["x", "y", "z"] },
          measured_mm: { type: "number" },
          limit_mm: { type: "number" },
        },
      },
    },
    measured: {
      type: "object",
      additionalProperties: false,
      required: ["x_mm", "y_mm", "z_mm", "volume_mm3"],
      properties: {
        x_mm: { type: "number" },
        y_mm: { type: "number" },
        z_mm: { type: "number" },
        volume_mm3: { type: "number" },
        mass_kg: { type: "number" },
      },
    },
    limits_declared: {
      type: "object",
      additionalProperties: false,
      required: ["build_volume_mm"],
      properties: {
        build_volume_mm: {
          type: "object",
          additionalProperties: false,
          required: ["x", "y", "z"],
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
        density_kg_m3: { type: "number" },
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

export const envelopeTools: DfmTool[] = [
  {
    name: TOOL_NAME,
    description:
      "DFM check: bounding box of a STEP file against a declared printer build volume. " +
      "Tessellates the STEP with Gmsh (-2 surface mesh), computes the axis-aligned " +
      "bounding box from vertex extrema, and reports which axes exceed the declared " +
      "build volume. Optionally reports mass when density_kg_m3 is supplied " +
      "(volume from divergence theorem on the closed surface). " +
      "The STEP is copied into a private snapshot and its SHA-256 is returned; " +
      "pass expected_step_sha256 to require a specific upstream export. " +
      "Requires gmsh on PATH (`apt install gmsh` / `brew install gmsh`). " +
      "Units: mm, kg. " +
      "NOT CHECKED: part orientation is not optimised; support volume not included; " +
      "mass omitted without density_kg_m3; volume inaccurate for open shells.",
    category: "envelope",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    outputSchema: OUTPUT_SCHEMA,
    inputSchema: {
      type: "object",
      required: ["step_path", "build_volume_mm", "mesh_size_mm"],
      properties: {
        step_path: {
          type: "string",
          description: "Absolute path to the STEP file to analyse.",
        },
        expected_step_sha256: {
          type: "string",
          pattern: "^[a-fA-F0-9]{64}$",
          description:
            "Optional SHA-256 expected for the STEP bytes. The tool copies the " +
            "source into a private snapshot, hashes that copy, and rejects a mismatch.",
        },
        build_volume_mm: {
          type: "object",
          required: ["x", "y", "z"],
          additionalProperties: false,
          properties: {
            x: {
              type: "number",
              description: "Maximum X extent of the printer build volume in mm.",
            },
            y: {
              type: "number",
              description: "Maximum Y extent of the printer build volume in mm.",
            },
            z: {
              type: "number",
              description: "Maximum Z extent of the printer build volume in mm.",
            },
          },
          description: "Declared printer build volume in mm. Explicit — no default.",
        },
        density_kg_m3: {
          type: "number",
          description:
            "Material density in kg/m³ (e.g. 2700 for Al 6061, 7850 for steel). " +
            "Required to compute mass_kg. Omit to skip mass reporting.",
        },
        mesh_size_mm: {
          type: "number",
          description:
            "Gmsh surface element size in mm. Coarser is faster for envelope checks " +
            "(the bounding box is insensitive to tessellation fineness). " +
            "Pick relative to the smallest feature (e.g. 5 for a 50 mm part).",
        },
        timeout_ms: {
          type: "number",
          description: "Time limit for the Gmsh subprocess in ms (default 60000).",
        },
      },
    },
    handler: async (args) => {
      const stepPath = args.step_path as string;
      const buildVolume = args.build_volume_mm as {
        x: number;
        y: number;
        z: number;
      };
      const densityKgM3 = args.density_kg_m3 as number | undefined;
      const meshSizeMm = args.mesh_size_mm as number;
      const timeoutMs = (args.timeout_ms as number) ?? 60_000;

      const snapshot = await snapshotStepArtifact(
        TOOL_NAME,
        stepPath,
        args.expected_step_sha256 as string | undefined,
      );

      try {
        let tess;
        try {
          tess = await tessellateStep({
            stepPath: snapshot.artifact.path,
            meshSizeMm,
            timeoutMs,
          });
        } catch (e) {
          if (
            e instanceof GmshNotFoundError || e instanceof TessellationError
          ) {
            throw e;
          }
          throw e;
        }

        const bbox = computeBoundingBox(tess.triangles);
        const [xMm, yMm, zMm] = bbox.size;
        const volumeMm3 = computeVolumeMm3(tess.triangles);

        const violations: Array<{
          axis: "x" | "y" | "z";
          measured_mm: number;
          limit_mm: number;
        }> = [];
        if (xMm > buildVolume.x) {
          violations.push({
            axis: "x",
            measured_mm: xMm,
            limit_mm: buildVolume.x,
          });
        }
        if (yMm > buildVolume.y) {
          violations.push({
            axis: "y",
            measured_mm: yMm,
            limit_mm: buildVolume.y,
          });
        }
        if (zMm > buildVolume.z) {
          violations.push({
            axis: "z",
            measured_mm: zMm,
            limit_mm: buildVolume.z,
          });
        }

        const measured: Record<string, number> = {
          x_mm: xMm,
          y_mm: yMm,
          z_mm: zMm,
          volume_mm3: volumeMm3,
        };
        if (densityKgM3 !== undefined) {
          // Volume in mm³ → m³: divide by 1e9
          measured.mass_kg = (volumeMm3 / 1e9) * densityKgM3;
        }

        const structuredContent = {
          violations,
          measured,
          limits_declared: {
            build_volume_mm: buildVolume,
            ...(densityKgM3 !== undefined ? { density_kg_m3: densityKgM3 } : {}),
          },
          not_checked: NOT_CHECKED,
          input_artifact: {
            sha256: snapshot.artifact.sha256,
            bytes: snapshot.artifact.bytes,
            source_path: snapshot.artifact.sourcePath,
          },
        };

        const summary = violations.length === 0
          ? `Part fits in build volume (${xMm.toFixed(1)} × ${yMm.toFixed(1)} × ${
            zMm.toFixed(1)
          } mm).`
          : `${violations.length} envelope violation(s): ${
            violations.map((v) =>
              `${v.axis.toUpperCase()} ${v.measured_mm.toFixed(1)} > ${v.limit_mm} mm`
            ).join(", ")
          }.`;

        return {
          content: `[${TOOL_NAME}] sha256:${snapshot.artifact.sha256}: ${summary}`,
          structuredContent,
        };
      } finally {
        await snapshot.cleanup();
      }
    },
  },
];
