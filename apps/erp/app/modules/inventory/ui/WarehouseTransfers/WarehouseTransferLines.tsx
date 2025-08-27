import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Count,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack,
  cn,
  useDisclosure,
} from "@carbon/react";
import {
  formatRelativeTime,
  getItemById,
  getItemReadableId,
} from "@carbon/utils";
import { Link, Outlet, useFetcher, useNavigate } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { LuArrowRight, LuCirclePlus, LuEllipsisVertical } from "react-icons/lu";
import { EmployeeAvatar, Empty, ItemThumbnail } from "~/components";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { WarehouseTransfer, WarehouseTransferLine } from "../../types";
import useWarehouseTransferLines from "./useWarehouseTransferLines";

type WarehouseTransferLinesProps = {
  warehouseTransferLines: WarehouseTransferLine[];
  transferId: string;
  warehouseTransfer: WarehouseTransfer;
  compact?: boolean;
};

const WarehouseTransferLines = ({
  warehouseTransferLines,
  transferId,
  warehouseTransfer,
  compact = false,
}: WarehouseTransferLinesProps) => {
  const [items] = useItems();
  const { canEdit } = useWarehouseTransferLines(warehouseTransfer);

  const sortedLines = warehouseTransferLines.sort((a, b) => {
    const aReadableId = getItemReadableId(items, a.itemId) ?? "";
    const bReadableId = getItemReadableId(items, b.itemId) ?? "";
    return aReadableId.localeCompare(bReadableId);
  });

  return (
    <>
      <Card className={cn(compact && "border-none p-0 dark:shadow-none")}>
        <HStack className="justify-between">
          <CardHeader className={cn(compact && "px-0")}>
            <CardTitle className="flex flex-row items-center gap-2">
              Transfer Lines
              {sortedLines.length > 0 && <Count count={sortedLines.length} />}
            </CardTitle>
          </CardHeader>
          {canEdit && (
            <CardAction>
              <Button
                variant="secondary"
                leftIcon={<LuCirclePlus />}
                asChild
                disabled={!canEdit}
              >
                <Link to={path.to.newWarehouseTransferLine(transferId)}>
                  Add Line
                </Link>
              </Button>
            </CardAction>
          )}
        </HStack>
        <CardContent className={cn(compact && "px-0")}>
          <div className="flex flex-col gap-6">
            {sortedLines.length > 0 && (
              <div className="border rounded-lg">
                {sortedLines.map((line, index) => (
                  <WarehouseTransferLineListItem
                    key={line.id}
                    line={line}
                    warehouseTransfer={warehouseTransfer}
                    isDisabled={!canEdit}
                    className={
                      index === sortedLines.length - 1 ? "border-none" : ""
                    }
                  />
                ))}
              </div>
            )}

            {sortedLines.length === 0 && (
              <div className="flex flex-1 py-24 justify-center items-center w-full">
                <Empty />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

function WarehouseTransferLineListItem({
  line,
  warehouseTransfer,
  isDisabled,
  className,
}: {
  line: WarehouseTransferLine;
  warehouseTransfer: WarehouseTransfer;
  isDisabled: boolean;
  className?: string;
}) {
  const deleteModalDisclosure = useDisclosure();

  const [items] = useItems();
  const navigate = useNavigate();

  const item = getItemById(items, line.itemId);
  if (!item || !line.id) return null;

  const isUpdated = line.updatedBy !== null;
  const person = isUpdated ? line.updatedBy : line.createdBy;
  const date = line.updatedAt ?? line.createdAt;

  return (
    <div className={cn("border-b p-6", className)}>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4} className="flex-1">
            <div className="flex items-center space-x-3">
              <ItemThumbnail
                size="sm"
                thumbnailPath={line.item?.thumbnailPath}
                type={(item.type as "Part") ?? "Part"}
              />
              <VStack spacing={0}>
                <span className="text-sm font-medium truncate">
                  {item.name}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {item.readableIdWithRevision}
                </span>
              </VStack>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {Number(line.quantity).toLocaleString()}
              </Badge>
              {line.fromShelf && (
                <Badge variant="outline">{line.fromShelf.name}</Badge>
              )}
              <LuArrowRight className="size-4" />
              {line.toShelf && (
                <Badge variant="outline">{line.toShelf.name}</Badge>
              )}
            </div>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          <HStack spacing={2}>
            <span className="text-xs text-muted-foreground">
              {isUpdated ? "Updated" : "Created"} {formatRelativeTime(date)}
            </span>
            <EmployeeAvatar employeeId={person} withName={false} />
          </HStack>
          {!isDisabled && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Open menu"
                  icon={<LuEllipsisVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={isDisabled}
                  onClick={() =>
                    navigate(
                      path.to.warehouseTransferLine(
                        warehouseTransfer.id,
                        line.id
                      )
                    )
                  }
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isDisabled}
                  destructive
                  onClick={deleteModalDisclosure.onOpen}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {deleteModalDisclosure.isOpen && (
        <DeleteWarehouseTransferLine
          lineId={line.id}
          warehouseTransferId={warehouseTransfer.id}
          itemName={item.readableIdWithRevision}
          onCancel={() => {
            deleteModalDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteModalDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

function DeleteWarehouseTransferLine({
  lineId,
  warehouseTransferId,
  itemName,
  onCancel,
  onSubmit,
}: {
  lineId: string;
  warehouseTransferId: string;
  itemName: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      onSubmit();
      submitted.current = false;
    }
  }, [fetcher.state, onSubmit]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Delete Transfer Line</ModalTitle>
        </ModalHeader>
        <ModalBody>
          Are you sure you want to delete this transfer line for {itemName}?
          This cannot be undone.
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.warehouseTransferLine(warehouseTransferId, lineId)}
            onSubmit={() => (submitted.current = true)}
          >
            <input type="hidden" name="type" value="delete" />
            <input type="hidden" name="id" value={lineId} />
            <Button
              variant="destructive"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
            >
              Delete
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default WarehouseTransferLines;
