import { ValidatedForm } from "@carbon/form";
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
import { useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";
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
  const fetcher = useFetcher<{ id: string } | { success: false }>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "workflows")
    : !permissions.can("create", "workflows");

  useEffect(() => {
    if (fetcher.data && "id" in fetcher.data) {
      navigate(path.to.workflow(fetcher.data.id));
    }
  }, [fetcher.data, navigate]);

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
