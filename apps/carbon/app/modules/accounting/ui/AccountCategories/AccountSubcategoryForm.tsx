import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  FormControl,
  FormLabel,
  HStack,
  Input as InputBase,
  VStack,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import type { AccountCategory } from "~/modules/accounting";
import { accountSubcategoryValidator } from "~/modules/accounting";
import { path } from "~/utils/path";

type AccountSubcategoryFormProps = {
  initialValues: z.infer<typeof accountSubcategoryValidator>;
  onClose: () => void;
};

const AccountSubcategoryForm = ({
  initialValues,
  onClose,
}: AccountSubcategoryFormProps) => {
  const params = useParams();
  const permissions = usePermissions();

  const { categoryId } = params;
  if (!categoryId) throw new Error("categoryId is not found");

  const routeData = useRouteData<{
    accountCategory: AccountCategory;
  }>(path.to.accountingCategoryList(categoryId));

  const category = routeData?.accountCategory.category ?? "";

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DrawerContent>
        <ValidatedForm
          validator={accountSubcategoryValidator}
          method="post"
          action={
            isEditing
              ? path.to.accountingSubcategory(initialValues.id!)
              : path.to.newAccountingSubcategory(categoryId)
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit" : "New"} Account Subcategory
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="accountCategoryId" />
            <VStack>
              <FormControl>
                <FormLabel>Category</FormLabel>
                <InputBase value={category} isReadOnly />
              </FormControl>
              <Input name="name" label="Name" />
              <CustomFormFields table="accountSubcategory" />
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

export default AccountSubcategoryForm;
