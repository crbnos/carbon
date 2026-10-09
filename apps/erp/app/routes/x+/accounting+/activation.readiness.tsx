// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { DatePicker } from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useDateFormatter } from "~/hooks";
import {
  getActivationCutover,
  getActivationReadiness
} from "~/modules/accounting/accounting.server";
import {
  ActivationFooter,
  activationStepPath,
  ReadinessChecklist,
  useActivationRouteData
} from "~/modules/accounting/ui/Activation";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Readiness`,
  to: path.to.accountingActivationStep("readiness")
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });
  const { cutoverDate } = await getActivationCutover(
    client,
    companyId,
    request
  );
  const readiness = await getActivationReadiness(getDatabaseClient(), {
    companyId,
    cutoverDate
  });
  return { cutoverDate, readiness };
}

/** Step 1: the cutover date and the checks that must pass before the enable. */
export default function AccountingActivationReadinessRoute() {
  const { t } = useLingui();
  const { cutoverDate, readiness } = useLoaderData<typeof loader>();
  const routeData = useActivationRouteData();
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();

  return (
    <>
      <SetupBody>
        <SetupSection
          title={<Trans>Cutover Date</Trans>}
          description={
            <Trans>
              Carbon posts every document dated on or after this day. Choose the
              first day of the current period or of one of the 3 periods before
              it.
            </Trans>
          }
        >
          <div className="w-64">
            <DatePicker
              aria-label={t`Cutover date`}
              closeOnSelect
              value={parseDate(cutoverDate)}
              minValue={
                routeData ? parseDate(routeData.earliestCutoverDate) : undefined
              }
              maxValue={
                routeData ? parseDate(routeData.latestCutoverDate) : undefined
              }
              isDateUnavailable={(date) => date.day !== 1}
              onChange={(value) => {
                if (value && value.toString() !== cutoverDate) {
                  navigate(activationStepPath("readiness", value.toString()));
                }
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            <Trans>
              The opening balances are as of the end of{" "}
              {formatDate(
                parseDate(cutoverDate).subtract({ days: 1 }).toString()
              )}
              .
            </Trans>
          </p>
        </SetupSection>

        <SetupSection
          title={<Trans>Readiness</Trans>}
          description={
            <Trans>
              Every check must pass before accounting can be enabled.
            </Trans>
          }
        >
          <ReadinessChecklist checks={readiness.checks} />
        </SetupSection>
      </SetupBody>
      <ActivationFooter
        step="readiness"
        cutoverDate={cutoverDate}
        canContinue={readiness.passed}
      />
    </>
  );
}
