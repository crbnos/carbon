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
import { DatePicker, Location, StorageUnit, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { fixedAssetReturnToInventoryValidator } from "../../accounting.models";

type FixedAssetReturnToInventoryFormProps = {
  initialValues: z.infer<typeof fixedAssetReturnToInventoryValidator>;
  currentNBV: number;
  itemId: string;
  onClose: () => void;
};

const FixedAssetReturnToInventoryForm = ({
  initialValues,
  currentNBV,
  itemId,
  onClose
}: FixedAssetReturnToInventoryFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const [locationId, setLocationId] = useState(initialValues.locationId ?? "");

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
            validator={fixedAssetReturnToInventoryValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={initialValues}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Return to Inventory</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <div className="text-sm text-muted-foreground">
                  <Trans>Current Net Book Value:</Trans>{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {currencyFormatter.format(currentNBV)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The unit goes back into stock at its net book value and the
                    asset is closed with no gain or loss.
                  </Trans>
                </p>
                <Location
                  name="locationId"
                  label={t`Location`}
                  onChange={(value) => setLocationId(value?.value ?? "")}
                />
                <StorageUnit
                  name="storageUnitId"
                  label={t`Storage Unit`}
                  locationId={locationId}
                  itemId={itemId}
                  isOptional
                />
                <DatePicker name="transferDate" label={t`Transfer Date`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("create", "accounting")}>
                  <Trans>Return to Inventory</Trans>
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

export default FixedAssetReturnToInventoryForm;
