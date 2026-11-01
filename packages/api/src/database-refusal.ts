// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a database refusal means for the caller. Postgres refuses a write the
// caller can fix (a duplicate id, a reference to nothing, a missing or badly
// formed value) with a SQLSTATE; this names the category and says which field,
// so an API caller is not left with a bare 500. Values are never repeated: only
// column, table and constraint names, which are the API's own field names.

import {
  databaseReason,
  type FailureReason,
  type FailureReasonCode,
  reasonText
} from "@carbon/utils";
import type { ErrorCategory } from "./service-fn.server";

export type DatabaseRefusal = {
  category: ErrorCategory;
  message: string;
  reason: FailureReason;
};

// The category of each reason a database refusal can stand for. The reason
// and its English text come from `@carbon/utils`, which the browser shares.
const CATEGORIES: Partial<Record<FailureReasonCode, ErrorCategory>> = {
  duplicate: "conflict",
  stillUsed: "conflict",
  noMatch: "conflict",
  required: "validation",
  breaksRule: "validation",
  badValue: "validation",
  forbidden: "forbidden",
  notFound: "notFound"
};

// A trigger's own text (a `raw` reason) under the constraint code it raised.
const AUTHORED_CATEGORIES: Record<string, ErrorCategory> = {
  "23503": "conflict",
  "23514": "validation",
  "42501": "forbidden"
};

function authoredCategory(error: unknown): ErrorCategory | undefined {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    const code = (candidate as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string" && code in AUTHORED_CATEGORIES) {
      return AUTHORED_CATEGORIES[code];
    }
  }
  return undefined;
}

/**
 * The refusal a database error stands for, or null when it is not one the
 * caller can fix (a connection failure, a bug in our SQL). Looks one `cause`
 * deep, for an error that wraps the driver's.
 */
export function databaseRefusal(error: unknown): DatabaseRefusal | null {
  const reason = databaseReason(error);
  const category =
    reason &&
    (reason.code === "raw" ? authoredCategory(error) : CATEGORIES[reason.code]);
  return reason && category
    ? { category, message: reasonText(reason), reason }
    : null;
}
