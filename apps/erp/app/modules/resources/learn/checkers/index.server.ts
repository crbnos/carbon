/**
 * Carbon Learn — the challenge checker registry.
 *
 * Server-only. This is the ONE place a challenge slug becomes a verification:
 * a route action resolves `getChecker(slug)`, builds a reader from its
 * request-scoped Supabase client, and runs it. Nothing else may query on a
 * challenge's behalf.
 *
 * Adding a challenge to `curriculum.ts` without registering it here fails the
 * meta-test in `checkers.test.ts`, by design — a challenge nobody can pass is
 * worse than no challenge.
 */

import type { LearnCheckResult } from "../types";
import { checkCreateItem } from "./fundamentals.server";
import {
  checkCapstoneSourceBrackets,
  checkCreateReleasePo,
  checkReceivePo
} from "./purchasing.server";
import type { LearnReader, ReaderScope } from "./reader.server";

export type LearnCheckerContext = { scope: ReaderScope; reader: LearnReader };

export type LearnChecker = (
  ctx: LearnCheckerContext
) => Promise<LearnCheckResult>;

export const checkers: Record<string, LearnChecker> = {
  "fundamentals-create-item": checkCreateItem,
  "purchasing-create-release-po": checkCreateReleasePo,
  "purchasing-receive-po": checkReceivePo,
  "purchasing-capstone-source-brackets": checkCapstoneSourceBrackets
};

export function getChecker(slug: string): LearnChecker | undefined {
  return checkers[slug];
}

export type { LearnReader, ReaderScope } from "./reader.server";
export { makeSupabaseReader } from "./reader.server";
