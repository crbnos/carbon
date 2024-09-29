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
  VStack,
  toast,
} from "@carbon/react";

import { ValidatedForm } from "@carbon/form";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import Country from "~/components/Form/Country";
import { usePermissions } from "~/hooks";
import { supplierLocationValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierLocationFormProps = {
  supplierId: string;
  initialValues: z.infer<typeof supplierLocationValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const SupplierLocationForm = ({
  supplierId,
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: SupplierLocationFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created supplier location`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create supplier location: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

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
            validator={supplierLocationValidator}
            method="post"
            action={
              isEditing
                ? path.to.supplierLocation(supplierId, initialValues.id!)
                : path.to.newSupplierLocation(supplierId)
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Location
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <Hidden name="addressId" />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Input name="addressLine1" label="Address Line 1" />
                <Input name="addressLine2" label="Address Line 2" />
                <Input name="city" label="City" />
                <Input name="state" label="State" />
                <Input name="postalCode" label="Postal Code" />
                <Country />
                <CustomFormFields table="supplierLocation" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
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

export default SupplierLocationForm;
