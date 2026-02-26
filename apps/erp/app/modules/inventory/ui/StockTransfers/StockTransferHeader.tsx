import type { Result } from "@carbon/auth";
import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import {
  LuBarcode,
  LuCircleCheck,
  LuCirclePlay,
  LuEllipsisVertical,
  LuLoaderCircle,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { useAuditLog } from "~/components/AuditLog";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { StockTransfer, StockTransferLine } from "~/modules/inventory";
import { path } from "~/utils/path";
import StockTransferCompleteModal from "./StockTransferCompleteModal";
import StockTransferStatus from "./StockTransferStatus";

const StockTransferHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  if (!routeData?.stockTransfer)
    throw new Error("Failed to load stockTransfer");
  const status = routeData.stockTransfer.status;

  const { company } = useUser();
  const permissions = usePermissions();
  const postModal = useDisclosure();
  const deleteModal = useDisclosure();
  const statusFetcher = useFetcher<Result>();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "stockTransfer",
    entityId: id,
    companyId: company.id,
    variant: "dropdown"
  });

  const canComplete =
    routeData.stockTransferLines.length > 0 &&
    routeData.stockTransferLines.some(
      (line) => (line.pickedQuantity ?? 0) !== 0
    ) &&
    ["Released", "In Progress"].includes(status);

  const isCompleted = status === "Completed";

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "stockTransfer"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.stockTransfer?.assignee;

  const hasPickedItems = routeData?.stockTransferLines.some(
    (line) => line.pickedQuantity && line.pickedQuantity > 0
  );

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1)]">
        <HStack className="w-full justify-between">
          <HStack>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{routeData?.stockTransfer?.stockTransferId}</span>
            </Heading>

            <Copy text={routeData?.stockTransfer?.stockTransferId ?? ""} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More options"
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {auditLogTrigger}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    !permissions.can("delete", "inventory") ||
                    !permissions.is("employee") ||
                    !["Released", "Draft"].includes(status) ||
                    hasPickedItems
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Stock Transfer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <StockTransferStatus status={routeData?.stockTransfer?.status} />
          </HStack>
          <HStack>
            <Assignee
              size="md"
              id={id}
              value={assignee ?? ""}
              table="stockTransfer"
              isReadOnly={!permissions.can("update", "inventory")}
            />
            <Button variant="secondary" leftIcon={<LuBarcode />} asChild>
              <a
                target="_blank"
                href={path.to.file.stockTransfer(id)}
                rel="noreferrer"
              >
                Pick List
              </a>
            </Button>
            <statusFetcher.Form
              method="post"
              action={path.to.stockTransferStatus(id)}
            >
              <input type="hidden" name="status" value="Released" />
              <Button
                type="submit"
                leftIcon={<LuCirclePlay />}
                variant={status === "Draft" ? "primary" : "secondary"}
                isDisabled={
                  status !== "Draft" ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "inventory")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Released"
                }
              >
                Release
              </Button>
            </statusFetcher.Form>

            <statusFetcher.Form
              method="post"
              action={path.to.stockTransferStatus(id)}
            >
              <input type="hidden" name="status" value="Completed" />
              <Button
                type="submit"
                variant={canComplete && !isCompleted ? "primary" : "secondary"}
                isDisabled={
                  !canComplete ||
                  isCompleted ||
                  !permissions.is("employee") ||
                  (statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "Completed")
                }
                leftIcon={<LuCircleCheck />}
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Completed"
                }
              >
                Complete
              </Button>
            </statusFetcher.Form>
            <statusFetcher.Form
              method="post"
              action={path.to.stockTransferStatus(id)}
            >
              <input type="hidden" name="status" value="Draft" />
              <Button
                type="submit"
                variant="secondary"
                leftIcon={<LuLoaderCircle />}
                isDisabled={
                  ["Draft"].includes(routeData?.stockTransfer?.status ?? "") ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "purchasing")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Draft"
                }
              >
                Reopen
              </Button>
            </statusFetcher.Form>
          </HStack>
        </HStack>
      </div>

      {postModal.isOpen && (
        <StockTransferCompleteModal onClose={postModal.onClose} />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteStockTransfer(id)}
          isOpen={deleteModal.isOpen}
          name={routeData?.stockTransfer?.stockTransferId ?? "stockTransfer"}
          text={`Are you sure you want to delete ${routeData?.stockTransfer?.stockTransferId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default StockTransferHeader;
