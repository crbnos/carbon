import { Tool } from "./tool.ts";
import z from "npm:zod@^3.24.1";
import { zodToJsonSchema } from "npm:zod-to-json-schema@^3.24.3";

// Define the types locally instead of importing from @modelcontextprotocol/sdk
export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: any;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// Initialize request and result types
export interface InitializeParams {
  protocolVersion: string;
}

export const InitializeRequestSchema = z.object({
  method: z.literal("initialize"),
  params: z.object({
    protocolVersion: z.string(),
  }),
});

export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools: Record<string, any>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

// List tools request and result types
export const ListToolsRequestSchema = z.object({
  method: z.literal("tools/list"),
  params: z.object({}).optional(),
});

export interface ListToolsResult {
  tools: Array<{
    name: string;
    inputSchema: Record<string, any>;
    description: string;
  }>;
}

// Call tool request and result types
export const CallToolRequestSchema = z.object({
  method: z.literal("tools/call"),
  params: z.object({
    name: z.string(),
    arguments: z.record(z.any()),
  }),
});

export interface CallToolResult {
  isError?: boolean;
  content: Array<{
    type: string;
    text: string;
  }>;
}

const RequestSchema = z.union([
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
])

export function createMcp(input: { tools: Tool[] }) {
  return {
    async process(message: JSONRPCRequest) {
      const parsed = RequestSchema.parse(message)

      const result = await (async () => {
        if (parsed.method === "initialize")
          return {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "opencontrol",
              version: "0.0.1",
            },
          } satisfies InitializeResult

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
          } satisfies ListToolsResult
        }

        if (parsed.method === "tools/call") {
          const tool = input.tools.find(
            (tool) => tool.name === parsed.params.name,
          )
          if (!tool) throw new Error("tool not found")

          let args = parsed.params.arguments
          if (tool.args) {
            const validated = await tool.args["~standard"].validate(args)
            if (validated.issues) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(validated.issues),
                  },
                ],
              } satisfies CallToolResult
            }
            args = validated.value as any
          }

          return tool
            .run(args)
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
                }) satisfies CallToolResult,
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
                }) satisfies CallToolResult,
            )
        }

        throw new Error("not implemented")
      })()

      return {
        jsonrpc: "2.0",
        id: message.id,
        result,
      } satisfies JSONRPCResponse
    },
  }
}