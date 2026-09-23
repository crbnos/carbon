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
import { Trans, useLingui } from "@lingui/react/macro";
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
  // The item's current unit cost — a preview. The posted acquisition cost is
  // the unit's carrying cost from its cost layers, resolved by the function.
  unitCost: number;
  onClose: () => void;
};

const FixedAssetCapitalizeForm = ({
  initialValues,
  assetClasses,
  item,
  serialNumber,
  unitCost,
  onClose
}: FixedAssetCapitalizeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

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
                  <DetailRow label={t`Estimated Cost`}>
                    <span className="tabular-nums">
                      {currencyFormatter.format(unitCost)}
                    </span>
                  </DetailRow>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The unit leaves stock and becomes an asset at its carrying
                    cost. The estimate above is the item's current unit cost.
                  </Trans>
                </p>
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
                <Submit isDisabled={!permissions.can("create", "accounting")}>
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
