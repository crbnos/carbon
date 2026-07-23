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
  PORT_ASSEMBLER: 54007
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
