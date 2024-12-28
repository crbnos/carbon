import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  PhoneInput,
  Submit,
  SupplierLocation,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { supplierContactValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierContactFormProps = {
  supplierId: string;
  initialValues: z.infer<typeof supplierContactValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const SupplierContactForm = ({
  supplierId,
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: SupplierContactFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created supplier contact`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create supplier contact: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={supplierContactValidator}
          method="post"
          action={
            isEditing
              ? path.to.supplierContact(supplierId, initialValues.id!)
              : path.to.newSupplierContact(supplierId)
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Contact</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="type" value={type} />
            <Hidden name="contactId" />
            <VStack spacing={4}>
              <Input name="email" label="Email" />
              <Input name="firstName" label="First Name" />
              <Input name="lastName" label="Last Name" />
              <Input name="title" label="Title" />
              <PhoneInput name="mobilePhone" label="Mobile Phone" />
              <PhoneInput name="homePhone" label="Home Phone" />
              <PhoneInput name="workPhone" label="Work Phone" />
              <PhoneInput name="fax" label="Fax" />
              <SupplierLocation
                name="supplierLocationId"
                label="Location"
                supplier={supplierId}
              />
              <TextArea name="notes" label="Notes" />
              <CustomFormFields table="supplierContact" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default SupplierContactForm;
