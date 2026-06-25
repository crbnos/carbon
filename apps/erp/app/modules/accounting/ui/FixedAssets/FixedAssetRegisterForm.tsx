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
import { DatePicker, Number, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { fixedAssetRegisterValidator } from "../../accounting.models";

type FixedAssetRegisterFormProps = {
  onClose: () => void;
};

const FixedAssetRegisterForm = ({ onClose }: FixedAssetRegisterFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const fetcher = useFetcher();

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={fixedAssetRegisterValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={{
              acquisitionCost: 0,
              acquisitionDate: "",
              accumulatedDepreciation: 0,
              depreciationStartDate: ""
            }}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Register Existing Asset</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Number
                  name="acquisitionCost"
                  label={t`Acquisition Cost`}
                  termId="fixed-asset-acquisition-cost"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <DatePicker
                  name="acquisitionDate"
                  label={t`Acquisition Date`}
                />
                <Number
                  name="accumulatedDepreciation"
                  label={t`Accumulated Depreciation`}
                  termId="fixed-asset-opening-accumulated-depreciation"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <DatePicker
                  name="depreciationStartDate"
                  label={t`Depreciation Start Date`}
                  termId="fixed-asset-depreciation-start-date"
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "accounting")}>
                  <Trans>Register</Trans>
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

export default FixedAssetRegisterForm;
