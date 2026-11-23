// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildMcpManifest, MCP_META_KEY } from "./manifest";
import toolMetadataJson from "./tool-metadata.json";

const toolMetadata = toolMetadataJson as unknown as {
  totalTools: number;
  tools: { module: string; classification: string }[];
};

describe("buildMcpManifest", () => {
  it("points every URL at the deployment's own origin", () => {
    // A hard-coded app.carbon.ms would send self-hosted clients to the wrong server.
    const manifest = buildMcpManifest("https://erp.example.com");
    const meta = manifest._meta[MCP_META_KEY];

    expect({
      remote: manifest.remotes[0].url,
      endpoint: meta.endpoint,
      clientConfig: meta.clientConfig.mcpServers.carbon.url,
      protectedResource: meta.authentication.protectedResourceMetadata,
      authorizationServer: meta.authentication.authorizationServerMetadata
    }).toEqual({
      remote: "https://erp.example.com/api/mcp",
      endpoint: "https://erp.example.com/api/mcp",
      clientConfig: "https://erp.example.com/api/mcp",
      protectedResource:
        "https://erp.example.com/.well-known/oauth-protected-resource",
      authorizationServer:
        "https://erp.example.com/.well-known/oauth-authorization-server"
    });
  });

  const manifest = buildMcpManifest("https://app.carbon.ms");
  const meta = manifest._meta[MCP_META_KEY];

  it("marks the Authorization header required and secret", () => {
    expect(manifest.remotes[0].headers[0]).toMatchObject({
      name: "Authorization",
      isRequired: true,
      isSecret: true
    });
  });

  it("derives its counts from tool-metadata", () => {
    const sortedSet = (values: string[]) => [...new Set(values)].sort();

    expect(meta.operations).toMatchObject({
      total: toolMetadata.totalTools,
      modules: sortedSet(toolMetadata.tools.map((t) => t.module)),
      classifications: sortedSet(
        toolMetadata.tools.map((t) => t.classification)
      )
    });
  });

  it("leaves the client-config credential as an unexpanded placeholder", () => {
    // As a template literal it would publish "Bearer " with an empty credential.
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
});

describe("/.well-known/mcp.json", () => {
  it("serves the manifest as public, CORS-open JSON", async () => {
    const { loader } = await import("../../../[.]well-known.mcp[.]json");

    const response = await loader({
      request: new Request("https://app.carbon.ms/.well-known/mcp.json")
    } as Parameters<typeof loader>[0]);

    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await response.json()).remotes[0].url).toBe(
      "https://app.carbon.ms/api/mcp"
    );
  });
});
