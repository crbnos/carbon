import { ValidatedForm } from "@carbon/form";
import {
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Ability, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { trainingValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type TrainingFormProps = {
  initialValues: z.infer<typeof trainingValidator>;
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const TrainingForm = ({
  initialValues,
  open = true,
  onClose
}: TrainingFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={trainingValidator}
            method="post"
            action={
              isEditing
                ? path.to.training(initialValues.id!)
                : path.to.newTraining
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Training</Trans>
                ) : (
                  <Trans>New Training</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Ability
                  name="grantsAbilityId"
                  label={t`Grants Ability`}
                  isClearable
                  helperText={t`Completing this training grants or renews the selected ability.`}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle" || isDisabled}
                >
                  <Trans>Save</Trans>
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default TrainingForm;
