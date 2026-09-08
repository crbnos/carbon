import { getDocumentLabel } from "@carbon/documents/template";
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
import { Hidden, Input, MultiSelect, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { termsDocumentTypes, termsVersionValidator } from "~/modules/settings";
import { path } from "~/utils/path";

type TermsVersionFormProps = {
  initialValues: z.infer<typeof termsVersionValidator>;
};

/**
 * Creates the version, then hands off to the full-screen editor where the body,
 * scope and dates are edited — the same shape as a new procedure.
 */
const TermsVersionForm = ({ initialValues }: TermsVersionFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.termsVersions);

  const documentTypeOptions = termsDocumentTypes.map((type) => ({
    value: type,
    label: getDocumentLabel(type)
  }));

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={termsVersionValidator}
          method="post"
          action={path.to.newTermsVersion}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              <Trans>New Terms Version</Trans>
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="scope" />
            <Hidden name="content" />
            <VStack spacing={4}>
              <Input name="name" label={t`Name`} />
              <MultiSelect
                name="documentTypes"
                label={t`Documents`}
                options={documentTypeOptions}
                helperText={t`The documents this version prints on.`}
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={!permissions.can("create", "settings")}>
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

export default TermsVersionForm;
