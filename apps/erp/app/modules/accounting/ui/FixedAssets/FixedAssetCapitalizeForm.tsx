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
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Combobox, DatePicker, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
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
  onClose: () => void;
};

const FixedAssetCapitalizeForm = ({
  initialValues,
  assetClasses,
  item,
  serialNumber,
  cost,
  onClose
}: FixedAssetCapitalizeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const hasNoCost = cost !== null && cost <= 0;

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
                  <Alert variant="destructive">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      <Trans>This unit has no cost in inventory</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        The asset would be worth nothing. Set a unit cost on the
                        item, then capitalize it.
                      </Trans>
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
                    hasNoCost || !permissions.can("create", "accounting")
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
