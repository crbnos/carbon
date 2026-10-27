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
 * 4. A posting that refused the scrap (4xx) removes the record. Any other
 *    failure may have posted (a timeout after the commit), so the record
 *    stays with no `postedAt`, unless `postedDespiteError` says it posted.
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
  post: () => Promise<ScrapPostingResult<T>>;
  /** True when this scrap was already approved (a resumed batch completion). */
  alreadyApproved?: () => Promise<boolean>;
  /** True when a failed posting still committed the scrap. */
  postedDespiteError?: () => Promise<boolean>;
}): Promise<ScrapApprovalOutcome<T>> {
  const { companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();
  const db = getDatabaseClient();

  const postAsBefore = async (): Promise<ScrapApprovalOutcome<T>> => {
    const posted = await args.post();
    if (posted.error) {
      return {
        status: "refused",
        message: posted.error.message,
        error: posted.error
      };
    }
    return { status: "posted", data: posted.data };
  };

  let requirement: Awaited<ReturnType<typeof getScrapApprovalRequirement>>;
  let scrap: Awaited<ReturnType<typeof describeScrap>>;
  try {
    if (!(await hasScrapApprovalRules(serviceRole, companyId))) {
      return postAsBefore();
    }
    if (args.alreadyApproved && (await args.alreadyApproved())) {
      return postAsBefore();
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

  if (!requirement.required || scrap.quantity <= 0) return postAsBefore();

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

  const authority = await authorizeScrapApprover(serviceRole, {
    companyId,
    approverId,
    recordedBy: userId,
    estimatedValue: requirement.estimatedValue
  });
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

  const pinError = await checkApproverPin({
    request: args.request,
    companyId,
    approverId,
    pin: approverPin,
    sessionUserId: args.sessionUserId
  });
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

  const markPosted = () =>
    markScrapApprovalPosted(db, {
      companyId,
      scrapRequestId: recorded.scrapRequestId,
      userId
    }).catch((error) => {
      // The scrap posted and its approval is recorded; only the posted mark
      // is missing, which the list shows as not confirmed.
      logger.error("Failed to mark a scrap approval posted", {
        companyId,
        scrapRequestId: recorded.scrapRequestId,
        error
      });
    });

  const posted = await args.post();
  if (posted.error) {
    const refusedScrap =
      posted.error.status !== undefined &&
      posted.error.status >= 400 &&
      posted.error.status < 500;
    const committed =
      args.postedDespiteError &&
      (await args.postedDespiteError().catch(() => false));
    if (committed) {
      await markPosted();
    } else if (refusedScrap) {
      await discardScrapApproval(db, {
        companyId,
        scrapRequestId: recorded.scrapRequestId
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
      logger.warn("Scrap posting failed without a refusal; approval kept", {
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

  await markPosted();
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
