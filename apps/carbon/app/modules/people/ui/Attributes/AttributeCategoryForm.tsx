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
import type { z } from "zod";
import { Boolean, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";

import { path } from "~/utils/path";
import { attributeCategoryValidator } from "../../people.models";

type AttributeCategoryFormProps = {
  initialValues: z.infer<typeof attributeCategoryValidator>;
  onClose: () => void;
};

const AttributeCategoryForm = ({
  initialValues,
  onClose,
}: AttributeCategoryFormProps) => {
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "people")
    : !permissions.can("create", "people");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={attributeCategoryValidator}
          method="post"
          action={
            isEditing
              ? path.to.attributeCategory(initialValues.id!)
              : path.to.newAttributeCategory
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit" : "New"} Attribute Category
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label="Category Name" />
              <Boolean
                name="isPublic"
                label="Public"
                description="Visible on a user's public profile"
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

export default AttributeCategoryForm;
