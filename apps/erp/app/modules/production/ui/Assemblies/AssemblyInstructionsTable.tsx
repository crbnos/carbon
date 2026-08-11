import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  MenuIcon,
  MenuItem,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { getItemById, getItemReadableId } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBlocks,
  LuBox,
  LuCalendar,
  LuCircleCheck,
  LuEllipsisVertical,
  LuGitPullRequest,
  LuPencil,
  LuSquareStack,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  DateTime,
  exportOnlyColumn,
  Hyperlink,
  New,
  Table
} from "~/components";
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
            <div className="flex flex-col gap-0">
              <Hyperlink to={path.to.assemblyInstruction(row.original.id!)}>
                {row.original.name}
              </Hyperlink>
              <span className="text-sm text-muted-foreground">
                Version {row.original.version}
              </span>
            </div>
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
            icon: <LuSquareStack />,
            // Without this the exporter substitutes the item's name for the id
            // (Download.tsx idNameMaps), losing the readable id the cell shows.
            exportValue: (row) => getItemReadableId(items, row.itemId) ?? null
          }
        },
        exportOnlyColumn<AssemblyInstructionListItem>({
          id: "itemName",
          header: "Item Name",
          value: (row) =>
            row.itemId ? (getItemById(items, row.itemId)?.name ?? null) : null
        }),
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
          cell: ({ row }) => (
            <DateTime
              value={row.original.updatedAt ?? row.original.createdAt}
              variant="date"
            />
          ),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "versions",
          header: "Versions",
          cell: ({ row }) => {
            const versions = (row.original?.versions ?? []) as Array<{
              id: string;
              version: number;
              status: "Draft" | "Published" | "Archived";
            }>;

            return (
              <HoverCard>
                <HoverCardTrigger>
                  <Badge variant="secondary" className="cursor-pointer">
                    {versions.length} Version
                    {versions.length === 1 ? "" : "s"}
                    <LuEllipsisVertical className="w-3 h-3 ml-2" />
                  </Badge>
                </HoverCardTrigger>
                <HoverCardContent>
                  <div className="flex flex-col w-full gap-4 text-sm">
                    {versions
                      .sort((a, b) => a.version - b.version)
                      .map((version) => (
                        <div
                          key={version.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <Hyperlink
                            to={path.to.assemblyInstruction(version.id)}
                            className="flex items-center justify-start gap-1"
                          >
                            Version {version.version}
                          </Hyperlink>
                          <div className="flex items-center justify-end">
                            <AssemblyInstructionStatus
                              status={version.status}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          },
          meta: {
            icon: <LuGitPullRequest />
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
                navigate(path.to.assemblyInstruction(row.id!));
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
            action={path.to.deleteAssemblyInstruction(selectedInstruction.id!)}
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
