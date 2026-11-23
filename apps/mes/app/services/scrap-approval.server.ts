// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { logAuthEvent } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ScrapApprovalPrompt, ScrapSubject } from "@carbon/ee/approvals";
import {
  authorizeScrapApprover,
  describeScrap,
  discardScrapApproval,
  failedScrapPostingSettlement,
  getScrapApprovalRequirement,
  hasScrapApprovalRules,
  markScrapApprovalPosted,
  recordScrapApproval
} from "@carbon/ee/approvals/scrap.server";
import { verifyEmployeePin } from "@carbon/ee/console.server";
import { getLogger } from "@carbon/logger";
import { equals, getClientIp } from "@carbon/utils";
import { getDatabaseClient } from "~/services/database.server";
import {
  GENERIC_PIN_ERROR,
  LOCKED_PIN_ERROR,
  pinLockout,
  pinLockoutKey,
  pinTerminalKey,
  terminalRatelimit
} from "~/services/pin-limits.server";

const logger = getLogger("mes", "scrap-approval");

export type ScrapPostingResult<T> = {
  data: T | null;
  /** `status` 4xx: the posting refused the scrap. Anything else may have posted. */
  error: { message: string; status?: number } | null;
};

export type ScrapApprovalOutcome<T> =
  | { status: "posted"; data: T | null }
  | { status: "approval-required"; prompt: ScrapApprovalPrompt }
  | { status: "refused"; message: string; error?: unknown };

/**
 * Posts a scrap from the shop floor, asking for an approver when a scrap
 * approval rule applies.
 *
 * 1. No enabled rule, or a value under every tier: `post` runs as before.
 * 2. A rule applies and the form names no approver: answers
 *    `approval-required` with the value and the approvers who may sign.
 * 3. An approver, their PIN and the value they were shown: checks the
 *    approver may sign this scrap (not the person recording it, offered at
 *    this tier: active, with a PIN), that the value is still the one shown,
 *    then the PIN under the console PIN budgets. Then it records the
 *    approval, posts, and marks it posted.
 * 4. A posting that refused the scrap (4xx, a quantity changed since it was
 *    valued included) removes the record. Any other failure may have posted
 *    (a timeout after the commit), so the record stays with no `postedAt`,
 *    unless `postedDespiteError` says it posted.
 * 5. A scrap approved before (`alreadyApproved`, a resumed batch completion)
 *    posts without asking, and marks the record it names posted once the
 *    posting succeeds.
 */
export async function postScrapWithApproval<T>(args: {
  request: Request;
  companyId: string;
  /** The person recording the scrap (the pinned-in operator in console mode). */
  userId: string;
  /** The signed-in account of the tablet, for the terminal PIN budget. */
  sessionUserId: string;
  subject: ScrapSubject;
  approver: {
    approverId?: string;
    approverPin?: string;
    /** The estimated value the approver was shown. */
    approvedValue?: number;
  };
  /**
   * Posts the scrap. `valued` is the quantity the scrap was valued at, when
   * a rule is enabled: a posting that can bind to it scraps only that.
   */
  post: (valued?: { quantity: number }) => Promise<ScrapPostingResult<T>>;
  /**
   * The approval this scrap already has (a resumed batch completion), with
   * the record to mark posted when the posting succeeds; null when it has none.
   */
  alreadyApproved?: () => Promise<{ scrapRequestId: string | null } | null>;
  /** Whether a failed posting still committed the scrap; "unknown" keeps the record. */
  postedDespiteError?: () => Promise<boolean | "unknown">;
}): Promise<ScrapApprovalOutcome<T>> {
  const { companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();
  const db = getDatabaseClient();

  const postAsBefore = async (valued?: {
    quantity: number;
  }): Promise<ScrapApprovalOutcome<T>> => {
    const posted = await args.post(valued);
    if (posted.error) {
      return {
        status: "refused",
        message: posted.error.message,
        error: posted.error
      };
    }
    return { status: "posted", data: posted.data };
  };

  const markPosted = (scrapRequestId: string) =>
    markScrapApprovalPosted(db, {
      companyId,
      scrapRequestIds: [scrapRequestId],
      userId
    }).catch((error) => {
      // The scrap posted and its approval is recorded; only the posted mark
      // is missing, which the list shows as not confirmed.
      logger.error("Failed to mark a scrap approval posted", {
        companyId,
        scrapRequestId,
        error
      });
    });

  // A resume confirms the record its first attempt left unconfirmed.
  const postApprovedBefore = async (
    scrapRequestId: string | null
  ): Promise<ScrapApprovalOutcome<T>> => {
    const outcome = await postAsBefore();
    if (outcome.status === "posted" && scrapRequestId) {
      await markPosted(scrapRequestId);
    }
    return outcome;
  };

  let requirement: Awaited<ReturnType<typeof getScrapApprovalRequirement>>;
  let scrap: Awaited<ReturnType<typeof describeScrap>>;
  try {
    if (!(await hasScrapApprovalRules(serviceRole, companyId))) {
      return postAsBefore();
    }
    const approvedBefore = args.alreadyApproved
      ? await args.alreadyApproved()
      : null;
    if (approvedBefore) {
      return postApprovedBefore(approvedBefore.scrapRequestId);
    }
    scrap = await describeScrap(db, companyId, args.subject);
    requirement = await getScrapApprovalRequirement(serviceRole, db, {
      companyId,
      recordedBy: userId,
      estimatedValue: scrap.estimatedValue
    });
  } catch (error) {
    // Fail closed: an unknown answer must not let the scrap through.
    logger.error("Failed to check scrap approval", {
      companyId,
      subject: args.subject.type,
      error
    });
    return {
      status: "refused",
      message: "Could not check whether this scrap needs approval. Try again."
    };
  }

  // Under every tier too, the posting scraps the quantity that was valued.
  const valued = scrap.quantity > 0 ? { quantity: scrap.quantity } : undefined;
  if (!requirement.required || !valued) return postAsBefore(valued);

  const prompt = (error?: string): ScrapApprovalOutcome<T> => ({
    status: "approval-required",
    prompt: {
      estimatedValue: requirement.estimatedValue,
      currencyCode: requirement.currencyCode,
      decimalPlaces: requirement.decimalPlaces,
      approvers: requirement.approvers,
      ...(error ? { error } : {})
    }
  });

  const { approverId, approverPin, approvedValue } = args.approver;
  if (!approverId || !approverPin) return prompt();

  let authority: Awaited<ReturnType<typeof authorizeScrapApprover>>;
  try {
    authority = await authorizeScrapApprover(serviceRole, {
      companyId,
      approverId,
      recordedBy: userId,
      estimatedValue: requirement.estimatedValue
    });
  } catch (error) {
    // Fail closed, and ask again: nothing was recorded or posted.
    logger.error("Failed to check a scrap approver's authority", {
      companyId,
      approverId,
      error
    });
    return prompt("Could not check this approver. Try again.");
  }
  if (authority.error) return prompt(authority.error.message);
  // The offered list is the one that knows the person is active and has a
  // PIN: a deactivated approver keeps both their PIN row and rule membership.
  if (!requirement.approvers.some((approver) => approver.id === approverId)) {
    return prompt("This person cannot approve this scrap.");
  }
  // What the approver signs is the value they were shown: a quantity changed
  // after the prompt, or a cost that moved, needs a new look.
  if (
    approvedValue === undefined ||
    !equals(approvedValue, requirement.estimatedValue)
  ) {
    return prompt(
      "The scrap changed since it was shown. Check the value, then enter the PIN again."
    );
  }

  let pinError: string | null;
  try {
    pinError = await checkApproverPin({
      request: args.request,
      companyId,
      approverId,
      pin: approverPin,
      sessionUserId: args.sessionUserId
    });
  } catch (error) {
    // The lockout store or the PIN read failed: no answer is a "no", and the
    // approver can enter the PIN again.
    logger.error("Failed to check a scrap approver's PIN", {
      companyId,
      approverId,
      error
    });
    return prompt("Could not check the PIN. Try again.");
  }
  if (pinError) return prompt(pinError);

  let recorded: Awaited<ReturnType<typeof recordScrapApproval>>;
  try {
    recorded = await recordScrapApproval(db, {
      companyId,
      scrap,
      recordedBy: userId,
      approvedBy: approverId
    });
  } catch (error) {
    logger.error("Failed to record a scrap approval", { companyId, error });
    return {
      status: "refused",
      message: "Could not record the approval. The scrap was not posted."
    };
  }

  const posted = await args.post(valued);
  if (posted.error) {
    const refusedScrap =
      posted.error.status !== undefined &&
      posted.error.status >= 400 &&
      posted.error.status < 500;
    // A failed read of whether it posted is not a "no": the record stays.
    let committed: boolean | "unknown" = false;
    if (args.postedDespiteError) {
      try {
        committed = await args.postedDespiteError();
      } catch (error) {
        logger.error("Could not read whether a failed scrap posted", {
          companyId,
          scrapRequestId: recorded.scrapRequestId,
          error
        });
        committed = "unknown";
      }
    }
    const settlement = failedScrapPostingSettlement({
      refused: refusedScrap,
      committed
    });
    if (settlement === "mark posted") {
      await markPosted(recorded.scrapRequestId);
    } else if (settlement === "discard") {
      await discardScrapApproval(db, {
        companyId,
        scrapRequestIds: [recorded.scrapRequestId]
      }).catch((error) => {
        logger.error("Failed to remove the approval of a refused scrap", {
          companyId,
          scrapRequestId: recorded.scrapRequestId,
          error
        });
      });
    } else {
      // Not a refusal: the ERP may have committed before the answer was
      // lost. The record stays, unconfirmed, rather than a posted scrap
      // with no approval.
      logger.warning("Scrap posting failed without a refusal; approval kept", {
        companyId,
        scrapRequestId: recorded.scrapRequestId,
        status: posted.error.status
      });
    }
    return {
      status: "refused",
      message: posted.error.message,
      error: posted.error
    };
  }

  await markPosted(recorded.scrapRequestId);
  return { status: "posted", data: posted.data };
}

/**
 * The approver's PIN, under the same per-person lockout and per-terminal
 * budget as console pin-in. Returns the message to show, or null when the PIN
 * is right.
 */
async function checkApproverPin(args: {
  request: Request;
  companyId: string;
  approverId: string;
  pin: string;
  sessionUserId: string;
}): Promise<string | null> {
  const { companyId, approverId } = args;
  const ip = getClientIp(args.request) ?? undefined;
  const lockoutKey = pinLockoutKey(companyId, approverId);
  const terminalKey = pinTerminalKey(companyId, args.sessionUserId);

  const terminal = await terminalRatelimit.limit(terminalKey);
  if (!terminal.success) {
    logAuthEvent("login_rate_limited", {
      userId: args.sessionUserId,
      companyId,
      ip,
      reason: "scrap approval PIN terminal rate limit"
    });
    return LOCKED_PIN_ERROR;
  }

  const attempt = await pinLockout.recordFailure(lockoutKey);
  if (attempt.locked) {
    await terminalRatelimit.refund(terminalKey);
    logAuthEvent("login_locked", {
      userId: approverId,
      companyId,
      ip,
      reason: "scrap approval PIN locked",
      retryAfterSeconds: attempt.retryAfterSeconds,
      terminalUserId: args.sessionUserId
    });
    return LOCKED_PIN_ERROR;
  }

  const check = await verifyEmployeePin(getDatabaseClient(), {
    employeeId: approverId,
    companyId,
    pin: args.pin
  });

  if (!check.hasPin) {
    await Promise.all([
      pinLockout.reset(lockoutKey),
      terminalRatelimit.refund(terminalKey)
    ]);
    return "This approver has no PIN. Ask an admin to set a console PIN for them.";
  }

  if (!check.valid) {
    logAuthEvent("login_failed", {
      userId: approverId,
      companyId,
      ip,
      reason: "scrap approval: incorrect PIN",
      terminalUserId: args.sessionUserId
    });
    return GENERIC_PIN_ERROR;
  }

  await Promise.all([
    pinLockout.reset(lockoutKey),
    terminalRatelimit.refund(terminalKey)
  ]);
  return null;
}
