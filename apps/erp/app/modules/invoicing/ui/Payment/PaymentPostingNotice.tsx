// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCircleAlert, LuInfo } from "react-icons/lu";

type PaymentPostingNoticeProps = {
  status: string | null;
  postError: string | null;
  hasApplications: boolean;
};

// A Draft's applications change no invoice until the payment posts, so say so,
// and keep the reason the last post failed in view until a post succeeds.
const PaymentPostingNotice = ({
  status,
  postError,
  hasApplications
}: PaymentPostingNoticeProps) => {
  if (status !== "Draft") return null;
  if (postError) {
    return (
      <Alert variant="destructive">
        <LuCircleAlert />
        <AlertTitle>
          <Trans>This payment did not post</Trans>
        </AlertTitle>
        <AlertDescription>{postError}</AlertDescription>
      </Alert>
    );
  }
  if (!hasApplications) return null;
  return (
    <Alert>
      <LuInfo />
      <AlertTitle>
        <Trans>Not posted</Trans>
      </AlertTitle>
      <AlertDescription>
        <Trans>
          This payment is a Draft. Its applications do not pay the invoices
          until it is posted.
        </Trans>
      </AlertDescription>
    </Alert>
  );
};

export default PaymentPostingNotice;
