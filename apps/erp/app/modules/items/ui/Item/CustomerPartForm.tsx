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
import { useNavigate, useParams } from "react-router";
import type { z } from "zod";
import { Customer, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerPartValidator } from "../../items.models";

type CustomerPartFormProps = {
  initialValues: z.infer<typeof customerPartValidator> & {
    readableId: string;
  };
};

const CustomerPartForm = ({ initialValues }: CustomerPartFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { t } = useLingui();
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
              {isEditing ? t`Edit Customer Part` : t`New Customer Part`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="itemId" />

            <VStack spacing={4}>
              <Input name="readableId" label={t`Part ID`} isDisabled />
              <Customer name="customerId" label={t`Customer`} />
              <Input
                name="customerPartId"
                label={t`Customer Part ID`}
                termId="customer-part-id"
              />
              <Input
                name="customerPartRevision"
                label={t`Customer Part Revision`}
                termId="customer-part-revision"
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

export default CustomerPartForm;
