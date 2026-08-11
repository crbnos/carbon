import { Boolean, TextArea, ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { scrapTrackedEntityValidator } from "~/services/models";
import { path } from "~/utils/path";
import ScrapReason from "./ScrapReason";

// Scrap an already-made / issued BOM entity from the Materials section (both
// the operation and assembly views share this). Pull-from-inventory parts are
// scrapped from stock (requirement stays open for a replacement pull);
// Make-to-Order subassemblies flip to Scrapped and — when makeReplacement is
// checked — reopen their routing and spawn a replacement unit.
export function ScrapEntityModal({
  materialId,
  trackedEntityId,
  readableId,
  parentId,
  isMakeToOrder,
  onClose
}: {
  materialId: string;
  trackedEntityId: string;
  readableId?: string | null;
  parentId?: string;
  isMakeToOrder: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          action={path.to.scrapEntity(materialId, trackedEntityId, parentId)}
          method="post"
          validator={scrapTrackedEntityValidator}
          defaultValues={{
            scrapReasonId: "",
            makeReplacement: isMakeToOrder,
            notes: ""
          }}
          fetcher={fetcher}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {readableId ? (
                <Trans>Scrap {readableId}</Trans>
              ) : (
                <Trans>Scrap material</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              {isMakeToOrder ? (
                <Trans>
                  This part was made to order. Scrapping it can reopen its
                  routing to make a replacement.
                </Trans>
              ) : (
                <Trans>
                  This part will be scrapped from stock. Its requirement stays
                  open so you can issue a replacement.
                </Trans>
              )}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <ScrapReason
                name="scrapReasonId"
                label={t`Scrap Reason`}
                size="lg"
              />
              {isMakeToOrder && (
                <Boolean
                  name="makeReplacement"
                  label={t`Make a replacement`}
                  description={t`Reopen the subassembly and create a replacement unit`}
                  bordered
                />
              )}
              <TextArea label={t`Notes`} name="notes" size="lg" />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="lg" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="destructive"
              size="lg"
              type="submit"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              <Trans>Scrap</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
