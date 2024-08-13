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
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher } from "@remix-run/react";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  PhoneInput,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { customerContactValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type CustomerContactFormProps = {
  customerId: string;
  initialValues: z.infer<typeof customerContactValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CustomerContactForm = ({
  customerId,
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: CustomerContactFormProps) => {
  const fetcher = useFetcher<{}>();

  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={customerContactValidator}
          method="post"
          action={
            isEditing
              ? path.to.customerContact(customerId, initialValues.id!)
              : path.to.newCustomerContact(customerId)
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
          onSubmit={() => {
            if (type === "modal") {
              onClose?.();
            }
          }}
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Contact</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="type" value={type} />
            <Hidden name="contactId" />
            <VStack spacing={4}>
              <Input name="firstName" label="First Name" />
              <Input name="lastName" label="Last Name" />
              <Input name="email" label="Email" />
              <Input name="title" label="Title" />
              <PhoneInput name="mobilePhone" label="Mobile Phone" />
              <PhoneInput name="homePhone" label="Home Phone" />
              <PhoneInput name="workPhone" label="Work Phone" />
              <PhoneInput name="fax" label="Fax" />
              <TextArea name="notes" label="Notes" />
              <CustomFormFields table="customerContact" />
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

export default CustomerContactForm;
