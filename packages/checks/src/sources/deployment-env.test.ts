// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_ENV_FILES,
  type DeploymentEnvSources,
  deploymentEnvKeys,
  findDeploymentEnvGaps
} from "./deployment-env";

const base = (
  overrides: Partial<Record<keyof DeploymentEnvSources, string>> = {}
): DeploymentEnvSources => {
  const contents = {
    sst: `const erp = cluster.addService("CarbonERPService", {
      environment: {
        DOMAIN: process.env.DOMAIN,
        ERP_URL: process.env.ERP_URL,
      },
    });
    const mes = cluster.addService("CarbonMESService", {
      environment: {
        DOMAIN: process.env.DOMAIN,
      },
    });`,
    devEnv: 'lines.push(`DOMAIN=localhost`);\nlines.push("ERP_URL=x");',
    envExample: "SUPABASE_URL=http://localhost\n# COMMENTED=1\n",
    vercel: JSON.stringify({ erp: ["DOMAIN", "ERP_URL"] }),
    ...overrides
  };
  return {
    sst: { file: DEPLOYMENT_ENV_FILES.sst, contents: contents.sst },
    devEnv: { file: DEPLOYMENT_ENV_FILES.devEnv, contents: contents.devEnv },
    envExample: {
      file: DEPLOYMENT_ENV_FILES.envExample,
      contents: contents.envExample
    },
    vercel: { file: DEPLOYMENT_ENV_FILES.vercel, contents: contents.vercel }
  };
};

// Stands in for @carbon/env's validation: these two stop startup.
const requires =
  (...names: string[]) =>
  (env: Record<string, string>) =>
    names.filter((name) => !env[name]);

describe("deploymentEnvKeys", () => {
  it("reads each SST service, the local env and each Vercel project", () => {
    expect(
      deploymentEnvKeys(base()).map(({ name, keys }) => [name, keys])
    ).toEqual([
      ["SST CarbonERPService", ["DOMAIN", "ERP_URL"]],
      ["SST CarbonMESService", ["DOMAIN"]],
      ["local crbn up", ["DOMAIN", "ERP_URL", "SUPABASE_URL"]],
      ["Vercel erp", ["DOMAIN", "ERP_URL", "NODE_ENV"]]
    ]);
  });
});

describe("findDeploymentEnvGaps", () => {
  it("accepts a required variable every deployment sets", () => {
    expect(findDeploymentEnvGaps(base(), requires("DOMAIN"))).toEqual([]);
  });

  it("names each deployment that lacks a required variable", () => {
    expect(
      findDeploymentEnvGaps(base(), requires("ERP_URL")).map((v) => v.snippet)
    ).toEqual(["SST CarbonMESService: ERP_URL"]);
  });
});
