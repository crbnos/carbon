import { Select, ValidatedForm } from "@carbon/form";
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
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { DatePicker, Hidden, Submit, Users } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { liveTracks } from "../../../learn";
import { learnAssignmentValidator } from "../../../resources.models";

type LearnAssignmentFormProps = {
  initialValues: z.infer<typeof learnAssignmentValidator>;
  onClose: () => void;
};

const LearnAssignmentForm = ({
  initialValues,
  onClose
}: LearnAssignmentFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            method="post"
            validator={learnAssignmentValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
            action={
              isEditing
                ? path.to.learnAssignment(initialValues.id!)
                : path.to.newLearnAssignment
            }
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit assignment` : t`Assign a track`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Select
                  name="trackSlug"
                  label={t`Track`}
                  isReadOnly={isEditing}
                  options={liveTracks().map((track) => ({
                    label: track.title,
                    value: track.slug
                  }))}
                />
                <Users
                  name="groupIds"
                  label={t`Assign to groups`}
                  type="employee"
                  helperText={t`Everyone in these groups will see the track on their Learn hub`}
                />
                <DatePicker
                  name="dueDate"
                  label={t`Due date`}
                  helperText={t`Optional. After this date an unfinished track reads as overdue.`}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>{t`Save`}</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default LearnAssignmentForm;
