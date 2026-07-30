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

export {
  assignStepPhases,
  buildAssemblyStepGroups,
  CURRENT_PLAN_VERSION,
  indexAssemblyGraph
};
export type { AssemblyGraphIndex } from "./graph";
export type { AssemblyPlan, AssemblyStepGroup, StepPhase } from "./plan";
export type { AssemblyGraph } from "./types";
