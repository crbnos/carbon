// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { scrapTrackedEntityValidator } from "~/services/models";
import { path } from "~/utils/path";
import { ScrapApprovalStep, useScrapApproval } from "./ScrapApproval";
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
  open = true,
  onClose
}: {
  materialId: string;
  trackedEntityId: string;
  readableId?: string | null;
  parentId?: string;
  isMakeToOrder: boolean;
  open?: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const submitted = useRef(false);
  // A scrap approval rule answers the first submit with the approvers; the
  // modal stays open for the approver's PIN and the same form is sent again.
  const approval = useScrapApproval();
  const { settle } = approval;
  // Why the last submit was refused; the modal stays open to show it.
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      // Reset, or the next open would close itself: the modal stays mounted.
      submitted.current = false;
      if (settle(fetcher.data)) return;
      if (fetcher.data?.success === false) {
        setFailure(fetcher.data.message);
        return;
      }
      onClose();
    }
  }, [fetcher.state, fetcher.data, settle, onClose]);

  const close = () => {
    setFailure(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) close();
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
            setFailure(null);
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
              <ScrapApprovalStep
                approval={approval}
                isSubmitting={fetcher.state !== "idle"}
              />
              {failure && (
                <p className="text-sm text-destructive w-full">{failure}</p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="lg" onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="destructive"
              size="lg"
              type="submit"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle" || approval.isIncomplete}
            >
              {approval.prompt ? (
                <Trans>Approve and Scrap</Trans>
              ) : (
                <Trans>Scrap</Trans>
              )}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
