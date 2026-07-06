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
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  SequenceOrCustomId,
  Submit,
  SupplierContact,
  SupplierStatus,
  SupplierType
} from "~/components/Form";
import {
  useCompanySettings,
  usePermissions,
  useSupplierApprovalRequired
} from "~/hooks";
import type { Supplier } from "~/modules/purchasing";
import {
  supplierApprovalValidator,
  supplierValidator
} from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierFormProps = {
  initialValues: z.infer<typeof supplierValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const SupplierForm = ({
  initialValues,
  type = "card",
  onClose
}: SupplierFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const companySettings = useCompanySettings();
  const showSupplierReadableId =
    companySettings?.showSupplierReadableId ?? false;
  const fetcher = useFetcher<PostgrestResponse<Supplier>>();
  const supplierApprovalRequired = useSupplierApprovalRequired();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      // @ts-ignore
      toast.success(t`Created supplier: ${fetcher.data.data.name}`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create supplier: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  return (
    <div>
      <ModalCardProvider type={type}>
        <ModalCard onClose={onClose}>
          <ModalCardContent size="medium">
            <ValidatedForm
              key={initialValues.supplierStatus}
              method="post"
              action={isEditing ? undefined : path.to.newSupplier}
              validator={
                supplierApprovalRequired
                  ? supplierApprovalValidator
                  : supplierValidator
              }
              defaultValues={initialValues}
              fetcher={fetcher}
            >
              <ModalCardHeader>
                <ModalCardTitle>
                  {isEditing ? (
                    <Trans>Supplier Overview</Trans>
                  ) : (
                    <Trans>New Supplier</Trans>
                  )}
                </ModalCardTitle>
                {!isEditing && (
                  <ModalCardDescription>
                    <Trans>
                      {" "}
                      A supplier is a business or person who sells you parts or
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
                  {showSupplierReadableId &&
                    (isEditing ? (
                      <Input
                        name="readableId"
                        label={t`Supplier ID`}
                        isReadOnly
                        helperText={t`Supplier ID cannot be changed after creation`}
                      />
                    ) : (
                      <SequenceOrCustomId
                        name="readableId"
                        label={t`Supplier ID`}
                        table="supplier"
                      />
                    ))}
                  <Input autoFocus={!isEditing} name="name" label={t`Name`} />
                  <SupplierStatus
                    name="supplierStatus"
                    label={t`Supplier Status`}
                    placeholder={t`Select Supplier Status`}
                    disabled={supplierApprovalRequired}
                  />
                  <SupplierType
                    name="supplierTypeId"
                    label={t`Supplier Type`}
                    placeholder={t`Select Supplier Type`}
                  />
                  <Employee
                    name="accountManagerId"
                    label={t`Account Manager`}
                  />
                  {isEditing && (
                    <>
                      <SupplierContact
                        supplier={initialValues.id}
                        name="purchasingContactId"
                        label={t`Purchasing Contact`}
                      />
                    </>
                  )}
                  <Currency name="currencyCode" label={t`Currency`} />
                  <Input name="website" label={t`Website`} />

                  {/* <EmailRecipients name="defaultCc" label={t`Default CC`} /> */}
                  <CustomFormFields table="supplier" />
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

export default SupplierForm;
