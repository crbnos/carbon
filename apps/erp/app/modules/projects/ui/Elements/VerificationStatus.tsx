// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  LuShield,
  LuShieldCheck,
  LuShieldX,
  LuTriangleAlert
} from "react-icons/lu";
import type { RequirementStatus } from "../../projects.models";

const REQUIREMENT_STATUS_COLOR = {
  Pass: "green",
  Fail: "red",
  Unverified: "gray"
} as const satisfies Record<RequirementStatus, string>;

/** A Requirement's verification: Pass, Fail or Unverified. */
export function VerificationStatus({
  status,
  iconOnly
}: {
  status: RequirementStatus | null | undefined;
  iconOnly?: boolean;
}) {
  const { t } = useLingui();
  if (!status) return null;
  const labels: Record<RequirementStatus, string> = {
    Pass: t`Pass`,
    Fail: t`Fail`,
    Unverified: t`Unverified`
  };
  return (
    <Status color={REQUIREMENT_STATUS_COLOR[status]} iconOnly={iconOnly}>
      {labels[status]}
    </Status>
  );
}

/**
 * A Requirement's verification as plain text with its own icon, for a
 * properties column: a green check shield (Pass), a red cross shield (Fail),
 * a muted shield (Unverified). No pill.
 */
export function VerificationStatusText({
  status
}: {
  status: RequirementStatus | null | undefined;
}) {
  const { t } = useLingui();
  if (!status) return null;
  const labels: Record<RequirementStatus, string> = {
    Pass: t`Verified`,
    Fail: t`Failed`,
    Unverified: t`Unverified`
  };
  return (
    <span className="inline-flex items-center gap-2">
      <VerificationIcon status={status} showUnverified />
      <span className={status === "Unverified" ? "text-muted-foreground" : ""}>
        {labels[status]}
      </span>
    </span>
  );
}

/**
 * The icon of a verified outcome: a green check shield for Pass, a red cross
 * shield for Fail. Unverified shows nothing (unless `showUnverified`), so a
 * list row is not marked until a check decides it.
 */
export function VerificationIcon({
  status,
  showUnverified = false
}: {
  status: RequirementStatus | null | undefined;
  showUnverified?: boolean;
}) {
  const { t } = useLingui();
  if (status === "Pass") {
    return (
      <LuShieldCheck
        aria-label={t`Verified`}
        className="size-4 shrink-0 text-emerald-500"
      />
    );
  }
  if (status === "Fail") {
    return (
      <LuShieldX
        aria-label={t`Failed`}
        className="size-4 shrink-0 text-red-500"
      />
    );
  }
  if (status === "Unverified" && showUnverified) {
    return (
      <LuShield
        aria-label={t`Unverified`}
        className="size-4 shrink-0 text-muted-foreground"
      />
    );
  }
  return null;
}

/** The amber triangle of an element with an incoming trace link that needs review. */
export function SuspectBadge({ count = 1 }: { count?: number }) {
  const { t } = useLingui();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">
          <LuTriangleAlert
            aria-label={t`Link needs review`}
            className="size-4 text-amber-500"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {count === 1
          ? t`A linked element changed. Review the link.`
          : t`${count} linked elements changed. Review the links.`}
      </TooltipContent>
    </Tooltip>
  );
}
