// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction, useRevalidator } from "@carbon/query";
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
import {
  LuCheck,
  LuHistory,
  LuInfo,
  LuRotateCcw,
  LuSend
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  RecordAction,
  RecordHero,
  RecordPhoneChrome
} from "~/components/Layout/RecordHeader";
import { usePermissions } from "~/hooks";
import type {
  InventoryCountLine,
  InventoryCount as InventoryCountType,
  StockMovement
} from "~/modules/inventory/types";
import {
  InventoryCountConfirmModal,
  InventoryCountLines,
  InventoryCountStatus
} from "~/modules/inventory/ui";
import type { action as postAction } from "~/routes/x+/inventory-count+/$id.post";
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
  // Post submits via a fetcher: a refusal is toasted (by default for an
  // error), and lines that cannot post come back as data. Success redirects
  // and flashes normally.
  const postFetcher = useAction<typeof postAction>({
    onSuccess: (data) => {
      if ("invalidLineIds" in data) toast.error(data.message);
    }
  });
  // Rows the last post attempt rejected (an invalid serial quantity) —
  // highlighted red until the user fixes them and re-posts.
  const posted = postFetcher.data;
  const invalidLineIds =
    posted && "invalidLineIds" in posted ? posted.invalidLineIds : undefined;

  const status = inventoryCount.status;
  // Counted quantities are entered while Draft; every later state is read-only.
  const isReadOnly = status !== "Draft";
  // Blind counting withholds System Qty + Variance until the count is Posted, so
  // the counter never sees the expected figure while it can still influence the
  // result. Mirrors the server-side strip in the loader; kept separate from the
  // edit gate (blind spans Draft + Pending, editing is Draft-only).
  const hideSystemQuantity = inventoryCount.isBlind && status !== "Posted";

  const statusBadge = <InventoryCountStatus status={status} />;

  // Actions live in the table header (the `primaryAction` slot) instead of a
  // dedicated detail header. Notes are surfaced via an info icon → modal.
  const actions = (
    <HStack spacing={2} className="items-center max-md:hidden">
      {inventoryCount.notes && (
        <RecordAction slot="overflow">
          <IconButton
            aria-label={t`View notes`}
            variant="ghost"
            icon={<LuInfo />}
            onClick={notesModal.onOpen}
          />
        </RecordAction>
      )}
      {movements.length > 0 && (
        <RecordAction slot="overflow">
          <Button
            variant="secondary"
            leftIcon={<LuHistory />}
            onClick={historyModal.onOpen}
          >
            {t`History`}
          </Button>
        </RecordAction>
      )}
      {status === "Draft" && (
        <RecordAction slot="primary">
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
        </RecordAction>
      )}
      {status === "Pending" && (
        <>
          <RecordAction slot="secondary">
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
          </RecordAction>
          <RecordAction slot="primary">
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
          </RecordAction>
        </>
      )}
    </HStack>
  );

  return (
    <>
      <RecordHero status={statusBadge} />
      <RecordPhoneChrome />
      <div className="flex-1 min-h-0 w-full">
        <InventoryCountLines
          lines={lines}
          count={count}
          hideSystemQuantity={hideSystemQuantity}
          isReadOnly={isReadOnly}
          locationId={inventoryCount.locationId}
          title={inventoryCount.inventoryCountId}
          titleBadge={statusBadge}
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
