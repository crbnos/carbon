import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerDescription,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack,
} from "@carbon/react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useEffect } from "react";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { revisionValidator } from "../../items.models";

type RevisionFormProps = {
  initialValues: z.infer<typeof revisionValidator>;
  hasSizesInsteadOfRevisions?: boolean;
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const RevisionForm = ({
  initialValues,
  hasSizesInsteadOfRevisions = false,
  open = true,
  onClose,
}: RevisionFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<
    { success: false; message: string } | { success: true; link: string }
  >();
  const navigate = useNavigate();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
      navigate(fetcher.data.link);
    }
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

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
            validator={revisionValidator}
            method="post"
            action={
              isEditing
                ? path.to.revision(initialValues.id!)
                : path.to.newRevision
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"}{" "}
                {hasSizesInsteadOfRevisions ? "Size" : "Revision"}
              </ModalDrawerTitle>
              {!isEditing && (
                <ModalDrawerDescription>
                  A new {hasSizesInsteadOfRevisions ? "size" : "revision"} will
                  be created using a copy of the current
                  {hasSizesInsteadOfRevisions ? "size" : "revision"}
                </ModalDrawerDescription>
              )}
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" />
              <Hidden name="copyFromId" />

              <VStack spacing={4}>
                <Input
                  name="revision"
                  label={hasSizesInsteadOfRevisions ? "Size" : "Revision"}
                  helperText={
                    hasSizesInsteadOfRevisions
                      ? "The size of the part"
                      : "The revision number of the part"
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
                  Save
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default RevisionForm;
