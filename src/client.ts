/**
 * DFM Tools Client
 *
 * Same pattern as the other Casys MCP servers.
 *
 * @module lib/dfm/client
 */

import {
  allTools,
  getCategories,
  getToolByName,
  getToolsByCategory,
  toolsByCategory,
} from "./tools/mod.ts";
import type { DfmTool, DfmToolCategory, DfmToolHandler } from "./tools/mod.ts";
import type { MCPTool } from "@casys/mcp-server";

export { allTools, getCategories, getToolByName, getToolsByCategory, toolsByCategory };
export type { DfmTool, DfmToolCategory, DfmToolHandler };

export interface MCPToolWireFormat {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations?: MCPTool["annotations"];
  _meta?: MCPTool["_meta"];
}

export interface DfmToolsClientOptions {
  categories?: string[];
}

export class DfmToolsClient {
  private tools: DfmTool[];

  constructor(options?: DfmToolsClientOptions) {
    this.tools = options?.categories
      ? options.categories.flatMap((cat) => getToolsByCategory(cat))
      : allTools;
  }

  listTools(): DfmTool[] {
    return this.tools;
  }

  get count(): number {
    return this.tools.length;
  }

  toMCPFormat(): MCPToolWireFormat[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      annotations: t.annotations,
      _meta: t._meta,
    }));
  }

  buildHandlersMap(): Map<string, DfmToolHandler> {
    const handlers = new Map<string, DfmToolHandler>();
    for (const tool of this.tools) handlers.set(tool.name, tool.handler);
    return handlers;
  }
}
