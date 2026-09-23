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
import { useFetcher } from "react-router";
import { Combobox, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { fixedAssetAttachJobValidator } from "../../accounting.models";

type FixedAssetAttachJobFormProps = {
  jobs: { value: string; label: string; helper?: string }[];
  onClose: () => void;
};

const FixedAssetAttachJobForm = ({
  jobs,
  onClose
}: FixedAssetAttachJobFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={fixedAssetAttachJobValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={{ jobId: "" }}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Attach Job</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The job's work-in-progress balance moves to this asset now,
                    and completing the job sweeps the rest. Only open jobs that
                    are not linked to a sales order or another asset are listed.
                  </Trans>
                </p>
                <Combobox name="jobId" label={t`Job`} options={jobs} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("create", "accounting")}>
                  <Trans>Attach</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
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

export default FixedAssetAttachJobForm;
