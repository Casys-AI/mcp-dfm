/**
 * DFM tools — aggregated exports
 *
 * @module lib/dfm/tools/mod
 */

export type { DfmTool, DfmToolCategory, DfmToolHandler } from "./types.ts";
export { envelopeTools } from "./envelope.ts";
export { overhangTools } from "./overhangs.ts";
export { thicknessTools } from "./thickness.ts";

import { envelopeTools } from "./envelope.ts";
import { overhangTools } from "./overhangs.ts";
import { thicknessTools } from "./thickness.ts";
import type { DfmTool } from "./types.ts";

/** All DFM tools combined. */
export const allTools: DfmTool[] = [
  ...envelopeTools,
  ...overhangTools,
  ...thicknessTools,
];

/** Tools organized by category. */
export const toolsByCategory: Record<string, DfmTool[]> = {
  envelope: envelopeTools,
  overhangs: overhangTools,
  thickness: thicknessTools,
};

export function getToolsByCategory(category: string): DfmTool[] {
  return toolsByCategory[category] ?? [];
}

export function getToolByName(name: string): DfmTool | undefined {
  return allTools.find((t) => t.name === name);
}

export function getCategories(): string[] {
  return Object.keys(toolsByCategory);
}
