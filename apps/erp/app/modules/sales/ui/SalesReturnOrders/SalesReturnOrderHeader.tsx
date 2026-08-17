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
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import Confirm from "~/components/Modals/Confirm/Confirm";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import SalesReturnOrderCreditModal from "./SalesReturnOrderCreditModal";
import SalesReturnOrderStatus from "./SalesReturnOrderStatus";
import type { SalesReturnOrder, SalesReturnOrderLine } from "./types";

const SalesReturnOrderHeader = () => {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    salesReturnOrder: SalesReturnOrder;
    lines: SalesReturnOrderLine[];
  }>(path.to.salesReturnOrder(id));

  if (!routeData?.salesReturnOrder) {
    throw new Error("Failed to load sales return order");
  }

  const permissions = usePermissions();
  const salesReturnOrder = routeData.salesReturnOrder;
  const status = salesReturnOrder.status;

  const replacementFetcher = useFetcher<{ success: boolean }>();

  const confirmDisclosure = useDisclosure();
  const cancelDisclosure = useDisclosure();
  const completeDisclosure = useDisclosure();
  const creditDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();

  const canUpdate = permissions.can("update", "sales");

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
            <Link to={path.to.salesReturnOrderDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{salesReturnOrder.salesReturnOrderId}</span>
              </Heading>
            </Link>
            <Copy text={salesReturnOrder.salesReturnOrderId ?? ""} />
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
                    !permissions.can("delete", "sales") ||
                    !permissions.is("employee")
                  }
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete RMA</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <SalesReturnOrderStatus status={status} />
          </HStack>
          <HStack>
            {status !== "Draft" && (
              <Button leftIcon={<LuFile />} variant="secondary" asChild>
                <a
                  target="_blank"
                  href={path.to.file.salesReturnOrder(id)}
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

            {["Partially Received", "Received"].includes(status ?? "") && (
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
                <Button
                  leftIcon={<LuCreditCard />}
                  variant="secondary"
                  isDisabled={!permissions.can("create", "invoicing")}
                  onClick={creditDisclosure.onOpen}
                >
                  <Trans>Issue Credit</Trans>
                </Button>

                {salesReturnOrder.replacementSalesOrderId ? (
                  <Button
                    leftIcon={<LuGitCompare />}
                    variant="secondary"
                    asChild
                  >
                    <Link
                      to={path.to.salesOrder(
                        salesReturnOrder.replacementSalesOrderId
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
                      !permissions.can("create", "sales")
                    }
                    onClick={() => {
                      replacementFetcher.submit(null, {
                        method: "post",
                        action: path.to.salesReturnOrderReplacement(id)
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
          action={path.to.salesReturnOrderConfirm(id)}
          title={t`Confirm ${salesReturnOrder.salesReturnOrderId}`}
          text={t`Are you sure you want to confirm this RMA? Confirming authorizes the customer to return the goods on the lines.`}
          confirmText={t`Confirm`}
          onCancel={confirmDisclosure.onClose}
          onSubmit={confirmDisclosure.onClose}
        />
      )}

      {cancelDisclosure.isOpen && (
        <Confirm
          action={path.to.salesReturnOrderStatus(id)}
          title={t`Cancel ${salesReturnOrder.salesReturnOrderId}`}
          text={t`Are you sure you want to cancel this RMA? This releases the authorized quantities back to the source documents.`}
          confirmText={t`Cancel RMA`}
          confirmVariant="destructive"
          onCancel={cancelDisclosure.onClose}
          onSubmit={cancelDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Cancelled" />
        </Confirm>
      )}

      {completeDisclosure.isOpen && (
        <Confirm
          action={path.to.salesReturnOrderStatus(id)}
          title={t`Complete ${salesReturnOrder.salesReturnOrderId}`}
          text={t`Are you sure you want to complete this RMA? Every line must be fully received or short-closed, with no received quantity pending disposition.`}
          confirmText={t`Complete`}
          onCancel={completeDisclosure.onClose}
          onSubmit={completeDisclosure.onClose}
        >
          <input type="hidden" name="status" value="Completed" />
        </Confirm>
      )}

      {creditDisclosure.isOpen && (
        <SalesReturnOrderCreditModal
          currencyCode={salesReturnOrder.currencyCode ?? undefined}
          onClose={creditDisclosure.onClose}
        />
      )}

      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSalesReturnOrder(id)}
          isOpen={deleteDisclosure.isOpen}
          name={salesReturnOrder.salesReturnOrderId!}
          text={t`Are you sure you want to delete ${salesReturnOrder.salesReturnOrderId!}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
    </>
  );
};

export default SalesReturnOrderHeader;
