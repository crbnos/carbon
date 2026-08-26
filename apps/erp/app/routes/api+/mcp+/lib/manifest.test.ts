import { describe, expect, it } from "vitest";
import { buildMcpManifest, MCP_META_KEY, MCP_SERVER_NAME } from "./manifest";
import toolMetadataJson from "./tool-metadata.json";

const toolMetadata = toolMetadataJson as unknown as {
  totalTools: number;
  tools: { module: string; classification: string }[];
};

const ORIGIN = "https://app.carbon.ms";
const manifest = buildMcpManifest(ORIGIN);
const meta = manifest._meta[MCP_META_KEY];

describe("buildMcpManifest", () => {
  it("declares the registry schema and a reverse-DNS name", () => {
    expect(manifest.$schema).toMatch(/server\.schema\.json$/);
    expect(manifest.name).toBe(MCP_SERVER_NAME);
    expect(manifest.name).toMatch(/^[a-z0-9.-]+\/[a-z0-9-]+$/);
  });

  it("advertises Streamable HTTP at this deployment's own endpoint", () => {
    expect(manifest.remotes[0].type).toBe("streamable-http");
    expect(manifest.remotes[0].url).toBe(`${ORIGIN}/api/mcp`);
    expect(meta.transport).toBe("streamable-http");
    expect(meta.endpoint).toBe(`${ORIGIN}/api/mcp`);
  });

  it("follows the origin, so a self-hosted instance points at itself", () => {
    // A manifest that hard-codes app.carbon.ms sends every self-hosted client
    // to the wrong tenant's server.
    const selfHosted = buildMcpManifest("https://erp.example.com");
    const selfHostedMeta = selfHosted._meta[MCP_META_KEY];

    expect(selfHosted.remotes[0].url).toBe("https://erp.example.com/api/mcp");
    expect(selfHostedMeta.authentication.protectedResourceMetadata).toBe(
      "https://erp.example.com/.well-known/oauth-protected-resource"
    );
    expect(selfHostedMeta.clientConfig.mcpServers.carbon.url).toBe(
      "https://erp.example.com/api/mcp"
    );
  });

  it("points at the OAuth metadata this app actually serves", () => {
    // Both paths have routes in apps/erp/app/routes/.
    expect(meta.authentication.protectedResourceMetadata).toBe(
      `${ORIGIN}/.well-known/oauth-protected-resource`
    );
    expect(meta.authentication.authorizationServerMetadata).toBe(
      `${ORIGIN}/.well-known/oauth-authorization-server`
    );
    expect(meta.authentication.schemes).toContain("bearer");
  });

  it("marks the credential required and secret", () => {
    const header = manifest.remotes[0].headers[0];
    expect(header.name).toBe("Authorization");
    expect(header.isRequired).toBe(true);
    expect(header.isSecret).toBe(true);
  });

  it("describes exactly the tools the server registers", () => {
    expect(meta.tools.map((tool) => tool.name)).toEqual([
      "search_tools",
      "describe_tool",
      "call_tool"
    ]);
    for (const tool of meta.tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
  });

  it("derives its counts from tool-metadata rather than restating them", () => {
    // This is the anti-drift property: remove a module and the manifest stops
    // advertising it without anyone remembering to edit this file.
    const modules = [
      ...new Set(toolMetadata.tools.map((t) => t.module))
    ].sort();
    const classifications = [
      ...new Set(toolMetadata.tools.map((t) => t.classification))
    ].sort();

    expect(meta.operations.total).toBe(toolMetadata.totalTools);
    expect(meta.operations.modules).toEqual(modules);
    expect(meta.operations.classifications).toEqual(classifications);
    expect(modules.length).toBeGreaterThan(0);
  });

  it("leaves the client-config credential as an unexpanded placeholder", () => {
    // If someone turns this into a template literal it interpolates to
    // "Bearer " and the published config hands out an empty credential.
    // The `\{` escape keeps this an independent literal — no interpolation
    // here, and no lint suppression needed to assert on a `${...}` placeholder.
    expect(meta.clientConfig.mcpServers.carbon.headers.Authorization).toBe(
      `Bearer $\{CARBON_API_KEY}`
    );
  });

  it("keeps every Carbon-specific field inside _meta", () => {
    // Unknown top-level keys risk failing a strict registry validator.
    expect(Object.keys(manifest).sort()).toEqual([
      "$schema",
      "_meta",
      "description",
      "name",
      "remotes",
      "repository",
      "version",
      "websiteUrl"
    ]);
  });

  it("serializes to JSON without loss", () => {
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});

describe("/.well-known/mcp.json", () => {
  it("serves the manifest as public, CORS-open JSON", async () => {
    const { loader } = await import("../../../[.]well-known.mcp[.]json");

    const response = await loader({
      request: new Request("https://app.carbon.ms/.well-known/mcp.json")
    } as Parameters<typeof loader>[0]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");

    const body = await response.json();
    expect(body.name).toBe(MCP_SERVER_NAME);
    expect(body.remotes[0].type).toBe("streamable-http");
    expect(body.remotes[0].url).toMatch(/\/api\/mcp$/);
  });
});
