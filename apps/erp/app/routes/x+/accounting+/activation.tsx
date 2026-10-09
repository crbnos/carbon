// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useMatches } from "react-router";
import { SetupFrame } from "~/components/Setup";
import { getActivationCutover } from "~/modules/accounting/accounting.server";
import type { ActivationStep } from "~/modules/accounting/ui/Activation";
import {
  ActivationSteps,
  activationSteps
} from "~/modules/accounting/ui/Activation";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Setup`,
  to: path.to.accountingActivation
};

/** The enable wizard is for a company with no cutover. Once accounting is set
 *  up it is one-way, so the wizard sends the user to the periods. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const settings = await client
    .from("companySettings")
    .select("accountingCutoverDate")
    .eq("id", companyId)
    .maybeSingle();
  if (settings.data?.accountingCutoverDate) {
    throw redirect(path.to.accountingPeriods);
  }

  return getActivationCutover(client, companyId, request);
}

/** The current step, from the deepest matched activation route. */
function useCurrentStep(): ActivationStep {
  const matches = useMatches();
  for (const step of activationSteps) {
    if (matches.some((match) => match.id.endsWith(`activation.${step}`))) {
      return step;
    }
  }
  return "readiness";
}

export default function AccountingActivationRoute() {
  const { t } = useLingui();
  const { cutoverDate } = useLoaderData<typeof loader>();
  const step = useCurrentStep();

  return (
    <SetupFrame
      title={t`Set Up Accounting`}
      subtitle={t`Open the books at a cutover date. Enabling accounting is one-way.`}
      step={step}
      steps={<ActivationSteps current={step} cutoverDate={cutoverDate} />}
    >
      <RecordOutlet />
    </SetupFrame>
  );
}
