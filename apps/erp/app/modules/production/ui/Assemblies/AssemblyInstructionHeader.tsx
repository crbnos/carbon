import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  useDisclosure
} from "@carbon/react";
import { useState } from "react";
import {
  LuBlocks,
  LuEllipsisVertical,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  useDateFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { assemblyInstructionStatuses } from "../../production.models";
import type { AssemblyInstruction } from "../../types";
import AssemblyInstructionStatus from "./AssemblyInstructionStatus";

const itemTypesWithDetails = ["Part", "Material", "Tool", "Consumable"];

const AssemblyInstructionHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    instruction: AssemblyInstruction;
  }>(path.to.assemblyInstruction(id));
  const instruction = routeData?.instruction;

  const permissions = usePermissions();
  const user = useUser();
  const { formatRelativeTime } = useDateFormatter();
  const { toggleExplorer, toggleProperties } = usePanels();
  const deleteDisclosure = useDisclosure();

  const nameFetcher = useFetcher<{}>();
  const statusFetcher = useFetcher<{}>();
  const invalidateFetcher = useFetcher<{ success: boolean }>();

  const [name, setName] = useState(instruction?.name ?? "");

  const isDraft = instruction?.status === "Draft";
  const canUpdate = permissions.can("update", "production");

  const [items] = useItems();
  const item = instruction?.itemId
    ? items.find((i) => i.id === instruction.itemId)
    : undefined;

  const onUpdateName = (value: string) => {
    if (!instruction || !value.trim() || value === instruction.name) return;
    const formData = new FormData();
    formData.append("name", value);
    formData.append("modelUploadId", instruction.modelUploadId);
    if (instruction.itemId) formData.append("itemId", instruction.itemId);
    nameFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstruction(id)
    });
  };

  const onStatusChange = (
    status: (typeof assemblyInstructionStatuses)[number]
  ) => {
    const formData = new FormData();
    formData.append("status", status);
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionStatus(id)
    });
  };

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <HStack className="flex-grow" spacing={1}>
        <IconButton
          aria-label="Toggle Explorer"
          icon={<LuPanelLeft />}
          onClick={toggleExplorer}
          variant="ghost"
        />
        <Input
          className="mr-2 w-auto min-w-0 max-w-[320px] font-semibold text-foreground field-sizing-content"
          value={name}
          borderless
          onChange={
            isDraft && canUpdate ? (e) => setName(e.target.value) : undefined
          }
          onBlur={
            isDraft && canUpdate
              ? (e) => onUpdateName(e.target.value)
              : undefined
          }
        />
        <AssemblyInstructionStatus status={instruction?.status} />
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
            {item && itemTypesWithDetails.includes(item.type) && (
              <DropdownMenuItem asChild>
                <Link
                  to={getLinkToItemDetails(
                    item.type as MethodItemType,
                    item.id
                  )}
                >
                  <DropdownMenuIcon icon={<LuBlocks />} />
                  View Item Master
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={
                !permissions.can("update", "production") ||
                invalidateFetcher.state !== "idle"
              }
              onClick={() =>
                invalidateFetcher.submit(null, {
                  method: "post",
                  action: path.to.assemblyModelInvalidate(id)
                })
              }
            >
              <DropdownMenuIcon icon={<LuRefreshCw />} />
              Re-convert Model
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                !permissions.can("delete", "production") ||
                !permissions.is("employee")
              }
              destructive
              onClick={deleteDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              Delete Instruction
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {instruction && (
          <Badge variant="outline" className="shrink-0 tabular-nums">
            Edit {instruction.version}
          </Badge>
        )}
        {instruction && (
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground lg:inline">
            {instruction.createdBy === user.id ? "By you · " : ""}
            edited{" "}
            {formatRelativeTime(instruction.updatedAt ?? instruction.createdAt)}
          </span>
        )}
      </HStack>
      <div className="flex flex-shrink-0 gap-2 items-center justify-end">
        {instruction?.status === "Draft" && (
          <Button
            isDisabled={!canUpdate}
            isLoading={statusFetcher.state !== "idle"}
            onClick={() => onStatusChange("Published")}
          >
            Publish
          </Button>
        )}
        {instruction?.status === "Published" && (
          <Button
            variant="secondary"
            isDisabled={!canUpdate}
            isLoading={statusFetcher.state !== "idle"}
            onClick={() => onStatusChange("Archived")}
          >
            Archive
          </Button>
        )}
        {instruction?.status === "Archived" && (
          <Button
            variant="secondary"
            isDisabled={!canUpdate}
            isLoading={statusFetcher.state !== "idle"}
            onClick={() => onStatusChange("Draft")}
          >
            Restore to Draft
          </Button>
        )}
        <IconButton
          aria-label="Toggle Properties"
          icon={<LuPanelRight />}
          onClick={toggleProperties}
          variant="ghost"
        />
      </div>
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteAssemblyInstruction(id)}
          isOpen={deleteDisclosure.isOpen}
          name={instruction?.name ?? "assembly instruction"}
          text={`Are you sure you want to delete ${instruction?.name}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
};

export default AssemblyInstructionHeader;
