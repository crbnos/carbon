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
} from "@carbon/react";
import { useNavigate, useParams } from "@remix-run/react";
import type { z } from "zod";
import { Customer, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { customerPartValidator } from "~/modules/items";
import { path } from "~/utils/path";

type CustomerPartFormProps = {
  initialValues: z.infer<typeof customerPartValidator> & {
    readableId: string;
  };
};

const CustomerPartForm = ({ initialValues }: CustomerPartFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const onClose = () => navigate(-1);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          defaultValues={initialValues}
          validator={customerPartValidator}
          method="post"
          action={isEditing ? undefined : path.to.newCustomerPart(itemId)}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit" : "New"} Customer Part
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="itemId" />

            <VStack spacing={4}>
              <Input name="readableId" label="Part ID" isDisabled />
              <Customer name="customerId" label="Customer" />
              <Input name="customerPartId" label="Customer Part ID" />
              <Input
                name="customerPartRevision"
                label="Customer Part Revision"
              />
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

export default CustomerPartForm;
