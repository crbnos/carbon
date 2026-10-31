// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentSetupPrompt } from "../app/routes/api+/mcp+/lib/agent-setup-prompt";

// ollmcp is the MCP client. AI_BASE_URL only points document extraction at an
// OpenAI-compatible server (packages/jobs extraction) and is not this connector.
// The public page must keep the endpoint as the rewritable ENDPOINT literal.

const ROOT = resolve(__dirname, "../../..");
const PAGE = join(ROOT, "docs/app/api/mcp/page.tsx");

describe("Ollama MCP client", () => {
  it("points the agent at ollmcp on this origin", () => {
    const cloud = buildAgentSetupPrompt("https://app.carbon.ms");
    const privateOrigin = buildAgentSetupPrompt("https://erp.internal.example");
    const section = cloud.slice(
      cloud.indexOf("### Ollama"),
      cloud.indexOf("### Any other MCP client")
    );

    expect(section).toContain("It is not an MCP client");
    expect(section).toContain("ollmcp mcp add --transport http carbon");
    expect(section).toContain("https://app.carbon.ms/api/mcp");
    expect(section).toContain("https://app.carbon.ms");
    expect(section).toContain("call_tool");
    expect(section).toContain("call_destructive_tool");
    expect(section).toContain("companyId");
    expect(section).toContain("userId");
    expect(section).toContain("ITAR");
    expect(section).toContain("so the key stays out of the repository");
    expect(section).toContain("same directory");
    expect(section).toContain("--scope user");
    expect(section).toContain("when human-in-the-loop is enabled");
    expect(section).toContain("session-wide yes");
    expect(section).toContain("Ollama Cloud model");
    expect(section).toContain("AI_BASE_URL");
    expect(section).toContain("document extraction");
    expect(section).toContain("They do not connect an agent to this MCP server.");
    expect(section).not.toContain("{{MCP_URL}}");
    expect(section).not.toContain("{{ORIGIN}}");
    expect(section).not.toContain("crbn_");

    expect(privateOrigin).toContain("https://erp.internal.example/api/mcp");
    expect(privateOrigin).toContain(
      "already be able to open `https://erp.internal.example`"
    );
    expect(privateOrigin).not.toContain("https://app.carbon.ms");
  });

  it("documents ollmcp with the rewritable endpoint", () => {
    const page = readFileSync(PAGE, "utf8");
    const sample = page.slice(
      page.indexOf("const OLLAMA"),
      page.indexOf("const PROMPTS")
    );

    expect(sample).toContain("ollmcp mcp add --transport http carbon");
    expect(sample).toContain("${ENDPOINT}");
    expect(sample).not.toContain("https://");
    expect(sample).not.toContain("crbn_");
    expect(page).toContain("It does not speak MCP.");
    expect(page).toContain("A cloud model sends those results");
    expect(page).toContain("A cloud model sends them to that provider.");
    expect(page).toContain("so the key stays out of the repository");
    expect(page).toContain("same directory");
    expect(page).toContain("user scope");
    expect(page).toContain("document extraction only");
    expect(page).toContain("Do not publish a private or controlled (ITAR) origin");
  });
});
