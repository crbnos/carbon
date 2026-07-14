import {
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  useDisclosure
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuCheck, LuInfo, LuRotateCcw, LuSend } from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";
import { usePermissions } from "~/hooks";
import type {
  InventoryCountLine,
  InventoryCount as InventoryCountType
} from "~/modules/inventory";
import {
  InventoryCountConfirmModal,
  InventoryCountLines,
  InventoryCountStatus
} from "~/modules/inventory";
import { path } from "~/utils/path";

type InventoryCountDetailsProps = {
  inventoryCount: InventoryCountType;
  lines: InventoryCountLine[];
  count: number;
  summary: { uncounted: number; variances: number };
};

const InventoryCountDetails = ({
  inventoryCount,
  lines,
  count,
  summary
}: InventoryCountDetailsProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "inventory");

  const confirmModal = useDisclosure();
  const notesModal = useDisclosure();
  const revalidator = useRevalidator();
  const reopenFetcher = useFetcher();
  const postFetcher = useFetcher();

  const status = inventoryCount.status;
  const isReadOnly = status !== "Draft";

  // Actions live in the table header (the `primaryAction` slot) instead of a
  // dedicated detail header. Notes are surfaced via an info icon → modal.
  const actions = (
    <HStack spacing={2} className="items-center">
      {inventoryCount.notes && (
        <IconButton
          aria-label={t`View notes`}
          variant="ghost"
          icon={<LuInfo />}
          onClick={notesModal.onOpen}
        />
      )}
      {status === "Draft" && (
        <Button
          isDisabled={!canUpdate}
          onClick={() => {
            // Inline edits write directly to the DB without revalidating, so
            // refresh the loader to get accurate warning counts before review.
            revalidator.revalidate();
            confirmModal.onOpen();
          }}
          leftIcon={<LuCheck />}
        >
          {t`Confirm`}
        </Button>
      )}
      {status === "Pending" && (
        <>
          <reopenFetcher.Form
            method="post"
            action={path.to.inventoryCountReopen(inventoryCount.id!)}
          >
            <Button
              type="submit"
              variant="secondary"
              isDisabled={!canUpdate}
              isLoading={reopenFetcher.state !== "idle"}
              leftIcon={<LuRotateCcw />}
            >
              {t`Reopen`}
            </Button>
          </reopenFetcher.Form>
          <postFetcher.Form
            method="post"
            action={path.to.inventoryCountPost(inventoryCount.id!)}
          >
            <Button
              type="submit"
              isDisabled={!canUpdate}
              isLoading={postFetcher.state !== "idle"}
              leftIcon={<LuSend />}
            >
              {t`Post`}
            </Button>
          </postFetcher.Form>
        </>
      )}
    </HStack>
  );

  return (
    <>
      <div className="flex-1 min-h-0 w-full">
        <InventoryCountLines
          lines={lines}
          count={count}
          isBlind={inventoryCount.isBlind}
          isReadOnly={isReadOnly}
          locationId={inventoryCount.locationId}
          title={inventoryCount.inventoryCountId}
          titleBadge={<InventoryCountStatus status={status} />}
          primaryAction={actions}
        />
      </div>

      {confirmModal.isOpen && (
        <InventoryCountConfirmModal
          inventoryCountId={inventoryCount.id!}
          summary={summary}
          isLoading={revalidator.state !== "idle"}
          onClose={confirmModal.onClose}
        />
      )}

      <Modal
        open={notesModal.isOpen}
        onOpenChange={(open) => {
          if (!open) notesModal.onClose();
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{t`Notes`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {inventoryCount.notes}
            </p>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};

export default InventoryCountDetails;
