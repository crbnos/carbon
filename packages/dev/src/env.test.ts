// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { forcedKeys, omitForcedKeys, renderEnv } from "./env.js";
import type { JwtCreds, PortMap } from "./worktree.js";

const ports: PortMap = {
  PORT_DB: 54000,
  PORT_API: 54001,
  PORT_STUDIO: 54002,
  PORT_INBUCKET: 54003,
  PORT_INNGEST: 54004,
  PORT_ERP: 54005,
  PORT_MES: 54006,
  PORT_ASSEMBLER: 54007,
  PORT_EMAIL: 54008
};

const jwt: JwtCreds = {
  secret: "test-secret",
  anonKey: "test-anon-key",
  serviceKey: "test-service-key"
};

const base = (overrides: Partial<Parameters<typeof renderEnv>[0]> = {}) =>
  renderEnv({
    slug: "s",
    ports,
    redisDb: 0,
    jwt,
    portless: false,
    ...overrides
  });

describe("renderEnv", () => {
  it.each([
    {
      portless: false,
      expected: [
        "ERP_URL=http://localhost:54005",
        "MES_URL=http://localhost:54006",
        "SUPABASE_URL=http://localhost:54001",
        "ONSHAPE_V2_OAUTH_REDIRECT_URL=http://localhost:54005/api/integrations/onshape-v2/oauth"
      ]
    },
    {
      portless: true,
      expected: [
        "ERP_URL=https://erp.feat-x.dev",
        "MES_URL=https://mes.feat-x.dev",
        "SUPABASE_URL=https://api.feat-x.dev",
        "ONSHAPE_V2_OAUTH_REDIRECT_URL=https://erp.feat-x.dev/api/integrations/onshape-v2/oauth",
        "PORTLESS_TLD=dev"
      ]
    }
  ])("writes the app URLs for portless=$portless", ({ portless, expected }) => {
    const out = base({ slug: "feat-x", portless, branchPrefix: "feat-x" });
    expect(out).toContain("CARBON_WORKTREE=feat-x");
    for (const line of expected) expect(out).toContain(line);
    if (!portless) expect(out).not.toContain("PORTLESS_TLD");
  });

  it("writes the assembler URL by default, omits it when deselected", () => {
    expect(base()).toContain("ASSEMBLER_SERVICE_URL=http://localhost:54007");
    expect(base()).toContain("ASSEMBLER_SERVICE_API_KEY=dev-local-key");
    // ASSEMBLER_SERVICE_URL is the pipeline's feature flag: with the app
    // deselected, jobs must skip cleanly instead of calling a dead endpoint.
    const without = base({ includeAssembler: false });
    expect(without).not.toContain("ASSEMBLER_SERVICE_URL=");
    expect(without).not.toContain("ASSEMBLER_SERVICE_API_KEY=");
  });

  it("wires ports, the redis db, and the jwt creds in verbatim, ending with a newline", () => {
    const out = base({ redisDb: 7 });
    for (const line of [
      "PORT_DB=54000",
      "PORT_API=54001",
      "PORT_STUDIO=54002",
      "PORT_INBUCKET=54003",
      "PORT_INNGEST=54004",
      "PORT_ERP=54005",
      "PORT_MES=54006",
      "PORT_EMAIL=54008",
      "EMAIL_DEV_PORT=54008",
      "SUPABASE_JWT_SECRET=test-secret",
      "SUPABASE_ANON_KEY=test-anon-key",
      "SUPABASE_SERVICE_ROLE_KEY=test-service-key"
    ]) {
      expect(out).toContain(line);
    }
    expect(out).toMatch(/REDIS_URL=redis:\/\/localhost:\d+\/7/);
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("#force escape hatch", () => {
  it("collects keys marked with a trailing #force comment", () => {
    const dotEnv = [
      "OPENAI_API_KEY=sk-123",
      "ASSEMBLER_SERVICE_URL=https://xxx.execute-api.us-east-1.amazonaws.com #force",
      "ASSEMBLER_SERVICE_API_KEY=abc  # FORCE",
      'ONSHAPE_V2_OAUTH_REDIRECT_URL="https://tunnel.example/oauth" #force',
      "# a comment mentioning force",
      "NOT_FORCED=1 # forceful suffix means nothing"
    ].join("\n");
    expect(forcedKeys(dotEnv)).toEqual(
      new Set([
        "ASSEMBLER_SERVICE_URL",
        "ASSEMBLER_SERVICE_API_KEY",
        "ONSHAPE_V2_OAUTH_REDIRECT_URL"
      ])
    );
  });

  it("omits forced keys from the generated .env.local content", () => {
    const dotEnv = "ASSEMBLER_SERVICE_URL=https://remote #force\n";
    const content = [
      "ASSEMBLER_SERVICE_URL=https://assembler.s.dev",
      "ASSEMBLER_SERVICE_API_KEY=dev-local-key"
    ].join("\n");
    const out = omitForcedKeys(content, dotEnv);
    expect(out).not.toContain("ASSEMBLER_SERVICE_URL=");
    expect(out).toContain("ASSEMBLER_SERVICE_API_KEY=dev-local-key");
  });

  it("leaves the content untouched when nothing is forced", () => {
    const content = "A=1\nB=2";
    expect(omitForcedKeys(content, "A=1\nB=2")).toBe(content);
  });
});
