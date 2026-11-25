import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { EssiBackend, ToolError } from "./backend.js";

function boundedJson(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 64 * 1024) {
    throw new ToolError("RESULT_TOO_LARGE", "Essi's response exceeded the size limit. Try a narrower query.");
  }
  return json;
}

async function tool(work: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    const data = await work();
    return { structuredContent: data, content: [{ type: "text", text: boundedJson(data) }] };
  } catch (error) {
    const failure = {
      error: error instanceof ToolError
        ? { code: error.code, message: error.message }
        : { code: "BACKEND_ERROR", message: "Essi could not complete this request." },
    };
    return { isError: true, structuredContent: failure, content: [{ type: "text", text: JSON.stringify(failure) }] };
  }
}

export function createServer(backend: EssiBackend) {
  const server = new McpServer({ name: "essi-mcp", version: "0.1.0" });
  const annotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: true };
  server.registerTool("lookup_word", {
    description: "Find verified Mattokki roots by word form or English/Arabic gloss. Returns all script forms, source, and an audio asset ID when available.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(80).describe("A word form or gloss to search for"),
      script: z.enum(["latin", "arabic", "coptic"]).optional().describe("Limit word-form search to this script"),
    }),
    annotations,
  }, ({ query, script }) => tool(async () => ({ roots: await backend.lexicon(query, script) })));

  server.registerTool("list_lessons", {
    description: "List Essi lesson IDs and titles in curriculum order. Use get_lesson for exercises.",
    inputSchema: z.object({}),
    annotations,
  }, () => tool(async () => ({ lessons: await backend.lessons() })));

  server.registerTool("get_lesson", {
    description: "Get an Essi lesson, its exercises, and associated verified morphology rules.",
    inputSchema: z.object({ id: z.string().trim().min(1).max(64).describe("ID returned by list_lessons") }),
    annotations,
  }, ({ id }) => tool(() => backend.lesson(id)));

  server.registerTool("explain_morphology", {
    description: "Find verified Essi rules and attested examples for a morphology family. Empty means no verified records are available.",
    inputSchema: z.object({
      rule: z.enum(["accusative", "copula", "indefinite", "tense", "plural", "genitive", "locative"]),
    }),
    annotations,
  }, ({ rule }) => tool(async () => ({ rules: await backend.morphology(rule) })));

  server.registerTool("my_progress", {
    description: "Get the signed-in learner's XP, recorded answer accuracy, and up to five weakest rules by recall probability.",
    inputSchema: z.object({}),
    annotations,
  }, () => tool(() => backend.progress()));

  server.registerTool("review_queue", {
    description: "Get due review exercises and their lexeme and rule IDs for the signed-in learner.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(15) }),
    annotations,
  }, ({ limit }) => tool(() => backend.review(limit)));

  const resources = [
    { name: "lexicon", description: "Verified Mattokki roots and glosses", read: () => backend.lexicon() },
    { name: "morphology", description: "Verified Mattokki rules and examples", read: () => backend.morphology() },
  ];
  for (const { name, description, read } of resources) {
    const mimeType = "text/plain";
    server.registerResource(name, `essi://${name}`, { description, mimeType }, async (uri) => {
      try {
        return { contents: [{ uri: uri.href, mimeType, text: boundedJson(await read()) }] };
      } catch (error) {
        const message = error instanceof ToolError ? error.message : "Essi could not read this resource.";
        throw new McpError(ErrorCode.InternalError, message);
      }
    });
  }
  return server;
}
