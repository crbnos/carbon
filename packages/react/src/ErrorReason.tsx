// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  describeCause,
  type FailureReason,
  type FailureReasonCode,
  reasonText
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { toast } from "./Toast";

// The translated text of a reason. A function declaration, so Lingui folds
// each `t` into this hook (see `.claude/rules/i18n-lingui-system.md`). The
// English matches `reasonText` in `@carbon/utils`; `raw` is not translated.
function useReasonText(reason: FailureReason): string {
  const { t } = useLingui();
  const { columns, table, target, column, constraint, text } = reason.values;
  const code: FailureReasonCode = reason.code;
  switch (code) {
    case "duplicate":
      return columns
        ? t`A record with this ${columns} already exists.`
        : t`A record with these values already exists.`;
    case "stillUsed":
      return t`It is still used by a "${table}" record; remove that first.`;
    case "noMatch":
      if (columns && target) {
        return t`${columns} does not match an existing "${target}".`;
      }
      return columns
        ? t`${columns} does not match an existing record.`
        : t`A referenced record does not exist.`;
    case "required":
      return column
        ? t`"${column}" is required.`
        : t`A required field was missing.`;
    case "breaksRule":
      return constraint
        ? t`The values break the rule "${constraint}".`
        : t`The values break a rule on this record.`;
    case "badValue":
      return text ? `${text}.` : t`A value is not valid.`;
    case "forbidden":
      return t`You do not have permission to do this`;
    case "notFound":
      return t`No matching record was found.`;
    case "notApplied":
      return t`You don't have permission to change this record, or it no longer exists.`;
    case "raw":
      return text ?? "";
    default: {
      const unknown: never = code;
      return unknown;
    }
  }
}

/** Why a call failed, translated: the error toast's second line. */
export function ErrorReason({ reason }: { reason: FailureReason }) {
  return <>{useReasonText(reason)}</>;
}

/** The toast description for a reason, or nothing when the title already says it. */
export function errorDescription(
  title: string | undefined,
  reason: FailureReason | null | undefined
): ReactNode {
  if (!reason) return undefined;
  const text = reasonText(reason);
  if (!text || title?.includes(text)) return undefined;
  return <ErrorReason reason={reason} />;
}

/**
 * An error toast that says why: `title` is what failed, and the cause (a
 * Supabase error, a thrown `Error`, a failed result) becomes the second line.
 */
export function toastError(title: string, cause?: unknown) {
  return toast.error(title, {
    description: errorDescription(title, describeCause(cause))
  });
}
