// deno-lint-ignore-file no-explicit-any
import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import type { Kysely } from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";
import {
  CallToolRequestSchema,
  CallToolResult,
  InitializeRequestSchema,
  InitializeResult,
  JSONRPCRequest,
  JSONRPCResponse,
  ListToolsRequestSchema,
  ListToolsResult,
  Prompt,
} from "npm:@modelcontextprotocol/sdk@1.7.0/types.js";
import z from "npm:zod@^3.24.1";
import { zodToJsonSchema } from "npm:zod-to-json-schema@^3.24.3";
import { Tool } from "./tool.ts";
import { Database } from "./types.ts";
import { DB } from "./database.ts";

const RequestSchema = z.union([
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
]);

export function createMcp(input: { prompt: Prompt; tools: Tool[] }) {
  return {
    async process({
      payload,
      context,
    }: {
      payload: JSONRPCRequest;
      context: {
        companyId: string;
        userId: string;
        client: SupabaseClient<Database>;
        db: Kysely<DB>;
      };
    }) {
      const parsed = RequestSchema.parse(payload);

      const result = await (async () => {
        if (parsed.method === "initialize")
          return {
            protocolVersion: "2024-11-05",
            prompts: {
              default: input.prompt,
            },
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "carbon-purchasing",
              version: "0.0.1",
            },
          } satisfies InitializeResult;

        if (parsed.method === "tools/list") {
          return {
            tools: input.tools.map((tool) => ({
              name: tool.name,
              inputSchema: tool.args
                ? (zodToJsonSchema(tool.args as any, "args").definitions![
                    "args"
                  ] as any)
                : { type: "object" },
              description: tool.description,
            })),
          } satisfies ListToolsResult;
        }

        if (parsed.method === "tools/call") {
          const tool = input.tools.find(
            (tool) => tool.name === parsed.params.name
          );
          if (!tool) throw new Error("tool not found");

          let args = parsed.params.arguments;
          if (tool.args) {
            const validated = await tool.args["~standard"].validate(args);
            if (validated.issues) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(validated.issues),
                  },
                ],
              } satisfies CallToolResult;
            }
            args = validated.value as any;
          }

          return tool
            .run(args, context)
            .catch(
              (error) =>
                ({
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: error.message,
                    },
                  ],
                } satisfies CallToolResult)
            )
            .then(
              (result) =>
                ({
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(result, null, 2),
                    },
                  ],
                } satisfies CallToolResult)
            );
        }

        throw new Error("not implemented");
      })();

      return {
        jsonrpc: "2.0",
        id: payload.id,
        result,
      } satisfies JSONRPCResponse;
    },
  };
}
