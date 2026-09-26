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
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { DatePicker, Input, Number, Select, Submit } from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { rentalAgreementChargeValidator } from "../../sales.models";

type RentalAgreementChargeFormProps = {
  initialValues: z.infer<typeof rentalAgreementChargeValidator>;
  currencyCode: string;
  /** The agreement's lines — a charge belongs to one fleet unit. */
  lineOptions: { value: string; label: string }[];
  onClose: () => void;
};

const RentalAgreementChargeForm = ({
  initialValues,
  currencyCode,
  lineOptions,
  onClose
}: RentalAgreementChargeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={rentalAgreementChargeValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Add Charge</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    A variable charge — mileage overage, damage, delivery,
                    cleaning — is billed on the agreement's next invoice.
                  </Trans>
                </p>
                <Select
                  name="rentalAgreementLineId"
                  label={t`Unit`}
                  options={lineOptions}
                />
                <DatePicker name="chargeDate" label={t`Charge Date`} />
                <Input name="description" label={t`Description`} />
                <Number
                  name="amount"
                  label={t`Amount`}
                  step={INPUT_STEP.money(currencyDecimals)}
                  formatOptions={INPUT_FORMAT.money(
                    currencyCode,
                    currencyDecimals
                  )}
                />
                <Number
                  name="taxPercent"
                  label={t`Tax Percent`}
                  minValue={0}
                  maxValue={1}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percent}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("create", "sales")}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
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

export default RentalAgreementChargeForm;
