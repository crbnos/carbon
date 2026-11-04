// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ScrollArea,
  toast
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Number, Submit } from "~/components/Form";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import { useCurrencyDecimals, useUser } from "~/hooks";
import { serviceSettingsValidator } from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings-service");

export const handle: Handle = {
  breadcrumb: msg`Service`,
  to: path.to.serviceSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings(client, companyId);
  if (!companySettings.data) {
    logger.error("Failed to load company settings", {
      companyId,
      error: companySettings.error
    });
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  }
  return { companySettings: companySettings.data };
}

// An emptied rate is cleared, not left as it was.
const serviceSettingsForm = serviceSettingsValidator.transform(
  ({ serviceLaborCostRate, serviceLaborBillRate }) => ({
    serviceLaborCostRate: serviceLaborCostRate ?? null,
    serviceLaborBillRate: serviceLaborBillRate ?? null
  })
);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateServiceSettings(input.data);
}

export default function ServiceSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { company } = useUser();
  const currency = company?.baseCurrencyCode ?? "USD";
  const decimalPlaces = useCurrencyDecimals(currency);
  const fetcher = useAction<typeof action>({
    onSuccess: () => toast.success(t`Service settings updated`)
  });

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Service</Trans>
        </SettingsPageHeading>

        <ValidatedForm
          method="post"
          validator={serviceSettingsValidator}
          defaultValues={{
            serviceLaborCostRate:
              companySettings.serviceLaborCostRate ?? undefined,
            serviceLaborBillRate:
              companySettings.serviceLaborBillRate ?? undefined
          }}
          fetcher={fetcher}
          className="flex w-full flex-col gap-4"
        >
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Labor rates</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  A new service job copies the bill rate. Each time entry posts
                  its cost at the cost rate.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-8 max-w-[400px]">
                <Number
                  name="serviceLaborCostRate"
                  label={t`Labor cost per hour`}
                  minValue={0}
                  step={INPUT_STEP.rate}
                  formatOptions={INPUT_FORMAT.rate(currency, decimalPlaces)}
                />
                <Number
                  name="serviceLaborBillRate"
                  label={t`Default bill rate per hour`}
                  minValue={0}
                  step={INPUT_STEP.rate}
                  formatOptions={INPUT_FORMAT.rate(currency, decimalPlaces)}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit isDisabled={fetcher.state !== "idle"}>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </Card>
        </ValidatedForm>
      </SettingsPage>
    </ScrollArea>
  );
}
