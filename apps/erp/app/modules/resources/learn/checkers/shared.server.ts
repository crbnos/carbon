/**
 * Carbon Learn — the two things every challenge checker needs.
 *
 * Server-only. Extracted once nine tracks wanted the same four lines: a
 * checker's context, and the failure shape that names the FIRST unmet
 * requirement in the order the curriculum lists it.
 */

import type { LearnCheckResult } from "../types";
import type { LearnReader, ReaderScope } from "./reader.server";

export type CheckerContext = { scope: ReaderScope; reader: LearnReader };

export const fail = (
  failedRequirement: string,
  message: string
): LearnCheckResult => ({
  passed: false,
  failedRequirement,
  message
});
