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
import { Submit, TextArea } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { fixedAssetOutOfServiceValidator } from "../../accounting.models";

type FixedAssetOutOfServiceFormProps = {
  onClose: () => void;
};

const FixedAssetOutOfServiceForm = ({
  onClose
}: FixedAssetOutOfServiceFormProps) => {
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
            validator={fixedAssetOutOfServiceValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={{ reason: "" }}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Take Out of Service</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The unit is removed from availability until it is returned
                    to service. Depreciation continues and its accounting is
                    unchanged.
                  </Trans>
                </p>
                <TextArea name="reason" label={t`Reason`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "accounting")}>
                  <Trans>Take Out of Service</Trans>
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

export default FixedAssetOutOfServiceForm;
