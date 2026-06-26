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
import { DatePicker, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { fixedAssetDisposalValidator } from "../../accounting.models";

type FixedAssetDisposalFormProps = {
  currentNBV: number;
  onClose: () => void;
};

const FixedAssetDisposalForm = ({
  currentNBV,
  onClose
}: FixedAssetDisposalFormProps) => {
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
            validator={fixedAssetDisposalValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={{
              disposalDate: ""
            }}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Dispose Asset</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <div className="text-sm text-muted-foreground">
                  <Trans>Current Net Book Value:</Trans>{" "}
                  <span className="font-medium text-foreground">
                    {currencyFormatter.format(currentNBV)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    This will write off the remaining book value of the asset.
                  </Trans>
                </p>
                <DatePicker
                  name="disposalDate"
                  label={t`Disposal Date`}
                  termId="fixed-asset-disposal-date"
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "accounting")}>
                  <Trans>Dispose</Trans>
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

export default FixedAssetDisposalForm;
