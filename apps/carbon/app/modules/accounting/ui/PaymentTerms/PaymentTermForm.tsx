import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Number,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { PaymentTermCalculationMethod } from "~/modules/accounting";
import {
  paymentTermValidator,
  paymentTermsCalculationMethod,
} from "~/modules/accounting";
import { path } from "~/utils/path";

type PaymentTermFormProps = {
  initialValues: z.infer<typeof paymentTermValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose?: (data?: { id: string; name: string }) => void;
};

const PaymentTermForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: PaymentTermFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const [selectedCalculationMethod, setSelectedCalculationMethod] =
    useState<PaymentTermCalculationMethod>(initialValues.calculationMethod);

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created payment term`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create payment term: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const calculationMethodOptions = paymentTermsCalculationMethod.map((v) => ({
    label: v,
    value: v,
  }));

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={paymentTermValidator}
            method="post"
            action={
              isEditing
                ? path.to.paymentTerm(initialValues.id!)
                : path.to.newPaymentTerm
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Payment Term
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Select
                  name="calculationMethod"
                  label="After"
                  options={calculationMethodOptions}
                  onChange={(value) => {
                    setSelectedCalculationMethod(
                      value?.value as PaymentTermCalculationMethod
                    );
                  }}
                />
                <Number
                  name="daysDue"
                  label={`Due Days after ${selectedCalculationMethod}`}
                  minValue={0}
                  helperText="The amount of days after the calculation method that the payment is due"
                />
                <Number
                  name="daysDiscount"
                  label={`Discount Days after ${selectedCalculationMethod}`}
                  minValue={0}
                  helperText="The amount of days after the calculation method that the cash discount is available"
                />
                <Number
                  name="discountPercentage"
                  label="Discount Percent"
                  minValue={0}
                  maxValue={100}
                  helperText="The percentage of the cash discount. Use 0 for no discount."
                />
                <CustomFormFields table="paymentTerm" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default PaymentTermForm;
