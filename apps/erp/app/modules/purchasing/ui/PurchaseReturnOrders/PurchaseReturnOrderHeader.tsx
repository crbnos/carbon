import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCheckCheck,
  LuCircleCheck,
  LuCircleStop,
  LuCreditCard,
  LuEllipsisVertical,
  LuFile,
  LuGitCompare,
  LuPanelLeft,
  LuPanelRight,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import {
  Link,
  useFetcher,
  useNavigation,
  useParams,
  useSubmit
} from "react-router";
import { usePanels } from "~/components/Layout";
import Confirm from "~/components/Modals/Confirm/Confirm";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import PurchaseReturnOrderCreditModal from "./PurchaseReturnOrderCreditModal";
import PurchaseReturnOrderStatus from "./PurchaseReturnOrderStatus";
import type { PurchaseReturnOrder, PurchaseReturnOrderLine } from "./types";

const PurchaseReturnOrderHeader = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    purchaseReturnOrder: PurchaseReturnOrder;
    lines: PurchaseReturnOrderLine[];
  }>(path.to.purchaseReturnOrder(id));

  if (!routeData?.purchaseReturnOrder) {
    throw new Error("Failed to load purchase return order");
  }

  const permissions = usePermissions();
  const purchaseReturnOrder = routeData.purchaseReturnOrder;
  const status = purchaseReturnOrder.status;

  const replacementFetcher = useFetcher<{ success: boolean }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isCreatingDocument = navigation.state !== "idle";

  // Credit is capped at shipped quantity — the button is useless before
  // anything has been shipped back.
  const hasShippedQuantity = routeData.lines.some(
    (line) => Number(line.quantityShipped) > 0
  );

  // Same pattern as the PO header's ship: POST the source document to the
  // shipment create route, which drafts the shipment and redirects into it.
  const ship = () => {
    const formData = new FormData();
    formData.set("sourceDocument", "Purchase Return Order");
    formData.set("sourceDocumentId", id);
    submit(formData, { method: "post", action: path.to.newShipment });
  };

  const confirmDisclosure = useDisclosure();
  const cancelDisclosure = useDisclosure();
  const completeDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const creditDisclosure = useDisclosure();

  const canUpdate = permissions.can("update", "purchasing");

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-background border-b h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label={t`Toggle Explorer`}
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.purchaseReturnOrderDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{purchaseReturnOrder.purchaseReturnOrderId}</span>
              </Heading>
            </Link>
            <Copy text={purchaseReturnOrder.purchaseReturnOrderId ?? ""} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  destructive
                  disabled={
                    !["Draft", "Cancelled"].includes(status ?? "") ||
                    !permissions.can("delete", "purchasing") ||
                    !permissions.is("employee")
                  }
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Supplier Return</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <PurchaseReturnOrderStatus status={status} />
          </HStack>
          <HStack>
            {status !== "Draft" && (
              <Button leftIcon={<LuFile />} variant="secondary" asChild>
                <a
                  target="_blank"
                  href={path.to.file.purchaseReturnOrder(id)}
                  rel="noreferrer"
                >
                  <Trans>PDF</Trans>
                </a>
              </Button>
            )}

            {status === "Draft" && (
              <Button
                leftIcon={<LuCheckCheck />}
                variant="primary"
                isDisabled={routeData.lines.length === 0 || !canUpdate}
                onClick={confirmDisclosure.onOpen}
              >
                <Trans>Confirm</Trans>
              </Button>
            )}

            {["Draft", "Confirmed"].includes(status ?? "") && (
              <Button
                variant="secondary"
                leftIcon={<LuCircleStop />}
                isDisabled={!canUpdate}
                onClick={cancelDisclosure.onOpen}
              >
                <Trans>Cancel</Trans>
              </Button>
            )}

            {["Confirmed", "Partially Shipped"].includes(status ?? "") && (
              <Button
                variant={status === "Confirmed" ? "primary" : "secondary"}
                leftIcon={<LuTruck />}
                isDisabled={
                  isCreatingDocument || !permissions.can("create", "inventory")
                }
                onClick={ship}
              >
                <Trans>Ship</Trans>
              </Button>
            )}

            {["Partially Shipped", "Shipped"].includes(status ?? "") && (
              <Button
                variant="primary"
                leftIcon={<LuCircleCheck />}
                isDisabled={!canUpdate}
                onClick={completeDisclosure.onOpen}
              >
                <Trans>Complete</Trans>
              </Button>
            )}

            {!["Draft", "Cancelled"].includes(status ?? "") && (
              <>
                {hasShippedQuantity && (
                  <Button
                    leftIcon={<LuCreditCard />}
                    variant="secondary"
                    isDisabled={!permissions.can("create", "invoicing")}
                    onClick={creditDisclosure.onOpen}
                  >
                    <Trans>Issue Credit</Trans>
                  </Button>
                )}

                {purchaseReturnOrder.replacementPurchaseOrderId ? (
                  <Button
                    leftIcon={<LuGitCompare />}
                    variant="secondary"
                    asChild
                  >
                    <Link
                      to={path.to.purchaseOrder(
                        purchaseReturnOrder.replacementPurchaseOrderId
                      )}
                    >
                      <Trans>Replacement Order</Trans>
                    </Link>
                  </Button>
                ) : (
                  <Button
                    leftIcon={<LuGitCompare />}
                    variant="secondary"
                    isLoading={replacementFetcher.state !== "idle"}
                    isDisabled={
                      replacementFetcher.state !== "idle" ||
                      !permissions.can("create", "purchasing")
                    }
                    onClick={() => {
                      replacementFetcher.submit(null, {
                        method: "post",
                        action: path.to.purchaseReturnOrderReplacement(id)
                      });
                    }}
                  >
                    <Trans>Create Replacement</Trans>
                  </Button>
                )}
              </>
            )}

            <IconButton
              aria-label={t`Toggle Properties`}
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {confirmDisclosure.isOpen && (
        <Confirm
          action={path.to.purchaseReturnOrderConfirm(id)}
          title={t`Confirm ${purchaseReturnOrder.purchaseReturnOrderId}`}
          text={t`Are you sure you want to confirm this supplier return? Confirming authorizes the goods on the lines to be shipped back to the supplier.`}
          confirmText={t`Confirm`}
          onCancel={confirmDisclosure.onClose}
          onSubmit={confirmDisclosure.onClose}
        />
      )}

      {cancelDisclosure.isOpen && (
        <Confirm
          action={path.to.purchaseReturnOrderStatus(id)}
          title={t`Cancel ${purchaseReturnOrder.purchaseReturnOrderId}`}
          text={t`Are you sure you want to cancel this supplier return? This releases the authorized quantities back to the source documents.`}
          confirmText={t`Cancel Return`}
          confirmVariant="destructive"
          onCancel={cancelDisclosure.onClose}
          onSubmit={cancelDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Cancelled" />
        </Confirm>
      )}

      {completeDisclosure.isOpen && (
        <Confirm
          action={path.to.purchaseReturnOrderStatus(id)}
          title={t`Complete ${purchaseReturnOrder.purchaseReturnOrderId}`}
          text={t`Are you sure you want to complete this supplier return? Every line must be fully shipped or short-closed.`}
          confirmText={t`Complete`}
          onCancel={completeDisclosure.onClose}
          onSubmit={completeDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Completed" />
        </Confirm>
      )}

      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deletePurchaseReturnOrder(id)}
          isOpen={deleteDisclosure.isOpen}
          name={purchaseReturnOrder.purchaseReturnOrderId!}
          text={t`Are you sure you want to delete ${purchaseReturnOrder.purchaseReturnOrderId!}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}

      {creditDisclosure.isOpen && (
        <PurchaseReturnOrderCreditModal
          currencyCode={purchaseReturnOrder.currencyCode}
          onClose={creditDisclosure.onClose}
        />
      )}
    </>
  );
};

export default PurchaseReturnOrderHeader;
