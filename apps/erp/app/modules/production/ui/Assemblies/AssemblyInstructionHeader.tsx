import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  useDisclosure
} from "@carbon/react";
import { useState } from "react";
import {
  LuBlocks,
  LuChevronDown,
  LuCirclePlus,
  LuEllipsisVertical,
  LuGitPullRequestArrow,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useNavigate, useParams } from "react-router";
import { DateTime } from "~/components";
import { usePanels } from "~/components/Layout";
import { Confirm } from "~/components/Modals";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type {
  AssemblyInstruction,
  AssemblyInstructionVersion
} from "../../types";
import AssemblyInstructionStatus from "./AssemblyInstructionStatus";

const itemTypesWithDetails = ["Part", "Material", "Tool", "Consumable"];

const AssemblyInstructionHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    instruction: AssemblyInstruction;
    versions: AssemblyInstructionVersion[];
  }>(path.to.assemblyInstruction(id));
  const instruction = routeData?.instruction;
  const versions = routeData?.versions ?? [];

  const navigate = useNavigate();
  const permissions = usePermissions();
  const user = useUser();
  const { toggleExplorer, toggleProperties } = usePanels();
  const deleteDisclosure = useDisclosure();
  const activateDisclosure = useDisclosure();

  const nameFetcher = useFetcher<{}>();
  const newVersionFetcher = useFetcher<{}>();
  const invalidateFetcher = useFetcher<{ success: boolean }>();

  const [name, setName] = useState(instruction?.name ?? "");

  const isDraft = instruction?.status === "Draft";
  const canUpdate = permissions.can("update", "production");
  const canCreate = permissions.can("create", "production");
  const isCreatingVersion = newVersionFetcher.state !== "idle";

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

  const onNewVersion = () => {
    if (!instruction) return;
    const formData = new FormData();
    formData.append("copyFromId", instruction.id);
    newVersionFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionVersionNew(id)
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
            Version {instruction.version}
          </Badge>
        )}
        {instruction && (
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground lg:inline">
            {instruction.createdBy === user.id ? "By you · " : ""}
            edited{" "}
            <DateTime
              value={instruction.updatedAt ?? instruction.createdAt}
              variant="relative"
            />
          </span>
        )}
      </HStack>
      <div className="flex flex-shrink-0 gap-2 items-center justify-end">
        {instruction && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                leftIcon={<LuGitPullRequestArrow />}
                rightIcon={<LuChevronDown />}
              >
                Versions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canCreate && (
                <>
                  <DropdownMenuItem
                    disabled={isCreatingVersion}
                    onClick={onNewVersion}
                  >
                    <DropdownMenuIcon icon={<LuCirclePlus />} />
                    New Version
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuRadioGroup
                value={id}
                onValueChange={(value) =>
                  navigate(path.to.assemblyInstruction(value))
                }
              >
                {versions.map((version) => (
                  <DropdownMenuRadioItem
                    key={version.id}
                    value={version.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <Badge variant="outline" className="tabular-nums">
                      V{version.version}
                    </Badge>
                    <span>{version.name}</span>
                    <AssemblyInstructionStatus status={version.status} />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {instruction?.status === "Published"
          ? canCreate && (
              <Button
                isDisabled={isCreatingVersion}
                isLoading={isCreatingVersion}
                onClick={onNewVersion}
              >
                New Version
              </Button>
            )
          : instruction && (
              <Button
                isDisabled={!canUpdate}
                onClick={activateDisclosure.onOpen}
              >
                Make Active
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
      {activateDisclosure.isOpen && instruction && (
        <Confirm
          isOpen
          title="Make Active"
          text={`Make version ${instruction.version} active? This publishes it, archives the currently active version, and repoints in-flight job operations to it.`}
          confirmText="Make Active"
          action={path.to.assemblyInstructionActivate(id)}
          onCancel={activateDisclosure.onClose}
          onSubmit={activateDisclosure.onClose}
        />
      )}
    </div>
  );
};

export default AssemblyInstructionHeader;
