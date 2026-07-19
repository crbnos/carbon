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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import { Boolean, Hidden, Input, Submit } from "~/components/Form";
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
  onClose
}: RevisionFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<
    | { success: false; message: string }
    | { success: true; link: string; newItemId?: string }
  >();
  const navigate = useNavigate();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const [openChangeOrder, setOpenChangeOrder] = useState(false);
  // Offer the "open a change order" shortcut only when creating a new revision of
  // a make part/tool (CO affected items are Parts/Tools; the CO route coerces
  // Buy items to a Revision change type).
  const canOpenChangeOrder =
    !isEditing &&
    !hasSizesInsteadOfRevisions &&
    (initialValues.type === "Part" || initialValues.type === "Tool");

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    // The "open a change order" path posts straight to the create+attach route
    // (see the form action below), which redirects to the new CO — so it never
    // returns here. This only handles the plain new-revision submit.
    if (fetcher.data?.success) {
      onClose();
      navigate(fetcher.data.link);
    }
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
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
                : openChangeOrder && initialValues.copyFromId
                  ? path.to.newChangeOrderFromItem(initialValues.copyFromId)
                  : path.to.newRevision
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing
                  ? hasSizesInsteadOfRevisions
                    ? t`Edit Size`
                    : t`Edit Revision`
                  : hasSizesInsteadOfRevisions
                    ? t`New Size`
                    : t`New Revision`}
              </ModalDrawerTitle>
              {!isEditing && (
                <ModalDrawerDescription>
                  {hasSizesInsteadOfRevisions
                    ? t`A new size will be created using a copy of the current size`
                    : t`A new revision will be created using a copy of the current revision`}
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
                  label={hasSizesInsteadOfRevisions ? t`Size` : t`Revision`}
                  helperText={
                    hasSizesInsteadOfRevisions
                      ? t`The size of the part`
                      : t`The revision number of the part`
                  }
                />
                {canOpenChangeOrder && (
                  <Boolean
                    name="openChangeOrder"
                    label={t`Open a change order`}
                    description={t`Create a change order for the new revision and open it`}
                    bordered
                    onChange={setOpenChangeOrder}
                  />
                )}
                {openChangeOrder && (
                  <Hidden name="changeType" value="Revision" />
                )}
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

export default RevisionForm;
