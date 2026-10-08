// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  DatePicker,
  Hidden,
  Location,
  Number,
  Submit
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { fixedAssetAdjustCostValidator } from "../../accounting.models";

type FixedAssetAdjustCostFormProps = {
  initialValues: z.infer<typeof fixedAssetAdjustCostValidator>;
  acquisitionCost: number;
  netBookValue: number;
  // The transfer needs a location; asked for only when the asset has none.
  hasLocation: boolean;
  // Whether the adjustment posts a journal, and so needs an offset account.
  accountingEnabled: boolean;
  onClose: () => void;
};

const FixedAssetAdjustCostForm = ({
  initialValues,
  acquisitionCost,
  netBookValue,
  hasLocation,
  accountingEnabled,
  onClose
}: FixedAssetAdjustCostFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const currencyDecimals = useCurrencyDecimals(company.baseCurrencyCode);

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={fixedAssetAdjustCostValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={initialValues}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Adjust Cost</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <div className="w-full divide-y divide-border text-sm">
                  <DetailRow label={t`Acquisition Cost`}>
                    {currencyFormatter.format(acquisitionCost)}
                  </DetailRow>
                  <DetailRow label={t`Net Book Value`}>
                    {currencyFormatter.format(netBookValue)}
                  </DetailRow>
                </div>
                <p className="text-sm text-muted-foreground">
                  {accountingEnabled ? (
                    <Trans>
                      Adds cost the asset was never charged with, such as the
                      labor and material of a job that recorded none. The value
                      is booked to the asset from the account it was spent from:
                      Retained Earnings for an earlier year, or this year's
                      labor or material expense.
                    </Trans>
                  ) : (
                    <Trans>
                      Adds cost the asset was never charged with, such as the
                      labor and material of a job that recorded none.
                    </Trans>
                  )}
                </p>
                <Number
                  name="amount"
                  label={t`Increase`}
                  minValue={0}
                  formatOptions={INPUT_FORMAT.money(
                    company.baseCurrencyCode,
                    currencyDecimals
                  )}
                />
                {accountingEnabled && (
                  <Account name="offsetAccountId" label={t`Offset Account`} />
                )}
                {hasLocation ? (
                  <Hidden name="locationId" />
                ) : (
                  <Location name="locationId" label={t`Location`} />
                )}
                <DatePicker name="transferDate" label={t`Date`} />
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    If depreciation has already run, the next run catches up the
                    months a Straight Line asset took at the old cost.
                  </Trans>
                </p>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "accounting")}>
                  <Trans>Adjust Cost</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

function DetailRow({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">
        {children}
      </span>
    </div>
  );
}

export default FixedAssetAdjustCostForm;
