import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forcedKeys, omitForcedKeys, readEnvPorts, renderEnv } from "./env.js";
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

describe("renderEnv (portless disabled)", () => {
  it("emits localhost URLs for app and supabase", () => {
    const out = renderEnv({
      slug: "feat-x",
      ports,
      redisDb: 3,
      jwt,
      portless: false
    });
    expect(out).toContain("CARBON_WORKTREE=feat-x");
    expect(out).toContain("ERP_URL=http://localhost:54005");
    expect(out).toContain("MES_URL=http://localhost:54006");
    expect(out).toContain("SUPABASE_URL=http://localhost:54001");
    expect(out).not.toContain("PORTLESS_TLD");
  });

  it("writes the assembler URL by default, omits it when deselected", () => {
    const base = { slug: "s", ports, redisDb: 0, jwt, portless: false };
    const withAssembler = renderEnv(base);
    expect(withAssembler).toContain(
      "ASSEMBLER_SERVICE_URL=http://localhost:54007"
    );
    expect(withAssembler).toContain("ASSEMBLER_SERVICE_API_KEY=dev-local-key");
    // ASSEMBLER_SERVICE_URL is the pipeline's feature flag — when the app
    // wasn't selected, the URL must be absent so jobs skip cleanly instead of
    // failing against a dead endpoint.
    const without = renderEnv({ ...base, includeAssembler: false });
    expect(without).not.toContain("ASSEMBLER_SERVICE_URL=");
    expect(without).not.toContain("ASSEMBLER_SERVICE_API_KEY=");
  });

  it("wires every port into env vars", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 0,
      jwt,
      portless: false
    });
    expect(out).toContain("PORT_DB=54000");
    expect(out).toContain("PORT_API=54001");
    expect(out).toContain("PORT_STUDIO=54002");
    expect(out).toContain("PORT_INBUCKET=54003");
    expect(out).toContain("PORT_INNGEST=54004");
    expect(out).toContain("PORT_ERP=54005");
    expect(out).toContain("PORT_MES=54006");
    expect(out).toContain("PORT_EMAIL=54008");
    expect(out).toContain("EMAIL_DEV_PORT=54008");
  });

  it("places redis db index in REDIS_URL", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 7,
      jwt,
      portless: false
    });
    expect(out).toMatch(/REDIS_URL=redis:\/\/localhost:\d+\/7/);
  });

  it("injects jwt creds verbatim", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 0,
      jwt,
      portless: false
    });
    expect(out).toContain("SUPABASE_JWT_SECRET=test-secret");
    expect(out).toContain("SUPABASE_ANON_KEY=test-anon-key");
    expect(out).toContain("SUPABASE_SERVICE_ROLE_KEY=test-service-key");
  });

  it("ends with a trailing newline", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 0,
      jwt,
      portless: false
    });
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("renderEnv (portless enabled)", () => {
  it("emits portless hostnames for app and supabase", () => {
    const out = renderEnv({
      slug: "feat-x",
      ports,
      redisDb: 3,
      jwt,
      portless: true,
      branchPrefix: "feat-x"
    });
    expect(out).toContain("CARBON_WORKTREE=feat-x");
    expect(out).toContain("ERP_URL=https://erp.feat-x.dev");
    expect(out).toContain("MES_URL=https://mes.feat-x.dev");
    expect(out).toContain("SUPABASE_URL=https://api.feat-x.dev");
    expect(out).toContain("PORTLESS_TLD=dev");
  });

  it("wires every port into env vars", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 0,
      jwt,
      portless: true,
      branchPrefix: "s"
    });
    expect(out).toContain("PORT_DB=54000");
    expect(out).toContain("PORT_API=54001");
    expect(out).toContain("PORT_STUDIO=54002");
    expect(out).toContain("PORT_INBUCKET=54003");
    expect(out).toContain("PORT_INNGEST=54004");
    expect(out).toContain("PORT_ERP=54005");
    expect(out).toContain("PORT_MES=54006");
    expect(out).toContain("PORT_EMAIL=54008");
    expect(out).toContain("EMAIL_DEV_PORT=54008");
  });

  it("places redis db index in REDIS_URL", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 7,
      jwt,
      portless: true,
      branchPrefix: "s"
    });
    expect(out).toMatch(/REDIS_URL=redis:\/\/localhost:\d+\/7/);
  });

  it("injects jwt creds verbatim", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 0,
      jwt,
      portless: true,
      branchPrefix: "s"
    });
    expect(out).toContain("SUPABASE_JWT_SECRET=test-secret");
    expect(out).toContain("SUPABASE_ANON_KEY=test-anon-key");
    expect(out).toContain("SUPABASE_SERVICE_ROLE_KEY=test-service-key");
  });

  it("ends with a trailing newline", () => {
    const out = renderEnv({
      slug: "s",
      ports,
      redisDb: 0,
      jwt,
      portless: true,
      branchPrefix: "s"
    });
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("#force escape hatch", () => {
  it("collects keys marked with a trailing #force comment", () => {
    const dotEnv = [
      "OPENAI_API_KEY=sk-123",
      "ASSEMBLER_SERVICE_URL=https://xxx.execute-api.us-east-1.amazonaws.com #force",
      "ASSEMBLER_SERVICE_API_KEY=abc  # FORCE",
      "# a comment mentioning force",
      "NOT_FORCED=1 # forceful suffix means nothing"
    ].join("\n");
    expect(forcedKeys(dotEnv)).toEqual(
      new Set(["ASSEMBLER_SERVICE_URL", "ASSEMBLER_SERVICE_API_KEY"])
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
    expect(out).toContain("omitted");
  });

  it("no markers -> content untouched", () => {
    const content = "A=1\nB=2";
    expect(omitForcedKeys(content, "A=1\nB=2")).toBe(content);
  });
});

describe("readEnvPorts", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "crbn-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the worktree has never booted", () => {
    expect(readEnvPorts(dir)).toBeNull();
  });

  it("reads the ports the stack was actually booted with", () => {
    // The localhost-mode case that made `status` lie: `up` pins these three
    // after the registry persisted its allocation, and never writes them back.
    writeFileSync(
      join(dir, ".env.local"),
      renderEnv({
        slug: "carbon-test",
        ports: { ...ports, PORT_API: 54321, PORT_ERP: 3000, PORT_MES: 3001 },
        redisDb: 3,
        jwt,
        portless: false
      })
    );
    const read = readEnvPorts(dir);
    expect(read?.PORT_API).toBe(54321);
    expect(read?.PORT_ERP).toBe(3000);
    expect(read?.PORT_MES).toBe(3001);
    // Untouched ports still come through, so the caller can merge over the slot.
    expect(read?.PORT_DB).toBe(ports.PORT_DB);
  });

  it("ignores non-port keys, unknown PORT_ names and malformed values", () => {
    writeFileSync(
      join(dir, ".env.local"),
      [
        "SUPABASE_URL=http://localhost:54321",
        "PORT_DB=54000",
        "PORT_NOTAPORT=1234",
        "PORT_API=not-a-number",
        "EMAIL_DEV_PORT=6001"
      ].join("\n")
    );
    expect(readEnvPorts(dir)).toEqual({ PORT_DB: 54000 });
  });

  it("returns an empty map for a file with no port lines", () => {
    // Distinct from null: the file exists, so the worktree HAS booted.
    writeFileSync(join(dir, ".env.local"), "CARBON_WORKTREE=carbon-test\n");
    expect(readEnvPorts(dir)).toEqual({});
  });
});
