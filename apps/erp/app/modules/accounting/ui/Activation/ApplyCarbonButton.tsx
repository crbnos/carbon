// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuArrowLeftToLine } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { activationStepPath } from "./ActivationSteps";

/**
 * Sets every control account on the trial balance to Carbon's opening total
 * and puts what that leaves out of balance on Retained Earnings, so Migration
 * Clearing totals zero. Enabled while it does not.
 */
export default function ApplyCarbonButton({
  cutoverDate,
  hasDifference
}: {
  cutoverDate: string;
  hasDifference: boolean;
}) {
  const permissions = usePermissions();
  const apply = useAction();
  return (
    <apply.Form
      method="post"
      action={activationStepPath("trial-balance", cutoverDate)}
    >
      <input type="hidden" name="intent" value="apply-carbon" />
      <input type="hidden" name="cutoverDate" value={cutoverDate} />
      <Button
        type="submit"
        variant="secondary"
        leftIcon={<LuArrowLeftToLine />}
        isDisabled={!permissions.can("update", "accounting") || !hasDifference}
        isLoading={apply.isPending}
      >
        <Trans>Apply to Trial Balance</Trans>
      </Button>
    </apply.Form>
  );
}
