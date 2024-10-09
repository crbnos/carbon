import { PhoneInput, ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  cn,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  Submit,
  SupplierStatus,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { Supplier } from "~/modules/purchasing";
import { supplierValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierFormProps = {
  initialValues: z.infer<typeof supplierValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const SupplierForm = ({
  initialValues,
  type = "card",
  onClose,
}: SupplierFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<Supplier>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      // @ts-ignore
      toast.success(`Created supplier: ${fetcher.data.data.name}`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create supplier: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

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
              method="post"
              action={isEditing ? undefined : path.to.newSupplier}
              validator={supplierValidator}
              defaultValues={initialValues}
              fetcher={fetcher}
            >
              <ModalCardHeader>
                <ModalCardTitle>
                  {isEditing ? "Supplier Overview" : "New Supplier"}
                </ModalCardTitle>
                {!isEditing && (
                  <ModalCardDescription>
                    A supplier is a business or person who sells you parts or
                    services.
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
                  <Input autoFocus={!isEditing} name="name" label="Name" />

                  <SupplierStatus
                    name="supplierStatusId"
                    label="Supplier Status"
                    placeholder="Select Supplier Status"
                  />

                  <Employee name="accountManagerId" label="Account Manager" />

                  <Currency name="currencyCode" label="Currency" />

                  <PhoneInput name="phone" label="Phone" />
                  <PhoneInput name="fax" label="Fax" />
                  <Input name="website" label="Website" />

                  <CustomFormFields table="supplier" />
                </div>
              </ModalCardBody>
              <ModalCardFooter>
                <HStack>
                  <Submit isDisabled={isDisabled}>Save</Submit>
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
