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
import { useFetcher } from "react-router";
import { DatePicker, Number, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { fixedAssetRegisterValidator } from "../../accounting.models";

type FixedAssetRegisterFormProps = {
  onClose: () => void;
};

const FixedAssetRegisterForm = ({ onClose }: FixedAssetRegisterFormProps) => {
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
              <ModalDrawerTitle>Register Existing Asset</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Number
                  name="acquisitionCost"
                  label="Acquisition Cost"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <DatePicker name="acquisitionDate" label="Acquisition Date" />
                <Number
                  name="accumulatedDepreciation"
                  label="Accumulated Depreciation"
                  termId="depreciation"
                  minValue={0}
                  formatOptions={{
                    style: "currency",
                    currency: company?.baseCurrencyCode ?? "USD"
                  }}
                />
                <DatePicker
                  name="depreciationStartDate"
                  label="Depreciation Start Date"
                  termId="depreciation"
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "accounting")}>
                  Register
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
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
