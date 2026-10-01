// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Three-free entry point for the pure plan → step-group logic, so server code
 * (the Inngest worker) can build assembly steps without pulling in the viewer's
 * three.js/react rendering deps that the package barrel (index.ts) re-exports.
 */
import { indexAssemblyGraph } from "./graph";
import {
  assignStepPhases,
  buildAssemblyStepGroups,
  CURRENT_PLAN_VERSION
} from "./plan";
import { joinTargets, stagedGroupNodeIds } from "./staging";

export {
  assignStepPhases,
  buildAssemblyStepGroups,
  CURRENT_PLAN_VERSION,
  indexAssemblyGraph,
  joinTargets,
  stagedGroupNodeIds
};
export type { AssemblyGraphIndex } from "./graph";
export type { AssemblyPlan, AssemblyStepGroup, StepPhase } from "./plan";
export type { AssemblyGraph } from "./types";
