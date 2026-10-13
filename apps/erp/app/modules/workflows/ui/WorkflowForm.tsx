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
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { workflowValidator } from "../workflows.models";
import { workflowValidator as validatorSchema } from "../workflows.models";

type WorkflowFormProps = {
  initialValues: z.infer<typeof workflowValidator>;
  open?: boolean;
  onClose: () => void;
};

const WorkflowForm = ({
  initialValues,
  open = true,
  onClose
}: WorkflowFormProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const fetcher = useAction<{ id: string } | { success: false }>({
    onSettled: (data) => {
      if (data && "id" in data) {
        navigate(path.to.workflow(data.id));
      }
    }
  });

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "workflows")
    : !permissions.can("create", "workflows");

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            key={isEditing ? `edit-${initialValues.id}` : "new"}
            validator={validatorSchema}
            method="post"
            action={
              isEditing
                ? path.to.workflowRename(initialValues.id!)
                : path.to.workflowNew
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Rename Workflow` : t`New Workflow`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Input name="description" label={t`Description`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                {/* Saving navigates to the new workflow's builder, and the form is
                    still mounted and dirty at that moment — the default blocker
                    reads that as leaving with unsaved work. */}
                <Submit isDisabled={isDisabled} withBlocker={false}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
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

export default WorkflowForm;
