// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validateEnv } from "@carbon/env/validate";
import { describe, expect, it } from "vitest";
import { deploymentsSetRequiredEnv } from "./deployments-set-required-env";

// The rule itself is tested in `src/sources/deployment-env.test.ts`; this
// checks that the check asks @carbon/env which variables stop startup.
describe("deploymentsSetRequiredEnv", () => {
  it("flags each variable @carbon/env requires that a deployment does not set", () => {
    const required = validateEnv({})
      .problems.filter((p) => p.level === "error")
      .map((p) => p.name);
    expect(required.length).toBeGreaterThan(0);
    expect(
      deploymentsSetRequiredEnv
        .find({
          sources: {
            sst: { file: "sst.config.ts", contents: "" },
            devEnv: { file: "env.ts", contents: "" },
            envExample: { file: ".env.example", contents: "" },
            vercel: { file: "vercel-production.json", contents: "{}" }
          }
        })
        .map((v) => v.snippet)
    ).toEqual(required.map((name) => `local crbn up: ${name}`));
  });
});
