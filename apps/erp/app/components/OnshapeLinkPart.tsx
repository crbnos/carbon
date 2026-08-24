import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";
import type { action as linkAction } from "~/routes/api+/integrations.onshape.link";
import { path } from "~/utils/path";
import type { OnshapeSelection } from "./OnshapeRevisionPicker";
import { OnshapeRevisionPicker } from "./OnshapeRevisionPicker";

/**
 * Link an existing Carbon item to an Onshape part.
 *
 * Two jobs at once: adopting hand-built items, and migrating items the LEGACY
 * integration matched by part number — those carry no mapping at all, so the v2
 * pipeline cannot see them until someone links them here.
 *
 * Destructive by consent on the fields Onshape owns, so the confirm step spells
 * out what is replaced and what is kept before anything is written.
 */
export const OnshapeLinkPart = ({
  itemId,
  readableIdWithRevision,
  isOpen,
  onClose
}: {
  itemId: string;
  readableIdWithRevision: string;
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof linkAction>();
  const revalidator = useRevalidator();
  const [selection, setSelection] = useState<OnshapeSelection | null>(null);

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.success) {
      toast.success(fetcher.data.message ?? t`Linked to Onshape`);
      // A part-number mismatch is legal once the mapping exists — the number is
      // a label, not the join — but saying nothing would let someone discover
      // it much later and assume something went wrong.
      if (fetcher.data.numberMismatch) {
        toast.info(
          t`Carbon keeps its own number (${fetcher.data.carbonId}); Onshape calls it ${fetcher.data.onshapePartNumber}. They no longer have to match.`
        );
      }
      setSelection(null);
      onClose();
      revalidator.revalidate();
    } else {
      toast.error(fetcher.data.message ?? t`Could not link this item`);
    }
  }, [fetcher.state, fetcher.data, onClose, revalidator, t]);

  if (selection) {
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setSelection(null);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Link {readableIdWithRevision} to Onshape</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                From now on Carbon follows this Onshape part by a hidden id
                rather than by its number.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <div className="w-full rounded-md border p-3 text-sm">
                <div className="font-medium">
                  {selection.partNumber} {selection.revision}
                </div>
                {selection.name && (
                  <div className="text-muted-foreground">{selection.name}</div>
                )}
              </div>

              <div className="flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <LuTriangleAlert className="mt-0.5 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">
                    <Trans>Onshape will overwrite what it owns</Trans>
                  </p>
                  <p className="text-muted-foreground">
                    <Trans>
                      The item's name is replaced now, and its bill of materials
                      is replaced on the next import. Everything Onshape does
                      not have is kept: routing and operations, costing,
                      planning, tracking type, unit of measure, supplier parts,
                      posting groups and tags.
                    </Trans>
                  </p>
                </div>
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                variant="secondary"
                isDisabled={isSubmitting}
                onClick={() => setSelection(null)}
              >
                <Trans>Back</Trans>
              </Button>
              <Button
                isLoading={isSubmitting}
                isDisabled={isSubmitting}
                onClick={() => {
                  const formData = new FormData();
                  formData.append("itemId", itemId);
                  formData.append("partNumber", selection.partNumber);
                  formData.append("revision", selection.revision);
                  formData.append("elementType", String(selection.elementType));
                  formData.append("documentId", selection.documentId);
                  formData.append("versionId", selection.versionId);
                  formData.append("elementId", selection.elementId);
                  if (selection.partId) {
                    formData.append("partId", selection.partId);
                  }
                  if (selection.revisionId) {
                    formData.append("revisionId", selection.revisionId);
                  }
                  // zfd.checkbox() reads presence, so the value is irrelevant —
                  // what matters is that the server never links without it.
                  formData.append("confirmOverwrite", "on");

                  fetcher.submit(formData, {
                    method: "post",
                    action: path.to.api.onShapeLink
                  });
                }}
              >
                <Trans>Link to Onshape</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }

  return (
    <OnshapeRevisionPicker
      isOpen={isOpen}
      onClose={onClose}
      title={t`Link ${readableIdWithRevision} to Onshape`}
      description={t`Pick the Onshape revision this part corresponds to. Already-linked parts are shown so you can see what is taken.`}
      confirmLabel={t`Continue`}
      onSelect={(revision) => setSelection(revision)}
    />
  );
};

export default OnshapeLinkPart;
