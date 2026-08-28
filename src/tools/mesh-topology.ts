/**
 * Shared closed result-schema fragment for evidence from the Gmsh surface mesh.
 * The booleans describe that tessellation only; they are not a CAD validity or
 * manufacturability verdict.
 */
export const MESH_TOPOLOGY_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "closed",
    "watertight",
    "manifold",
    "orientation_consistent",
    "connected_component_count",
    "boundary_edge_count",
    "non_manifold_edge_count",
    "non_manifold_vertex_count",
    "degenerate_triangle_count",
  ],
  properties: {
    closed: { type: "boolean" },
    watertight: { type: "boolean" },
    manifold: { type: "boolean" },
    orientation_consistent: { type: "boolean" },
    connected_component_count: { type: "integer", minimum: 0 },
    boundary_edge_count: { type: "integer", minimum: 0 },
    non_manifold_edge_count: { type: "integer", minimum: 0 },
    non_manifold_vertex_count: { type: "integer", minimum: 0 },
    degenerate_triangle_count: { type: "integer", minimum: 0 },
  },
};
