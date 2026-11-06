// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentSetupPrompt } from "../app/routes/api+/mcp+/lib/agent-setup-prompt";

// The marketplace package is the feature: one OAuth plugin for Cursor and
// Grok Bot on US Carbon Cloud, and a different local-file path for every
// other origin. These assertions fail if that package starts embedding a
// key, retargeting the cloud server, or telling a private origin to install it.

const ROOT = resolve(__dirname, "../../..");
const PLUGIN = join(ROOT, "plugins/carbon");
const CLOUD_ORIGIN = "https://app.carbon.ms";
const CLOUD_MCP = `${CLOUD_ORIGIN}/api/mcp`;
const PRIVATE_ORIGIN = "https://erp.internal.example";

/** Read a repository file as UTF-8 text. */
const read = (path: string) => readFileSync(path, "utf8");

/** Parse a repository JSON file. */
const readJson = (path: string) => JSON.parse(read(path)) as unknown;

/** Assert the rule and skill require the operator loop and the status split. */
function expectOperatorLoop(text: string) {
  expect(text).toContain("search_tools");
  expect(text).toContain("describe_tool");
  expect(text).toContain("call_tool");
  expect(text).toContain("call_destructive_tool");
  expect(text).toContain("companyId");
  expect(text).toContain("userId");
  expect(text).toContain("WRITE");
  expect(text).toContain("DESTRUCTIVE");
  expect(text).toContain("401");
  expect(text).toContain("402");
  expect(text).toContain("403");
  expect(text).toContain("429");
  expect(text).toContain("Retry-After");
  expect(text).toContain("private network");
  expect(text).toContain("ITAR");
}

describe("Carbon marketplace plugin", () => {
  it("indexes plugins/carbon and does not set pluginRoot", () => {
    const index = readJson(join(ROOT, ".cursor-plugin/marketplace.json")) as {
      name: string;
      owner: { name: string; email: string };
      metadata: { description: string; version: string; pluginRoot?: string };
      plugins: { name: string; source: string; description: string }[];
    };

    expect(index.name).toBe("carbon");
    expect(index.owner).toEqual({
      name: "Carbon",
      email: "support@carbon.ms"
    });
    expect(index.metadata.pluginRoot).toBeUndefined();
    expect(index.plugins).toEqual([
      {
        name: "carbon",
        source: "./plugins/carbon",
        description:
          "Operate Carbon ERP over MCP. OAuth into Carbon Cloud, then search, describe, and call."
      }
    ]);
  });

  it("publishes an OAuth-only Carbon Cloud server", () => {
    const manifest = readJson(join(PLUGIN, ".cursor-plugin/plugin.json")) as {
      name: string;
      displayName: string;
      version: string;
      author: { name: string; email: string };
      license: string;
      homepage: string;
      repository: string;
      logo: string;
      category: string;
      minClientVersions?: unknown;
      variables?: unknown;
    };
    const mcp = readJson(join(PLUGIN, "mcp.json")) as {
      mcpServers: Record<
        string,
        { url?: string; headers?: unknown; command?: unknown; env?: unknown }
      >;
    };
    const server = mcp.mcpServers.carbon;

    expect(manifest).toMatchObject({
      name: "carbon",
      displayName: "Carbon",
      version: "1.0.0",
      author: { name: "Carbon", email: "support@carbon.ms" },
      license: "AGPL-3.0",
      homepage: "https://docs.carbon.ms/api/mcp",
      repository: "https://github.com/crbnos/carbon",
      logo: "assets/logo.svg",
      category: "integrations"
    });
    expect(manifest.minClientVersions).toBeUndefined();
    expect(manifest.variables).toBeUndefined();
    expect(existsSync(join(PLUGIN, manifest.logo))).toBe(true);
    expect(read(join(PLUGIN, manifest.logo))).toContain("<svg");

    expect(Object.keys(mcp.mcpServers)).toEqual(["carbon"]);
    expect(server).toEqual({ url: CLOUD_MCP });
    expect(server?.headers).toBeUndefined();
    expect(server?.command).toBeUndefined();
    expect(server?.env).toBeUndefined();
    expect(JSON.stringify(mcp)).not.toContain("crbn_");
    expect(JSON.stringify(mcp)).not.toContain("CARBON_API_KEY");
    expect(JSON.stringify(mcp)).not.toContain("Authorization");
  });

  it("tells Cursor and Grok Bot to confirm writes and stay on Carbon Cloud", () => {
    const rule = read(join(PLUGIN, "rules/carbon-erp.mdc"));
    const skill = read(join(PLUGIN, "skills/carbon-erp/SKILL.md"));

    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("Do not send `companyId` or `userId`.");
    expect(rule).toContain("Ask before any `WRITE` or `DESTRUCTIVE` call.");
    expect(rule).toContain(
      "Do not point it at a private network, a self-hosted host, or an ITAR environment."
    );
    expectOperatorLoop(rule);

    expect(skill).toContain("name: carbon-erp");
    expect(skill).toContain(
      "`companyId` and `userId` come from the sign-in. Do not send them as arguments."
    );
    expect(skill).toContain(
      "Wait for an explicit yes before `call_tool` on a `WRITE` operation, and before `call_destructive_tool` on a `DESTRUCTIVE` operation."
    );
    expect(skill).toContain("Do not retarget this server");
    expect(skill).toContain(CLOUD_MCP);
    expect(skill).toContain("API key lacks the required scope");
    expect(skill).toContain("This plugin uses OAuth, so the plan gate is HTTP 402");
    expectOperatorLoop(skill);
  });

  it("sends Carbon Cloud to the marketplace plugin and every other origin to a local Cursor file", () => {
    const cloud = buildAgentSetupPrompt(CLOUD_ORIGIN);
    const local = buildAgentSetupPrompt(PRIVATE_ORIGIN);

    for (const prompt of [cloud, local]) {
      expect(prompt).not.toContain("{{MCP_URL}}");
      expect(prompt).not.toContain("{{ORIGIN}}");
      expect(prompt).toContain("plugins/carbon");
      expect(prompt).toContain(CLOUD_MCP);
      expect(prompt).toContain("There is no API key in the plugin");
    }

    expect(cloud).toContain(
      "Only when `https://app.carbon.ms` is `https://app.carbon.ms`"
    );
    expect(cloud).toContain(
      "Do not write `~/.cursor/mcp.json` for this origin"
    );
    expect(cloud).toContain(
      "Use this only when `https://app.carbon.ms` is not `https://app.carbon.ms`"
    );
    expect(cloud).toContain("a new key allows 20 requests per minute");
    expect(cloud).not.toContain(
      "60 requests per minute by default, counted on the key"
    );
    expect(cloud).toContain("If a request comes back `401`");
    expect(cloud).toContain(
      "An OAuth request from a Starter company returns `402` from the MCP entitlement gate"
    );
    expect(cloud).toContain(
      "An API-key request from a Starter company returns `403` during"
    );
    expect(cloud).toContain("API key lacks the required scope");
    expect(cloud).not.toContain("Starter returns `403`");

    expect(local).toContain(
      "Only when `https://erp.internal.example` is `https://app.carbon.ms`"
    );
    expect(local).toContain(
      "When `https://erp.internal.example` is anything else"
    );
    expect(local).toContain("do **not** install this plugin");
    expect(local).toContain("Write the **user** file `~/.cursor/mcp.json`");
    expect(local).toContain('"url": "https://erp.internal.example/api/mcp"');
    expect(local).toContain(
      "Use this only when `https://erp.internal.example` is not `https://app.carbon.ms`"
    );
  });

  it("documents one listing that does not reach a private, EU, self-hosted, or ITAR origin", () => {
    const page = read(join(ROOT, "docs/app/api/mcp/page.tsx"));

    expect(page).toContain(
      "Both install the Carbon plugin from the Cursor Marketplace. Cursor: Customize → Marketplace. Grok Bot: Settings → Plugins. One submission at cursor.com/marketplace/publish lists it for both. The plugin talks to Carbon Cloud at https://app.carbon.ms/api/mcp and signs in with OAuth. It does not reach a private, self-hosted, EU Cloud, or ITAR origin. The package in this repository is plugins/carbon."
    );
    expect(page).toContain("Leave a private origin unpublished.");
    expect(page).toContain("plugins/carbon");
    expect(page).toContain("New API keys allow 20 requests a minute");
    expect(page).not.toContain(
      "Each key, and each OAuth user, is limited to 60 requests a minute"
    );
    expect(page).toContain("returns <Code>402</Code>");
    expect(page).toContain(
      "rejected with <Code>403</Code> during authentication."
    );
    expect(page).not.toContain("Starter returns <Code>403</Code>.");
  });
});
