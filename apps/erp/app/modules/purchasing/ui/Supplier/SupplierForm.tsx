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
import { useEffect, useRef } from "react";
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
import { upsertIntoListStore, useSuppliers } from "~/stores";
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
  const [, setSuppliers] = useSuppliers();
  // Appending to the store below re-renders the parent, which changes the inline
  // `onClose` identity and re-runs this effect. Guard so the success side-effects
  // (store append + `onClose`, which reopens the combobox) run exactly once —
  // otherwise `onClose`'s trigger.click() fires twice and toggles the dropdown shut.
  const handledSuccessRef = useRef(false);

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      if (handledSuccessRef.current) return;
      handledSuccessRef.current = true;
      // Add the new supplier to the store immediately rather than waiting for
      // the Supabase Realtime INSERT event to arrive — the realtime round-trip
      // is best-effort and can be missed, which would leave the just-created
      // supplier absent from the select's option list. Dedupe by id so a late
      // realtime event doesn't double-add it.
      // `.single()` returns one row at runtime; the fetcher generic annotates
      // `data` as the view type, so cast through `unknown` to the inserted shape.
      const created = fetcher.data.data as unknown as {
        id: string;
        name: string;
        website?: string | null;
        supplierStatus?: string | null;
        readableId?: string | null;
      };
      setSuppliers((prev) =>
        upsertIntoListStore(prev, {
          id: created.id,
          name: created.name,
          website: created.website ?? undefined,
          supplierStatus: created.supplierStatus ?? undefined,
          readableId: created.readableId ?? undefined
        })
      );
      onClose?.();
      toast.success(t`Created supplier: ${created.name}`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create supplier: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, t, type, setSuppliers]);

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
                    termId="supplier-status"
                  />
                  <SupplierType
                    name="supplierTypeId"
                    label={t`Supplier Type`}
                    placeholder={t`Select Supplier Type`}
                    termId="supplier-type-field"
                  />
                  <Employee
                    name="accountManagerId"
                    label={t`Account Manager`}
                    termId="supplier-account-manager"
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
