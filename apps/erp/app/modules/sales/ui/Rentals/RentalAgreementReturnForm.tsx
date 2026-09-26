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
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  DatePicker,
  Hidden,
  Input,
  Number,
  Radios,
  Submit,
  TextArea
} from "~/components/Form";
import { useDateFormatter, usePermissions } from "~/hooks";
import { rentalAgreementReturnValidator } from "../../sales.models";

type RentalAgreementReturnFormProps = {
  initialValues: z.infer<typeof rentalAgreementReturnValidator>;
  unitLabel: string;
  /** A Sales-Type unit carries a net investment that must land somewhere. */
  isSalesType?: boolean;
  /** The agreement's end date — a sales-type unit comes back on or after it. */
  endDate?: string | null;
  onClose: () => void;
};

const RentalAgreementReturnForm = ({
  initialValues,
  unitLabel,
  isSalesType = false,
  endDate,
  onClose
}: RentalAgreementReturnFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const [takeOutOfService, setTakeOutOfService] = useState(
    initialValues.takeOutOfService
  );

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
            validator={rentalAgreementReturnValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Return {unitLabel}</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="rentalAgreementLineId" />
              {/* A checkbox field: absent means false. An empty value fails
                  zfd.checkbox({ trueValue: "true" }) and the form never posts. */}
              {isSalesType && <Hidden name="isSalesType" value="true" />}
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The final billing period is re-cut to the return date. A
                    period already billed in advance gets an adjustment for the
                    unused days.
                  </Trans>
                </p>
                {isSalesType && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        This is a sales-type lease. The closing net investment
                        comes back onto the balance sheet with the unit, and the
                        unposted interest schedule is removed.
                      </Trans>
                    </p>
                    {endDate && (
                      <p className="text-sm text-muted-foreground">
                        <Trans>
                          The unit can be returned on or after the end date,{" "}
                          {formatDate(endDate)}. Early termination of a
                          sales-type lease is a manual journal.
                        </Trans>
                      </p>
                    )}
                    <Radios
                      name="residualDestination"
                      label={t`Return To`}
                      options={[
                        {
                          value: "Fleet",
                          label: t`Rental fleet, as a new fleet asset`
                        },
                        {
                          value: "Inventory",
                          label: t`Inventory, as finished goods`
                        }
                      ]}
                    />
                  </>
                )}
                <DatePicker name="returnedAt" label={t`Return Date`} />
                <Number
                  name="meterIn"
                  label={t`Meter Reading`}
                  minValue={0}
                  step={INPUT_STEP.quantity}
                  formatOptions={INPUT_FORMAT.quantity}
                />
                <TextArea name="returnNotes" label={t`Return Notes`} />
                <Boolean
                  name="takeOutOfService"
                  label={t`Take out of service`}
                  description={t`The unit goes to maintenance instead of back to available.`}
                  onChange={setTakeOutOfService}
                />
                {takeOutOfService && (
                  <Input
                    name="outOfServiceReason"
                    label={t`Out of Service Reason`}
                  />
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "sales")}>
                  <Trans>Return Unit</Trans>
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

export default RentalAgreementReturnForm;
