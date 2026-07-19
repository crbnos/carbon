import {
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import {
  LuCheck,
  LuHistory,
  LuInfo,
  LuRotateCcw,
  LuSend,
  LuWrench
} from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";
import { usePermissions } from "~/hooks";
import type {
  InventoryCountLine,
  InventoryCount as InventoryCountType,
  StockMovement
} from "~/modules/inventory";
import {
  InventoryCountConfirmModal,
  InventoryCountLines,
  InventoryCountStatus
} from "~/modules/inventory";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import InventoryCountHistory from "./InventoryCountHistory";

type InventoryCountDetailsProps = {
  inventoryCount: InventoryCountType;
  lines: InventoryCountLine[];
  count: number;
  summary: { uncounted: number; variances: number };
  // Ledger adjustments this count has posted (empty for a never-posted Draft).
  movements: StockMovement[];
  // Option lists for the count-line column filters (same set as quantities).
  forms: ListItem[];
  substances: ListItem[];
  tags: string[];
  storageTypes: { id: string; name: string }[];
  storageUnits: { id: string; name: string }[];
};

const InventoryCountDetails = ({
  inventoryCount,
  lines,
  count,
  summary,
  movements,
  forms,
  substances,
  tags,
  storageTypes,
  storageUnits
}: InventoryCountDetailsProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "inventory");

  const confirmModal = useDisclosure();
  const notesModal = useDisclosure();
  const historyModal = useDisclosure();
  const revalidator = useRevalidator();
  const reopenFetcher = useFetcher();
  const postFetcher = useFetcher<{
    success: boolean;
    message: string;
    invalidLineIds?: string[];
  }>();
  const rectifyFetcher = useFetcher();

  // Rows the last post attempt rejected (an invalid serial quantity) —
  // highlighted red until the user fixes them and re-posts.
  const invalidLineIds = postFetcher.data?.invalidLineIds;

  // Post submits via a fetcher, so its action returns a validation failure (e.g.
  // a serial line counted > 1) as data rather than a flash toast — surface it
  // here. The fetcher still revalidates, so the count re-renders in place.
  // Success redirects and flashes normally.
  useEffect(() => {
    if (postFetcher.data && postFetcher.data.success === false) {
      toast.error(postFetcher.data.message);
    }
  }, [postFetcher.data]);

  const status = inventoryCount.status;
  // Counted quantities are entered while Draft; every later state is read-only.
  const isReadOnly = status !== "Draft";
  // Blind counting withholds System Qty + Variance until the count is Posted, so
  // the counter never sees the expected figure while it can still influence the
  // result. Mirrors the server-side strip in the loader; kept separate from the
  // edit gate (blind spans Draft + Pending, editing is Draft-only).
  const hideSystemQuantity = inventoryCount.isBlind && status !== "Posted";

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
      {movements.length > 0 && (
        <Button
          variant="secondary"
          leftIcon={<LuHistory />}
          onClick={historyModal.onOpen}
        >
          {t`History`}
        </Button>
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
      {status === "Posted" && (
        <rectifyFetcher.Form
          method="post"
          action={path.to.inventoryCountRectify(inventoryCount.id!)}
        >
          <Button
            type="submit"
            variant="secondary"
            isDisabled={!canUpdate}
            isLoading={rectifyFetcher.state !== "idle"}
            leftIcon={<LuWrench />}
          >
            {t`Rectify`}
          </Button>
        </rectifyFetcher.Form>
      )}
    </HStack>
  );

  return (
    <>
      <div className="flex-1 min-h-0 w-full">
        <InventoryCountLines
          lines={lines}
          count={count}
          hideSystemQuantity={hideSystemQuantity}
          isReadOnly={isReadOnly}
          locationId={inventoryCount.locationId}
          title={inventoryCount.inventoryCountId}
          titleBadge={<InventoryCountStatus status={status} />}
          primaryAction={actions}
          invalidLineIds={invalidLineIds}
          forms={forms}
          substances={substances}
          tags={tags}
          storageTypes={storageTypes}
          storageUnits={storageUnits}
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

      {historyModal.isOpen && (
        <InventoryCountHistory
          movements={movements}
          onClose={historyModal.onClose}
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
