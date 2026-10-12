// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  burdenRateTypes,
  burdenSettingsValidator
} from "@carbon/ee/indirect-rates";
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
import type { z } from "zod";
import { Boolean, Hidden, Select, Submit } from "~/components/Form";

type BurdenSettingsFormProps = {
  initialValues: z.infer<typeof burdenSettingsValidator>;
  action: string;
  isDisabled: boolean;
};

/**
 * Which rate burdens projects, and whether burden posts to the ledger (B9).
 * A card of Settings → Accounting; it posts `intent=burdenSettings` there.
 */
const BurdenSettingsForm = ({
  initialValues,
  action,
  isDisabled
}: BurdenSettingsFormProps) => {
  const { t } = useLingui();
  const fetcher = useAction<{ success?: boolean; message?: string | null }>({
    onSettled: (data) => {
      if (!data?.message) return;
      if (data.success) toast.success(data.message);
      else toast.error(data.message);
    }
  });

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={action}
        validator={burdenSettingsValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Burden Settings</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Burden rows are memo rows unless applied burden posts them to the
              general ledger.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="burdenSettings" />
          <div className="flex flex-col gap-4">
            <Select
              name="burdenRateType"
              label={t`Burden Rate Type`}
              termId="burden"
              helperText={t`The rate the burden run applies to project cost`}
              options={burdenRateTypes.map((rateType) => ({
                label: rateType,
                value: rateType
              }))}
            />
            <Boolean
              name="postAppliedBurden"
              label={t`Post applied burden for Contract projects`}
              bordered
              description={t`Debit Project WIP and credit each pool's applied account`}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={isDisabled || fetcher.state !== "idle"}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default BurdenSettingsForm;
