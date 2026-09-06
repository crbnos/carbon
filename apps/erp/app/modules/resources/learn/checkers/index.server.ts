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
import {
  checkCloseAPeriod,
  checkPostPurchaseInvoice,
  checkRecordPayment
} from "./accounting.server";
import {
  checkAddCustomField,
  checkCreateEmployeeType,
  checkInviteAndPermission
} from "./admin.server";
import { checkCreateItem } from "./fundamentals.server";
import {
  checkAdjustQuantity,
  checkCountAndPost,
  checkTransferStock
} from "./inventory.server";
import { checkRunMrpAndReview, checkSetReorderPolicy } from "./planning.server";
import {
  checkCompleteJob,
  checkCreateJob,
  checkReleaseJob
} from "./production.server";
import {
  checkCapstoneSourceBrackets,
  checkCreateReleasePo,
  checkReceivePo
} from "./purchasing.server";
import {
  checkCloseAnIssue,
  checkRaiseIssue,
  checkRecordInspection
} from "./quality.server";
import type { LearnReader, ReaderScope } from "./reader.server";
import {
  checkConvertToOrder,
  checkCreateQuote,
  checkQuoteToInvoice
} from "./sales.server";

export type LearnCheckerContext = { scope: ReaderScope; reader: LearnReader };

export type LearnChecker = (
  ctx: LearnCheckerContext
) => Promise<LearnCheckResult>;

export const checkers: Record<string, LearnChecker> = {
  "fundamentals-create-item": checkCreateItem,

  "purchasing-create-release-po": checkCreateReleasePo,
  "purchasing-receive-po": checkReceivePo,
  "purchasing-capstone-source-brackets": checkCapstoneSourceBrackets,

  "accounting-post-purchase-invoice": checkPostPurchaseInvoice,
  "accounting-record-payment": checkRecordPayment,
  "accounting-close-a-period": checkCloseAPeriod,

  "sales-create-quote": checkCreateQuote,
  "sales-convert-to-order": checkConvertToOrder,
  "sales-quote-to-invoice": checkQuoteToInvoice,

  "inventory-adjust-quantity": checkAdjustQuantity,
  "inventory-transfer-stock": checkTransferStock,
  "inventory-count-and-post": checkCountAndPost,

  "production-create-job": checkCreateJob,
  "production-release-job": checkReleaseJob,
  "production-complete-job": checkCompleteJob,

  "planning-set-reorder-policy": checkSetReorderPolicy,
  "planning-run-mrp-and-review": checkRunMrpAndReview,

  "quality-raise-issue": checkRaiseIssue,
  "quality-record-inspection": checkRecordInspection,
  "quality-close-an-issue": checkCloseAnIssue,

  "admin-create-employee-type": checkCreateEmployeeType,
  "admin-add-custom-field": checkAddCustomField,
  "admin-invite-and-permission": checkInviteAndPermission
};

export function getChecker(slug: string): LearnChecker | undefined {
  return checkers[slug];
}

export type { LearnReader, ReaderScope } from "./reader.server";
export { makeSupabaseReader } from "./reader.server";
