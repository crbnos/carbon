import {
  MenuIcon,
  MenuItem,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBlocks,
  LuBox,
  LuCalendar,
  LuCircleCheck,
  LuPencil,
  LuSquareStack,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { AssemblyInstructionListItem } from "../../types";
import AssemblyInstructionStatus from "./AssemblyInstructionStatus";

type AssemblyInstructionsTableProps = {
  data: AssemblyInstructionListItem[];
  count: number;
};

const itemTypesWithDetails = ["Part", "Material", "Tool", "Consumable"];

function ProcessingStatus({ status }: { status?: string | null }) {
  switch (status) {
    case "Success":
      return <Status color="green">{status}</Status>;
    case "Failed":
      return <Status color="red">{status}</Status>;
    case "Queued":
    case "Processing":
      return <Status color="yellow">{status}</Status>;
    case "Idle":
      return <Status color="gray">{status}</Status>;
    default:
      return null;
  }
}

const AssemblyInstructionsTable = memo(
  ({ data, count }: AssemblyInstructionsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [items] = useItems();
    const deleteDisclosure = useDisclosure();
    const [selectedInstruction, setSelectedInstruction] =
      useState<AssemblyInstructionListItem | null>(null);

    const columns = useMemo<ColumnDef<AssemblyInstructionListItem>[]>(
      () => [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <Hyperlink to={path.to.assemblyInstruction(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBlocks />
          }
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <AssemblyInstructionStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuCircleCheck />
          }
        },
        {
          accessorKey: "itemId",
          header: "Item",
          cell: ({ row }) => {
            const item = items.find((i) => i.id === row.original.itemId);
            if (!item) {
              return <span className="text-muted-foreground">—</span>;
            }
            return itemTypesWithDetails.includes(item.type) ? (
              <Hyperlink
                to={getLinkToItemDetails(item.type as MethodItemType, item.id)}
              >
                {item.readableIdWithRevision}
              </Hyperlink>
            ) : (
              <span>{item.readableIdWithRevision}</span>
            );
          },
          meta: {
            icon: <LuSquareStack />
          }
        },
        {
          id: "model",
          header: "Model",
          cell: ({ row }) => {
            const model = row.original.modelUpload;
            if (!model) {
              return <span className="text-muted-foreground">—</span>;
            }
            return (
              <VStack spacing={0}>
                <span className="truncate">{model.name ?? model.id}</span>
                {typeof model.componentCount === "number" && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {model.componentCount} component
                    {model.componentCount === 1 ? "" : "s"}
                  </span>
                )}
              </VStack>
            );
          },
          meta: {
            icon: <LuBox />
          }
        },
        {
          id: "processingStatus",
          header: "Processing",
          cell: ({ row }) => (
            <ProcessingStatus
              status={row.original.modelUpload?.processingStatus}
            />
          ),
          meta: {
            icon: <LuCircleCheck />
          }
        },
        {
          accessorKey: "updatedAt",
          header: "Updated",
          cell: ({ row }) =>
            formatDate(row.original.updatedAt ?? row.original.createdAt),
          meta: {
            icon: <LuCalendar />
          }
        }
      ],
      [items]
    );

    const renderContextMenu = useCallback(
      (row: AssemblyInstructionListItem) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "production")}
              onClick={() => {
                navigate(path.to.assemblyInstruction(row.id));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Instruction
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "production")}
              onClick={() => {
                flushSync(() => {
                  setSelectedInstruction(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Instruction
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<AssemblyInstructionListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "production") && (
              <New
                label="Assembly Instruction"
                to={path.to.newAssemblyInstruction}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Assembly Instructions"
        />
        {deleteDisclosure.isOpen && selectedInstruction && (
          <ConfirmDelete
            action={path.to.deleteAssemblyInstruction(selectedInstruction.id)}
            isOpen
            onCancel={() => {
              setSelectedInstruction(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedInstruction(null);
              deleteDisclosure.onClose();
            }}
            name={selectedInstruction.name ?? "assembly instruction"}
            text="Are you sure you want to delete this assembly instruction?"
          />
        )}
      </>
    );
  }
);

AssemblyInstructionsTable.displayName = "AssemblyInstructionsTable";
export default AssemblyInstructionsTable;
