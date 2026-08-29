/**
 * The MCP server's own manifest, served at `/.well-known/mcp.json`.
 *
 * Shaped as the Model Context Protocol registry's `server.json`: `remotes[]`
 * with `type: "streamable-http"` is the field a client or a registry reads to
 * learn how to connect. Everything Carbon-specific lives under `_meta`, so the
 * document stays valid against that schema rather than growing ad-hoc top-level
 * keys a strict validator would reject.
 *
 * The tool counts and module list are derived from `tool-metadata.json` — the
 * same file the server registers from — so the manifest cannot drift from what
 * `search_tools` actually returns. Hard-coding them here is how a manifest ends
 * up promising a module that was removed two releases ago.
 */

import toolMetadataJson from "./tool-metadata.json";

type ToolSummary = {
  name: string;
  module: string;
  classification: string;
};

const toolMetadata = toolMetadataJson as unknown as {
  totalTools: number;
  modules: number;
  tools: ToolSummary[];
};

const SERVER_JSON_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json";

/**
 * The credential line in the paste-ready client config. Assembled rather than
 * written inline so `${CARBON_API_KEY}` stays what it is — a placeholder the MCP
 * client expands from its own environment — instead of reading as a template
 * literal someone will later "fix" into an empty string.
 */
const PLACEHOLDER_BEARER = ["Bearer $", "{CARBON_API_KEY}"].join("");

/** Reverse-DNS server name, as the MCP registry requires. */
export const MCP_SERVER_NAME = "ms.carbon/carbon-erp";

/** `_meta` namespace key — reverse-DNS, per the MCP `_meta` convention. */
export const MCP_META_KEY = "ms.carbon/v1";

export const MARKETING_URL = "https://carbon.ms";
export const REPOSITORY_URL = "https://github.com/crbnos/carbon";
export const DOCS_URL = "https://docs.carbon.ms";

/**
 * The three tools the server registers. Carbon publishes meta-tools rather than
 * ~1,400 flat ones: a client that loaded every ERP operation as a tool would
 * spend its whole context on definitions before doing any work.
 */
const TOOLS = [
  {
    name: "search_tools",
    description:
      "Search Carbon's ERP operations by name, module or classification (READ, WRITE, DESTRUCTIVE), and make the matches available to call.",
    readOnly: true
  },
  {
    name: "describe_tool",
    description:
      "Return the full input schema and description for one operation, so its arguments can be built correctly before calling it.",
    readOnly: true
  },
  {
    name: "call_tool",
    description:
      "Call an operation by name with its arguments. The company and user are taken from the credential, never from the arguments.",
    readOnly: false
  }
] as const;

const MODULES = [
  ...new Set(toolMetadata.tools.map((tool) => tool.module))
].sort();

const CLASSIFICATIONS = [
  ...new Set(toolMetadata.tools.map((tool) => tool.classification))
].sort();

/**
 * Build the manifest for a given origin.
 *
 * The origin is passed in rather than read from env so a self-hosted or ITAR
 * instance advertises its OWN endpoint. A manifest that points every deployment
 * at app.carbon.ms is worse than no manifest — the client connects to the wrong
 * tenant's server and fails auth with no clue why.
 */
export function buildMcpManifest(origin: string) {
  const endpoint = `${origin}/api/mcp`;

  return {
    $schema: SERVER_JSON_SCHEMA,
    name: MCP_SERVER_NAME,
    description:
      "Carbon is an API-first operating system for manufacturing (ERP, MRP, MES, QMS). This MCP server exposes its ERP operations — items, sales, purchasing, production, inventory, quality and accounting — as tools an agent can search, inspect and call.",
    version: "1.0.0",
    websiteUrl: MARKETING_URL,
    repository: {
      url: REPOSITORY_URL,
      source: "github"
    },
    remotes: [
      {
        type: "streamable-http",
        url: endpoint,
        headers: [
          {
            name: "Authorization",
            description:
              "Bearer <api-key>. Create a scoped key in Settings → API Keys. OAuth is also supported; an unauthenticated request returns 401 with a WWW-Authenticate header pointing at the protected-resource metadata.",
            isRequired: true,
            isSecret: true
          }
        ]
      }
    ],
    _meta: {
      [MCP_META_KEY]: {
        transport: "streamable-http",
        endpoint,
        serverName: "carbon-erp",
        authentication: {
          schemes: ["bearer", "oauth2"],
          /** RFC 9728 metadata, served by this same app. */
          protectedResourceMetadata: `${origin}/.well-known/oauth-protected-resource`,
          authorizationServerMetadata: `${origin}/.well-known/oauth-authorization-server`,
          scopeModel:
            "A key is scoped to one company and to explicit module permissions; row-level security in the database enforces the same boundary as the app."
        },
        tools: TOOLS,
        operations: {
          description:
            "search_tools, describe_tool and call_tool reach every ERP operation Carbon exposes, each classified READ, WRITE or DESTRUCTIVE.",
          total: toolMetadata.totalTools,
          modules: MODULES,
          classifications: CLASSIFICATIONS
        },
        documentation: {
          mcpGuide: `${DOCS_URL}/mcp`,
          apiReference: `${DOCS_URL}/api-reference`,
          authentication: `${DOCS_URL}/api-reference/authentication`,
          openapi: `${MARKETING_URL}/openapi.json`
        },
        /** Drop-in config for Claude Desktop, Claude Code and compatible clients. */
        clientConfig: {
          mcpServers: {
            carbon: {
              type: "http",
              url: endpoint,
              headers: {
                // The `${...}` is a literal placeholder the MCP CLIENT expands
                // from its own environment — not a template literal. Making it
                // one would interpolate here and publish an empty credential.
                Authorization: PLACEHOLDER_BEARER
              }
            }
          }
        }
      }
    }
  };
}
