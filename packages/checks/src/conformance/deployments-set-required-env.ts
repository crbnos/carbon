// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

export const DEPLOYMENTS_SET_REQUIRED_ENV = "deployments-set-required-env";

export const DEPLOYMENT_ENV_FILES = {
  sst: "sst.config.ts",
  devEnv: "packages/dev/src/env.ts",
  envExample: ".env.example",
  // Names only, from `vercel env ls production` plus the team's shared
  // variables. Add a name here when someone adds it in Vercel.
  vercel: "packages/env/src/vercel-production.json"
} as const;

export type DeploymentEnvSources = Record<
  keyof typeof DEPLOYMENT_ENV_FILES,
  SourceFile
>;

type Deployment = { name: string; file: string; keys: string[] };

/** The variable names each real deployment sets, read from the file that sets them. */
export function deploymentEnvKeys(sources: DeploymentEnvSources): Deployment[] {
  const { sst, devEnv, envExample, vercel } = sources;
  const services = [...sst.contents.matchAll(/environment: \{/g)].map(
    (env, i) => {
      const start = (env.index ?? 0) + env[0].length;
      const owner = [
        ...sst.contents.slice(0, start).matchAll(/addService\(\s*"([^"]+)"/g)
      ].at(-1)?.[1];
      const block = sst.contents.slice(start).split("\n      },")[0] ?? "";
      return {
        name: `SST ${owner ?? `service ${i + 1}`}`,
        file: sst.file,
        keys: [...block.matchAll(/^\s+([A-Z0-9_]+):/gm)].map(
          (m) => m[1] as string
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
    ].map((m) => m[1] as string)
  };
  const projects = Object.entries(
    JSON.parse(vercel.contents) as Record<string, string[]>
  ).map(([project, keys]) => ({
    name: `Vercel ${project}`,
    file: vercel.file,
    // Vercel itself adds NODE_ENV at runtime.
    keys: [...keys, "NODE_ENV"]
  }));
  return [...services, local, ...projects];
}

/**
 * A variable that stops startup when missing must already be set by every
 * deployment, or adding it takes production down. `missingRequired` is
 * `@carbon/env`'s validation: the names it reports as errors for an env.
 */
export function findDeploymentEnvGaps(
  sources: DeploymentEnvSources,
  missingRequired: (env: Record<string, string>) => string[]
): Violation[] {
  return deploymentEnvKeys(sources).flatMap(({ name, file, keys }) =>
    missingRequired(Object.fromEntries(keys.map((key) => [key, "set"]))).map(
      (variable) => ({
        file,
        line: 0,
        snippet: `${name}: ${variable}`,
        message: `${variable} is required at startup but ${name} does not set it; set it there first, or make it optional`
      })
    )
  );
}
