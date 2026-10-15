#!/usr/bin/env node
/**
 * MCP server exposing the Great Men library tools over stdio.
 *
 * This is how a non-Anthropic agent runtime (OpenAI Codex, or any MCP client)
 * gets the same six tools the Claude tutor calls directly. The definitions
 * and the Zod validation are shared with `src/inference/tools.ts`.
 *
 *   node dist/mcp/server.js            (compiled)
 *   npx tsx src/mcp/server.ts          (dev)
 *
 * Environment:
 *   GREAT_MEN_ROOT        repo root holding profiles/ and research/ (default: this package)
 *   GREAT_MEN_AGE_RANGE   default lesson range for get_student_lesson: 8-10 | 11-14 | 15-18
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadCorpus, REPO_ROOT } from "../corpus/index.js";
import type { AgeRange } from "../corpus/types.js";
import { makeTutorTools, type TutorTool } from "../inference/tools.js";

export const MCP_SERVER_NAME = "great_men";

export interface LibraryServerOptions {
  root?: string;
  defaultAgeRange?: AgeRange;
}

/** Build the tool set and the two request handlers (exported so tests can call them without stdio). */
export function createLibraryHandlers(options: LibraryServerOptions = {}) {
  const root = options.root ?? REPO_ROOT;
  const corpus = loadCorpus(root);
  const tools: TutorTool[] = makeTutorTools(corpus, { root, defaultAgeRange: options.defaultAgeRange });

  // Every library tool only reads the corpus. The annotations let MCP clients that
  // gate side-effecting tools behind approval (Codex in non-interactive mode) run
  // these without asking.
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const listTools = async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, annotations })),
  });

  const callTool = async (name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return { content: [{ type: "text" as const, text: `Unknown tool ${name}` }], isError: true };
    try {
      const input = tool.parse(args ?? {});
      const text = await tool.run(input as never);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Tool failed: ${message}` }], isError: true };
    }
  };

  return { tools, listTools, callTool };
}

export function createLibraryServer(options: LibraryServerOptions = {}): Server {
  const { listTools, callTool } = createLibraryHandlers(options);
  const server = new Server({ name: MCP_SERVER_NAME, version: "0.2.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, listTools);
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments));
  return server;
}

async function main(): Promise<void> {
  const range = process.env.GREAT_MEN_AGE_RANGE as AgeRange | undefined;
  const server = createLibraryServer({ root: process.env.GREAT_MEN_ROOT, defaultAgeRange: range });
  await server.connect(new StdioServerTransport());
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
