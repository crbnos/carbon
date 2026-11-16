// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { DeliveryDateControl, Hidden, Submit } from "~/components/Form";
import { deliveryDateCheckSettingsValidator } from "~/modules/settings/settings.models";
import type { deliveryDateControlTypes } from "~/modules/shared/shared.models";

type DeliveryDateLevel = (typeof deliveryDateControlTypes)[number];

// One settings card = one saved concern (archetype F): the company's delivery
// date check level. An item's own level on its Planning tab wins.

export function DeliveryDateCheckCard({
  deliveryDateControl
}: {
  deliveryDateControl: DeliveryDateLevel;
}) {
  const { t } = useLingui();
  const fetcher = useAction({
    onSuccess: () => toast.success(t`Delivery date check updated`)
  });

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={deliveryDateCheckSettingsValidator}
        defaultValues={{ deliveryDateControl }}
        fetcher={fetcher}
      >
        <Hidden name="intent" value="deliveryDateControl" />
        <CardHeader>
          <CardTitle>
            <Trans>Delivery Date Check</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Warn when a sales order line's promised date can't be met. An
              item's Planning tab can override this.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 max-w-[400px]">
            <DeliveryDateControl name="deliveryDateControl" label={t`Check`} />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={fetcher.state !== "idle"}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
