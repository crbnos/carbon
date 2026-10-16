// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Select, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  ChoiceCardGroup,
  FormControl,
  FormLabel,
  HStack,
  LabelWithHelp,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import { Input as FormInput, Hidden, Submit, Users } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { trainingAssignmentValidator } from "~/modules/resources/resources.models";
import type { TrainingListItem } from "~/modules/resources/types";
import { path } from "~/utils/path";

type TrainingAssignmentFormProps = {
  initialValues: z.infer<typeof trainingAssignmentValidator>;
  trainings: TrainingListItem[];
  open?: boolean;
  onClose: () => void;
};

const TrainingAssignmentForm = ({
  initialValues,
  trainings,
  open = true,
  onClose
}: TrainingAssignmentFormProps) => {
  const permissions = usePermissions();
  // A refusal (a training already assigned) is toasted; a save redirects.
  const fetcher = useAction();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            method="post"
            validator={trainingAssignmentValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
            action={
              isEditing
                ? path.to.trainingAssignment(initialValues.id!)
                : path.to.newTrainingAssignment
            }
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Assignment</Trans>
                ) : (
                  <Trans>New Assignment</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody className="w-full">
              <Hidden name="id" />
              <AssignmentFormContent
                trainings={trainings}
                isEditing={isEditing}
                defaultIsExternal={initialValues.isExternal}
              />
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle" || isDisabled}
                >
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

type TrainingSource = "internal" | "external";

function AssignmentFormContent({
  trainings,
  isEditing,
  defaultIsExternal
}: {
  trainings: TrainingListItem[];
  isEditing: boolean;
  defaultIsExternal: boolean;
}) {
  const { t } = useLingui();
  const [source, setSource] = useState<TrainingSource>(
    defaultIsExternal ? "external" : "internal"
  );
  const isExternal = source === "external";

  return (
    <VStack spacing={4}>
      {/* An assignment's source is fixed once it exists. */}
      {!isEditing && (
        <FormControl>
          <FormLabel>
            <LabelWithHelp termId="external-training">
              {t`Training`}
            </LabelWithHelp>
          </FormLabel>
          <ChoiceCardGroup<TrainingSource>
            value={source}
            onChange={setSource}
            options={[
              {
                value: "internal",
                title: t`Internal`,
                description: t`Employees complete a training in Carbon`
              },
              {
                value: "external",
                title: t`External`,
                description: t`Taken outside Carbon. You mark each employee complete.`
              }
            ]}
          />
        </FormControl>
      )}
      {isExternal && <input type="hidden" name="isExternal" value="on" />}
      {isExternal ? (
        <FormInput name="name" label={t`Name`} isRequired />
      ) : (
        <Select
          name="trainingId"
          label={t`Training`}
          isReadOnly={isEditing}
          options={trainings.map((training) => ({
            label: training.name ?? "",
            value: training.id ?? ""
          }))}
        />
      )}
      <Users
        name="groupIds"
        label={t`Assign to Groups`}
        type="employee"
        helperText={t`Select the groups that should complete this training`}
      />
    </VStack>
  );
}

export default TrainingAssignmentForm;
