// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LicenceNotice } from "@carbon/ee/license";
import { Alert, AlertDescription } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

/** One licence notice above every page, for settings viewers on Enterprise. */
export function LicenceBanner({ notice }: { notice: LicenceNotice | null }) {
  const { t } = useLingui();
  if (!notice) return null;

  const dropsFeatures =
    notice.reason === "none" || notice.reason === "terminated";
  const message = {
    terminated: t`Your Carbon Enterprise license has ended.`,
    none: t`No valid Carbon Enterprise license.`,
    expired: t`Your Carbon Enterprise license has expired. The grace period ends ${formatDate(notice.until)}.`,
    "check-in": t`Your license hasn't reached the Carbon console in over 3 days.`,
    seats: t`More users than your license allows. Contact Carbon to add seats.`,
    clock: t`The server clock moved back. Check its time.`
  }[notice.reason];
  const consequence = !dropsFeatures
    ? null
    : notice.preview
      ? t`Paid features will turn off once licenses are enforced.`
      : t`Paid features are off.`;

  return (
    <Alert
      variant={notice.severity}
      className="rounded-none border-x-0 border-t-0 py-2 items-center"
    >
      <LuTriangleAlert />
      <AlertDescription className="flex items-center gap-3 text-sm">
        <span className="truncate">
          {message} {consequence}
        </span>
        <Link
          to={path.to.license}
          className="ml-auto shrink-0 underline whitespace-nowrap"
        >
          <Trans>View license</Trans>
        </Link>
      </AlertDescription>
    </Alert>
  );
}
