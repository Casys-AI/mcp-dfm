/**
 * DFM tool contracts
 *
 * @module lib/dfm/tools/types
 */

import type { MCPTool, MCPToolMeta } from "@casys/mcp-server";

export type DfmToolCategory = "envelope" | "overhangs" | "thickness";

export type DfmToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

/** DFM tool definition with handler. */
export interface DfmTool {
  name: string;
  description: string;
  category: DfmToolCategory;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations?: MCPTool["annotations"];
  handler: DfmToolHandler;
  _meta?: MCPToolMeta;
}
