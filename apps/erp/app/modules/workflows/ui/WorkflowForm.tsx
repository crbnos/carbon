import { ValidatedForm } from "@carbon/form";
import {
  Button,
  copyToClipboard,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCopy } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { workflowValidator } from "../workflows.models";
import { workflowValidator as validatorSchema } from "../workflows.models";

type CreatedWorkflow = { id: string; webhookSecret: string };

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
  const fetcher = useFetcher<CreatedWorkflow | { success: false }>();
  const [dismissedSecret, setDismissedSecret] = useState(false);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "workflows")
    : !permissions.can("create", "workflows");

  const created =
    !dismissedSecret && fetcher.data && "webhookSecret" in fetcher.data
      ? fetcher.data
      : null;

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose?.();
        }}
      >
        <ModalDrawerContent>
          {created ? (
            <>
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  <Trans>Workflow created</Trans>
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>
                <VStack spacing={2}>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Copy this webhook secret now — it is the only time it is
                      shown. You need it to verify signed webhook calls this
                      workflow sends.
                    </Trans>
                  </p>
                  <HStack className="w-full">
                    <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                      {created.webhookSecret}
                    </code>
                    <Button
                      variant="secondary"
                      leftIcon={<LuCopy />}
                      onClick={() => {
                        copyToClipboard(created.webhookSecret);
                        toast.success(t`Copied webhook secret`);
                      }}
                    >
                      <Trans>Copy</Trans>
                    </Button>
                  </HStack>
                </VStack>
              </ModalDrawerBody>
              <ModalDrawerFooter>
                <Button
                  size="md"
                  onClick={() => {
                    setDismissedSecret(true);
                    navigate(path.to.workflow(created.id));
                  }}
                >
                  <Trans>Open workflow</Trans>
                </Button>
              </ModalDrawerFooter>
            </>
          ) : (
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
                  <Submit isDisabled={isDisabled}>
                    <Trans>Save</Trans>
                  </Submit>
                  <Button size="md" variant="solid" onClick={() => onClose()}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalDrawerFooter>
            </ValidatedForm>
          )}
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default WorkflowForm;
