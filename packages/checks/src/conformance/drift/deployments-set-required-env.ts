// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validateEnv } from "@carbon/env/validate";
import { defineCheck } from "../../check";
import { read } from "../../sources/read-source";

// A variable that stops startup when missing must already be set by every
// deployment, or adding it takes production down.
export const deploymentsSetRequiredEnv = defineCheck({
  id: "deployments-set-required-env",
  description:
    "A variable that stops startup when missing must already be set by every deployment, or adding it takes production down.",
  reads: {
    sst: (root) => read(root, "sst.config.ts"),
    devEnv: (root) => read(root, "packages/dev/src/env.ts"),
    envExample: (root) => read(root, ".env.example"),
    // Names only, from `vercel env ls production` plus the team's shared
    // variables. Add a name there when someone adds it in Vercel.
    vercel: (root) => read(root, "packages/env/src/vercel-production.json"),
    missingRequired: () => (env: Record<string, string>) =>
      validateEnv(env)
        .problems.filter((p) => p.level === "error")
        .map((p) => p.name)
  },
  rule() {
    return ({ sst, devEnv, envExample, vercel, missingRequired }) => {
      const services = [...sst.contents.matchAll(/environment: \{/g)].map(
        (env, i) => {
          const start = (env.index ?? 0) + env[0].length;
          const owner = [
            ...sst.contents
              .slice(0, start)
              .matchAll(/addService\(\s*"([^"]+)"/g)
          ].at(-1)?.[1];
          const block = sst.contents.slice(start).split("\n      },")[0] ?? "";
          return {
            name: `SST ${owner ?? `service ${i + 1}`}`,
            file: sst.file,
            keys: [...block.matchAll(/^\s+([A-Z0-9_]+):/gm)].map(
              (m) => m[1] ?? ""
            )
          };
        }
      );
      const local = {
        name: "local crbn up",
        file: devEnv.file,
        keys: [
          ...devEnv.contents.matchAll(/[`"]([A-Z0-9_]+)=/g),
          ...envExample.contents.matchAll(/^([A-Z0-9_]+)=/gm)
        ].map((m) => m[1] ?? "")
      };
      const keysByProject: Record<string, string[]> = JSON.parse(
        vercel.contents
      );
      const projects = Object.entries(keysByProject).map(([project, keys]) => ({
        name: `Vercel ${project}`,
        file: vercel.file,
        // Vercel itself adds NODE_ENV at runtime.
        keys: [...keys, "NODE_ENV"]
      }));

      return [...services, local, ...projects].flatMap(({ name, file, keys }) =>
        missingRequired(
          Object.fromEntries(keys.map((key) => [key, "set"]))
        ).map((variable) => ({
          file,
          line: 0,
          snippet: `${name}: ${variable}`,
          message: `${variable} is required at startup but ${name} does not set it; set it there first, or make it optional`
        }))
      );
    };
  }
});
