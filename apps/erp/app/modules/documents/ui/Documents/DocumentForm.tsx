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
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Submit, TextArea, Users } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { documentValidator } from "~/modules/documents";
import { path } from "~/utils/path";

type DocumentFormProps = {
  initialValues: z.infer<typeof documentValidator>;
  ownerId: string;
};

const DocumentForm = ({ initialValues, ownerId }: DocumentFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isDisabled = !permissions.can("update", "documents");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={documentValidator}
          method="post"
          action={path.to.document(initialValues.id)}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{`${initialValues.name}.${initialValues.extension}`}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="extension" />
            <Hidden name="type" />
            <Hidden name="size" />
            <VStack spacing={4}>
              <Input
                name="name"
                label={t`Name`}
                suffix={`.${initialValues.extension}`}
              />
              <TextArea name="description" label={t`Description`} />
              <Users
                alwaysSelected={[ownerId]}
                name="readGroups"
                label={t`View Permissions`}
                termId="document-view-permissions"
              />
              <Users
                alwaysSelected={[ownerId]}
                name="writeGroups"
                label={t`Edit Permissions`}
                termId="document-edit-permissions"
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

export default DocumentForm;
