// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { deploymentsSetRequiredEnv } from "./deployments-set-required-env";

const sources = {
  sst: {
    file: "sst.config.ts",
    contents: `const erp = cluster.addService("CarbonERPService", {
      environment: {
        DOMAIN: process.env.DOMAIN,
        ERP_URL: process.env.ERP_URL,
      },
    });
    const mes = cluster.addService("CarbonMESService", {
      environment: {
        DOMAIN: process.env.DOMAIN,
      },
    });`
  },
  devEnv: {
    file: "packages/dev/src/env.ts",
    contents: 'lines.push(`DOMAIN=localhost`);\nlines.push("ERP_URL=x");'
  },
  envExample: {
    file: ".env.example",
    contents: "SUPABASE_URL=http://localhost\n# COMMENTED=1\n"
  },
  vercel: {
    file: "packages/env/src/vercel-production.json",
    contents: JSON.stringify({ erp: ["DOMAIN", "ERP_URL"] })
  }
};

// Stands in for @carbon/env's validation: these names stop startup.
const unset = (...required: string[]) =>
  deploymentsSetRequiredEnv
    .find({
      ...sources,
      missingRequired: (env) => required.filter((name) => !env[name])
    })
    .map((v) => v.snippet);

describe("deploymentsSetRequiredEnv", () => {
  it("accepts a required variable every deployment sets", () => {
    expect(unset("DOMAIN")).toEqual([]);
  });

  it("names each deployment that lacks a required variable", () => {
    expect(unset("ERP_URL")).toEqual(["SST CarbonMESService: ERP_URL"]);
  });

  it("reads each SST service, the local env and each Vercel project", () => {
    expect(unset("ERP_URL", "SUPABASE_URL", "NODE_ENV", "COMMENTED")).toEqual([
      "SST CarbonERPService: SUPABASE_URL",
      "SST CarbonERPService: NODE_ENV",
      "SST CarbonERPService: COMMENTED",
      "SST CarbonMESService: ERP_URL",
      "SST CarbonMESService: SUPABASE_URL",
      "SST CarbonMESService: NODE_ENV",
      "SST CarbonMESService: COMMENTED",
      "local crbn up: NODE_ENV",
      "local crbn up: COMMENTED",
      "Vercel erp: SUPABASE_URL",
      "Vercel erp: COMMENTED"
    ]);
  });
});
