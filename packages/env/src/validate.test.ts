// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { formatReport, validateEnv } from "./validate";

const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SESSION_SECRET: "session",
  REDIS_URL: "redis://localhost:6379",
  INNGEST_DEV: "1"
};

describe("validateEnv", () => {
  it("passes a complete environment", () => {
    expect(validateEnv(base)).toMatchObject({ problems: [], fatal: false });
  });

  it("reports every missing variable together", () => {
    const report = validateEnv({ ...base, SESSION_SECRET: "", REDIS_URL: "" });
    expect(report.fatal).toBe(true);
    const text = formatReport(report);
    expect(text).toContain("Carbon can't start: 2 problems");
    expect(text).toContain("✗ SESSION_SECRET");
    expect(text).toContain("missing: signs the session cookie");
    expect(text).toContain("✗ REDIS_URL");
  });

  it("names an invalid type", () => {
    const text = formatReport(validateEnv({ ...base, REDIS_URL: "localhost" }));
    expect(text).toMatch(/REDIS_URL\s+Invalid URL/);
  });

  it("flags a half-configured feature", () => {
    const report = validateEnv({ ...base, STRIPE_SECRET_KEY: "sk_live_abc" });
    expect(formatReport(report)).toMatch(
      /Stripe \(half-configured\)\n\s+! STRIPE_WEBHOOK_SECRET\s+missing, but STRIPE_SECRET_KEY is set/
    );
    expect(report.off).not.toContain("Stripe");
  });

  it("lists only fully unset features as off", () => {
    const { off } = validateEnv({ ...base, SMTP_HOST: "localhost" });
    expect(off).toContain("Slack");
    expect(off).not.toContain("Email");
  });

  it("never prints a secret's value", () => {
    const text = formatReport(
      validateEnv({
        ...base,
        REDIS_URL: "hunter2",
        STRIPE_SECRET_KEY: "sk_live_abc"
      })
    );
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("sk_live_abc");
  });

  it("reads a deprecated alias", () => {
    const report = validateEnv({
      ...base,
      DATABASE_URL: "",
      SUPABASE_DB_URL: base.DATABASE_URL
    });
    expect(report.problems).toEqual([]);
  });

  it("only warns about what did not stop startup before", () => {
    const report = validateEnv({
      ...base,
      SUPABASE_URL: "",
      NODE_ENV: "production"
    });
    expect(report.fatal).toBe(false);
    expect(report.problems.map((p) => p.name)).toEqual([
      "ERP_URL",
      "MES_URL",
      "SUPABASE_URL",
      "SMTP_FROM"
    ]);
  });
});
