// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PartNumberDisplay as PartNumberDisplayValue } from "@carbon/documents/utils";
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
import {
  Hidden,
  PartNumberDisplay,
  type PartNumberParty,
  Submit
} from "~/components/Form";
import {
  customerPartNumberDisplaySettingsValidator,
  supplierPartNumberDisplaySettingsValidator
} from "~/modules/settings/settings.models";

// One settings card = one saved concern: which part numbers new document
// lines print by default. The field name is also the form's intent.
const partNumberSettings = {
  customer: {
    name: "customerPartNumberDisplay",
    validator: customerPartNumberDisplaySettingsValidator
  },
  supplier: {
    name: "supplierPartNumberDisplay",
    validator: supplierPartNumberDisplaySettingsValidator
  }
} as const;

export function PartNumbersCard({
  party,
  value
}: {
  party: PartNumberParty;
  value: PartNumberDisplayValue;
}) {
  const { t } = useLingui();
  const fetcher = useAction({
    onSuccess: () => toast.success(t`Part numbers on documents updated`)
  });
  const { name, validator } = partNumberSettings[party];

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={validator}
        defaultValues={{ [name]: value }}
        fetcher={fetcher}
      >
        <Hidden name="intent" value={name} />
        <CardHeader>
          <CardTitle>
            <Trans>Part Numbers on Documents</Trans>
          </CardTitle>
          <CardDescription>
            {party === "supplier" ? (
              <Trans>
                Choose which part numbers new purchase order lines print. A
                supplier can override this choice, and each line can change it.
              </Trans>
            ) : (
              <Trans>
                Choose which part numbers new quote, order, invoice and packing
                slip lines print. A customer can override this choice.
              </Trans>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8 max-w-[400px]">
            <PartNumberDisplay party={party} name={name} label={t`Print`} />
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
