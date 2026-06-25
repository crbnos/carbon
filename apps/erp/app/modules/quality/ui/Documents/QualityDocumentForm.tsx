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
import { Hidden, Input, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { qualityDocumentValidator } from "../../quality.models";

type QualityDocumentFormProps = {
  initialValues: z.infer<typeof qualityDocumentValidator>;
  type: "new" | "copy";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const QualityDocumentForm = ({
  initialValues,
  type = "new",
  open = true,
  onClose
}: QualityDocumentFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

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
            validator={qualityDocumentValidator}
            method="post"
            action={
              isEditing
                ? path.to.qualityDocument(initialValues.id!)
                : path.to.newQualityDocument
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {type === "copy" ? (
                  <Trans>Copy Quality Document</Trans>
                ) : (
                  <Trans>New Quality Document</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="copyFromId" />
              {type === "copy" && (
                <>
                  <Hidden name="name" />
                  <Hidden name="content" />
                </>
              )}
              <VStack spacing={4}>
                {type === "new" && <Input name="name" label={t`Name`} />}
                <Number
                  name="version"
                  label={type === "copy" ? t`New Version` : t`Version`}
                  termId="quality-document-version"
                  minValue={0}
                  helperText={
                    type === "copy"
                      ? t`The new version number of the document`
                      : t`The version of the new document`
                  }
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

export default QualityDocumentForm;
