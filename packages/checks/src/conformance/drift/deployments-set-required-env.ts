// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validateEnv } from "@carbon/env/validate";
import { defineCheck } from "../../check";
import {
  findDeploymentEnvGaps,
  loadDeploymentEnvSources
} from "../../sources/deployment-env";

// A variable that stops startup when missing must already be set by every
// deployment, or adding it takes production down. The deployments and the
// files that say what each sets are in `src/sources/deployment-env.ts`.
export const deploymentsSetRequiredEnv = defineCheck({
  id: "deployments-set-required-env",
  description:
    "A variable that stops startup when missing must already be set by every deployment, or adding it takes production down.",
  reads: { sources: loadDeploymentEnvSources },
  find: ({ sources }) =>
    findDeploymentEnvGaps(sources, (env) =>
      validateEnv(env)
        .problems.filter((p) => p.level === "error")
        .map((p) => p.name)
    )
});
