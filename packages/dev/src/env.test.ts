// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { describe, expect, it } from "vitest";
import { renderEnv, writeEnv } from "./env.js";
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
  PORT_EMAIL: 54008,
  PORT_POOLER: 54009
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
    prefix: null,
    mode: "isolated",
    database: "postgres",
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
    const out = base({ slug: "feat-x", prefix: portless ? "feat-x" : null });
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

  it("points shared mode at the shared containers and the worktree database", () => {
    const out = base({ mode: "shared", database: "wt_s" });
    for (const line of [
      "PORT_DB=54322",
      "PORT_POOLER=54329",
      "PORT_INBUCKET=54324",
      "SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/wt_s",
      "SUPABASE_DB_POOLER_URL=postgresql://postgres:postgres@127.0.0.1:54329/wt_s",
      "DB_HOST=carbon-postgres",
      "DB_NAME=wt_s",
      "STORAGE_HOST=carbon-storage",
      "STORAGE_TENANT=wt_s",
      "SMTP_HOST=carbon-inbucket"
    ]) {
      expect(out).toContain(line);
    }
    expect(out).toMatch(/^SLOT_NAME_SUFFIX=[0-9a-f]{8}$/m);
    expect(out).not.toContain("PORT_DB=54000");
  });

  it("keeps the slot's ports and private hosts in isolated mode", () => {
    const out = base({ mode: "isolated" });
    for (const line of [
      "PORT_DB=54000",
      "SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54000/postgres",
      "DB_HOST=local-postgres",
      "DB_NAME=postgres",
      "SLOT_NAME_SUFFIX=",
      "STORAGE_HOST=local-storage",
      "STORAGE_TENANT=stub",
      "SMTP_HOST=local-inbucket"
    ]) {
      expect(out.split("\n")).toContain(line);
    }
  });

  it("gives Envoy the public API URL for Storage's resumable-upload URLs", () => {
    const out = base();
    const url = new URL(out.match(/^SUPABASE_URL=(.*)$/m)![1]!);
    expect(out).toContain(`STORAGE_PUBLIC_HOST=${url.host}`);
    expect(out).toContain(`STORAGE_PUBLIC_PROTO=${url.protocol.slice(0, -1)}`);
    expect(out).toMatch(/^STORAGE_PUBLIC_PORT=\d+$/m);
  });

  it("points the apps' pool at the pooler, and skips it for a slot without one", () => {
    expect(base()).toContain(
      "SUPABASE_DB_POOLER_URL=postgresql://postgres:postgres@127.0.0.1:54009/postgres"
    );
    const { PORT_POOLER: _, ...older } = ports;
    expect(base({ ports: older as PortMap }).split("\n")).toContain(
      "SUPABASE_DB_POOLER_URL="
    );
  });
});

describe("#force escape hatch", () => {
  const write = (dotEnv: string, content: string) => {
    const dir = mkdtempSync(join(tmpdir(), "crbn-env-"));
    try {
      writeFileSync(join(dir, ".env"), dotEnv);
      writeEnv(dir, content);
      return readFileSync(join(dir, ".env.local"), "utf8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("leaves out of .env.local the keys .env pins with a trailing #force", () => {
    const dotEnv = [
      "ASSEMBLER_SERVICE_URL=https://xxx.execute-api.us-east-1.amazonaws.com #force",
      "ASSEMBLER_SERVICE_API_KEY=abc  # FORCE",
      'ONSHAPE_V2_OAUTH_REDIRECT_URL="https://tunnel.example/oauth" #force',
      "# a comment mentioning force",
      "NOT_FORCED=1 # forceful suffix means nothing"
    ].join("\n");
    const out = write(
      dotEnv,
      [
        "ASSEMBLER_SERVICE_URL=https://assembler.s.dev",
        "ASSEMBLER_SERVICE_API_KEY=dev-local-key",
        "ONSHAPE_V2_OAUTH_REDIRECT_URL=https://erp.s.dev/oauth",
        "NOT_FORCED=2"
      ].join("\n")
    );
    expect(out.split("\n")).toEqual([
      "# ASSEMBLER_SERVICE_URL omitted — #force'd in .env",
      "# ASSEMBLER_SERVICE_API_KEY omitted — #force'd in .env",
      "# ONSHAPE_V2_OAUTH_REDIRECT_URL omitted — #force'd in .env",
      "NOT_FORCED=2"
    ]);
  });

  it("writes the content as it is when nothing is forced", () => {
    expect(write("A=1\nB=2", "A=3\nB=4")).toBe("A=3\nB=4");
  });
});
