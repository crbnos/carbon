// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateEnv } from "./validate";
import vercel from "./vercel-production.json";

// What each real deployment sets today, read from the file that sets it. A
// variable that starts stopping startup must already be set by all of them.
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const set = (keys: Iterable<string>) =>
  Object.fromEntries([...keys].map((key) => [key, "set"]));
const errors = (env: Record<string, string>) =>
  validateEnv(env)
    .problems.filter((p) => p.level === "error")
    .map((p) => p.name);

describe("deployments keep starting", () => {
  const services = read("sst.config.ts").split("environment: {").slice(1);

  it.each(
    ["erp", "mes"].map((name, i) => [name, services[i]])
  )("SST %s service", (_, block = "") => {
    const keys = [
      ...(block.split("\n      },")[0] ?? "").matchAll(/^\s+([A-Z0-9_]+):/gm)
    ];
    expect(keys.length).toBeGreaterThan(20);
    expect(errors(set(keys.map((m) => m[1] as string)))).toEqual([]);
  });

  it("local crbn up", () => {
    const written = read("packages/dev/src/env.ts").matchAll(
      /[`"]([A-Z0-9_]+)=/g
    );
    const example = read(".env.example").matchAll(/^([A-Z0-9_]+)=/gm);
    const keys = [...written, ...example].map((m) => m[1] as string);
    expect(keys).toContain("SUPABASE_DB_URL");
    expect(errors(set(keys))).toEqual([]);
  });

  // Names only, from `vercel env ls production` plus the team's shared
  // variables, on 2026-10-07. Vercel itself adds NODE_ENV at runtime.
  it.each(Object.entries(vercel))("Vercel %s project", (_, keys) => {
    expect(errors(set([...keys, "NODE_ENV"]))).toEqual([]);
  });

  it.todo("BYOC Helm chart: the chart is not in this repository");
});
