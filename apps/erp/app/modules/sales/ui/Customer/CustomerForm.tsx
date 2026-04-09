import { ValidatedForm } from "@carbon/form";
import {
  cn,
  HStack,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Currency,
  CustomerContact,
  CustomerStatus,
  CustomerType,
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  Number,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerValidator } from "../../sales.models";
import type { Customer } from "../../types";

type CustomerFormProps = {
  initialValues: z.infer<typeof customerValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const CustomerForm = ({
  initialValues,
  type = "card",
  onClose
}: CustomerFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<Customer>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      const createdCustomer = Array.isArray(fetcher.data.data)
        ? fetcher.data.data[0]
        : fetcher.data.data;
      toast.success(
        t`Created customer: ${createdCustomer?.name ?? t`Customer`}`
      );
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create customer: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <div>
      <ModalCardProvider type={type}>
        <ModalCard onClose={onClose}>
          <ModalCardContent size="medium">
            <ValidatedForm
              method="post"
              action={isEditing ? undefined : path.to.newCustomer}
              validator={customerValidator}
              defaultValues={initialValues}
              fetcher={fetcher}
            >
              <ModalCardHeader>
                <ModalCardTitle>
                  {isEditing ? (
                    <Trans>Customer Overview</Trans>
                  ) : (
                    <Trans>New Customer</Trans>
                  )}
                </ModalCardTitle>
                {!isEditing && (
                  <ModalCardDescription>
                    <Trans>
                      A customer is a business or person who buys your parts or
                      services.
                    </Trans>
                  </ModalCardDescription>
                )}
              </ModalCardHeader>
              <ModalCardBody>
                <Hidden name="id" />
                <Hidden name="type" value={type} />
                <div
                  className={cn(
                    "grid w-full gap-x-8 gap-y-4",
                    type === "modal"
                      ? "grid-cols-1"
                      : isEditing
                        ? "grid-cols-1 lg:grid-cols-3"
                        : "grid-cols-1 md:grid-cols-2"
                  )}
                >
                  <Input name="name" label={t`Name`} autoFocus={!isEditing} />

                  <CustomerStatus
                    name="customerStatusId"
                    label={t`Customer Status`}
                    placeholder={t`Select Customer Status`}
                  />
                  <CustomerType
                    name="customerTypeId"
                    label={t`Customer Type`}
                    placeholder={t`Select Customer Type`}
                  />
                  <Employee
                    name="accountManagerId"
                    label={t`Account Manager`}
                  />
                  {isEditing && (
                    <>
                      <CustomerContact
                        customer={initialValues.id}
                        name="salesContactId"
                        label={t`Sales Contact`}
                      />
                    </>
                  )}
                  <Currency name="currencyCode" label={t`Currency`} />

                  <Number
                    name="taxPercent"
                    label={t`Tax Percent`}
                    minValue={0}
                    maxValue={1}
                    step={0.0001}
                    formatOptions={{
                      style: "percent",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    }}
                  />

                  <Input name="taxId" label={t`Tax ID`} />
                  <Input name="vatNumber" label={t`VAT Number`} />
                  <Input name="website" label={t`Website`} />

                  {/* <EmailRecipients name="defaultCc" label="Default CC" /> */}
                  <CustomFormFields table="customer" />
                </div>
              </ModalCardBody>
              <ModalCardFooter>
                <HStack>
                  <Submit isDisabled={isDisabled}>
                    <Trans>Save</Trans>
                  </Submit>
                </HStack>
              </ModalCardFooter>
            </ValidatedForm>
          </ModalCardContent>
        </ModalCard>
      </ModalCardProvider>
    </div>
  );
};

export default CustomerForm;
