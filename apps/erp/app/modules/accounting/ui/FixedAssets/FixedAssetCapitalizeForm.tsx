// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { LuInfo } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  Combobox,
  DatePicker,
  Hidden,
  Input,
  Number,
  Submit
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { fixedAssetCapitalizeValidator } from "../../accounting.models";

type FixedAssetCapitalizeFormProps = {
  initialValues: z.infer<typeof fixedAssetCapitalizeValidator>;
  assetClasses: { id: string; name: string }[];
  item: { readableId: string | null; name: string };
  serialNumber: string | null;
  // The unit's carrying cost — what the transfer will book. null when it
  // could not be read; the server function still decides on submit.
  cost: number | null;
  // Whether an entered cost posts a journal, and so needs an offset account.
  accountingEnabled: boolean;
  onClose: () => void;
};

const FixedAssetCapitalizeForm = ({
  initialValues,
  assetClasses,
  item,
  serialNumber,
  cost,
  accountingEnabled,
  onClose
}: FixedAssetCapitalizeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const currencyDecimals = useCurrencyDecimals(company.baseCurrencyCode);
  // A unit inventory carries at nothing — made by a job that recorded no
  // production or material, or issued at no cost — takes the cost entered
  // here instead.
  const hasNoCost = cost !== null && cost <= 0;
  // Entering a cost is recosting, which takes accounting update.
  const canEnterCost = permissions.can("update", "accounting");

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
            validator={fixedAssetCapitalizeValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={initialValues}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Capitalize as Fixed Asset</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="itemId" />
              <Hidden name="trackedEntityId" />
              <Hidden name="locationId" />
              <Hidden name="storageUnitId" />
              <VStack spacing={4}>
                <div className="w-full divide-y divide-border text-sm">
                  <DetailRow label={t`Item`}>
                    {[item.readableId, item.name].filter(Boolean).join(" — ")}
                  </DetailRow>
                  <DetailRow label={t`Serial Number`}>
                    {serialNumber ?? "—"}
                  </DetailRow>
                  <DetailRow label={t`Cost`}>
                    <span className="tabular-nums">
                      {cost === null ? "—" : currencyFormatter.format(cost)}
                    </span>
                  </DetailRow>
                </div>
                {hasNoCost ? (
                  <Alert>
                    <LuInfo className="h-4 w-4" />
                    <AlertTitle>
                      <Trans>This unit has no cost in inventory</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      {!canEnterCost ? (
                        <Trans>
                          Someone who can update accounting has to enter what it
                          cost to make before it can be capitalized.
                        </Trans>
                      ) : accountingEnabled ? (
                        <Trans>
                          Enter what it cost to make. The value is booked to the
                          asset from the account it was spent from: Retained
                          Earnings for an earlier year, or this year's labor or
                          material expense.
                        </Trans>
                      ) : (
                        <Trans>Enter what it cost to make.</Trans>
                      )}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      The unit leaves stock and becomes an asset at the cost
                      inventory carries it at.
                    </Trans>
                  </p>
                )}
                {hasNoCost && canEnterCost && (
                  <>
                    <Number
                      name="cost"
                      label={t`Acquisition Cost`}
                      termId="fixed-asset-acquisition-cost"
                      minValue={0}
                      formatOptions={INPUT_FORMAT.money(
                        company.baseCurrencyCode,
                        currencyDecimals
                      )}
                    />
                    {accountingEnabled && (
                      <Account
                        name="offsetAccountId"
                        label={t`Offset Account`}
                      />
                    )}
                  </>
                )}
                <Combobox
                  name="fixedAssetClassId"
                  label={t`Asset Class`}
                  termId="asset-class"
                  options={assetClasses.map((c) => ({
                    label: c.name,
                    value: c.id
                  }))}
                />
                <Input name="name" label={t`Name`} />
                <DatePicker name="transferDate" label={t`Transfer Date`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit
                  isDisabled={
                    !permissions.can("create", "accounting") ||
                    (hasNoCost && !canEnterCost)
                  }
                >
                  <Trans>Capitalize</Trans>
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
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}

export default FixedAssetCapitalizeForm;
