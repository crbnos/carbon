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
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Combobox, DatePicker, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { fixedAssetCapitalizeCipValidator } from "../../accounting.models";

type FixedAssetCapitalizeCipFormProps = {
  initialValues: z.infer<typeof fixedAssetCapitalizeCipValidator>;
  assetClasses: { id: string; name: string }[];
  // Σ fixedAssetCipCost.amount — what the capitalization journal moves.
  totalCost: number;
  cipClassName: string;
  onClose: () => void;
};

const FixedAssetCapitalizeCipForm = ({
  initialValues,
  assetClasses,
  totalCost,
  cipClassName,
  onClose
}: FixedAssetCapitalizeCipFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const [toClassId, setToClassId] = useState(initialValues.toClassId);
  const targetClass = assetClasses.find((c) => c.id === toClassId);

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
            validator={fixedAssetCapitalizeCipValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={initialValues}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Capitalize Asset</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <div className="text-sm text-muted-foreground">
                  <Trans>Total Construction Cost:</Trans>{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {currencyFormatter.format(totalCost)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The asset moves into its in-service class and starts
                    depreciating from the in-service date.
                  </Trans>
                </p>
                <Combobox
                  name="toClassId"
                  label={t`Asset Class`}
                  termId="asset-class"
                  options={assetClasses.map((c) => ({
                    label: c.name,
                    value: c.id
                  }))}
                  onChange={(value) => setToClassId(value?.value ?? "")}
                />
                <DatePicker name="inServiceDate" label={t`In-Service Date`} />
                <div className="w-full rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="font-medium">
                    <Trans>Journal Preview</Trans>
                  </p>
                  <p className="text-muted-foreground">
                    <Trans>Debit</Trans>{" "}
                    {targetClass?.name ?? t`the selected class`} ·{" "}
                    <Trans>Credit</Trans> {cipClassName} ·{" "}
                    <span className="tabular-nums">
                      {currencyFormatter.format(totalCost)}
                    </span>
                  </p>
                </div>
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

export default FixedAssetCapitalizeCipForm;
