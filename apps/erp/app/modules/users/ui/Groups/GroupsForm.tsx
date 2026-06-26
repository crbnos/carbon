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
import { Hidden, Input, Submit, Users } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { groupValidator } from "~/modules/users";
import { path } from "~/utils/path";

type GroupFormProps = {
  initialValues: z.infer<typeof groupValidator>;
};

const GroupForm = ({ initialValues }: GroupFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isEditing = !!initialValues.id;

  const isDisabled = isEditing
    ? !permissions.can("update", "users")
    : !permissions.can("create", "users");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={groupValidator}
          method="post"
          action={
            isEditing ? path.to.group(initialValues.id) : path.to.newGroup
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? <Trans>Edit Group</Trans> : <Trans>New Group</Trans>}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label={t`Group Name`} />
              <Users
                name="selections"
                selectionsMaxHeight={"calc(100vh - 330px)"}
                label={t`Group Members`}
                termId="group-members"
                verbose
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

export default GroupForm;
