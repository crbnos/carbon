// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { DatePicker, Hidden, Input, Submit } from "~/components/Form";
import { projectMilestoneValidator } from "../../projects.models";

type MilestoneFormProps = {
  action: string;
  initialValues: z.infer<typeof projectMilestoneValidator>;
  onClose: () => void;
};

/** Creates or edits a milestone in a drawer. It stays open on a refusal. */
const MilestoneForm = ({
  action,
  initialValues,
  onClose
}: MilestoneFormProps) => {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });
  const isEditing = initialValues.id !== undefined;

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
            validator={projectMilestoneValidator}
            method="post"
            action={action}
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Milestone` : t`New Milestone`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="intent" value="upsert" />
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} autoFocus />
                <DatePicker name="startDate" label={t`Start Date`} />
                <DatePicker name="endDate" label={t`End Date`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit>
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

export default MilestoneForm;
