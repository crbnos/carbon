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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { Boolean, EmojiPicker, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";

import { path } from "~/utils/path";
import { attributeCategoryValidator } from "../../people.models";

type AttributeCategoryFormProps = {
  initialValues: z.infer<typeof attributeCategoryValidator>;
  onClose: () => void;
};

const AttributeCategoryForm = ({
  initialValues,
  onClose
}: AttributeCategoryFormProps) => {
  const { t } = useLingui();
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
              {isEditing ? (
                <Trans>Edit Attribute Category</Trans>
              ) : (
                <Trans>New Attribute Category</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <EmojiPicker name="emoji" />

              <Input name="name" label={t`Category Name`} />

              <Boolean
                name="isPublic"
                label={t`Public`}
                termId="attribute-category-public"
                description={t`Visible on a user's public profile`}
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default AttributeCategoryForm;
