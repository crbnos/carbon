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
import { Hidden, Select, Submit } from "~/components/Form";
import { deliveryDateCheckSettingsValidator } from "~/modules/settings/settings.models";
import type { deliveryDateControlTypes } from "~/modules/shared/shared.models";

type DeliveryDateControl = (typeof deliveryDateControlTypes)[number];

// One settings card = one saved concern (archetype F): the company's delivery
// date check level. An item's own level on its Planning tab wins.

export function DeliveryDateCheckCard({
  deliveryDateControl
}: {
  deliveryDateControl: DeliveryDateControl;
}) {
  const { t } = useLingui();
  const fetcher = useAction({
    onSuccess: () => toast.success(t`Delivery date check updated`)
  });

  const options: { value: DeliveryDateControl; label: string }[] = [
    { value: "None", label: t`None — no check` },
    { value: "Lead Time", label: t`Lead Time — the lead time through the BOM` },
    { value: "Stock", label: t`Stock — free stock, then the lead time` },
    {
      value: "Capacity",
      label: t`Capacity — free stock, then the shop's schedule`
    }
  ];

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
              When someone adds or changes a sales order line, check that the
              promised date can be met. The check runs only when the date is
              closer than the item's lead time through its BOM. It warns and
              shows the earliest date; it never stops the save. An item's
              Planning tab can set its own level.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 max-w-[400px]">
            <Select
              name="deliveryDateControl"
              label={t`Check`}
              options={options}
            />
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
