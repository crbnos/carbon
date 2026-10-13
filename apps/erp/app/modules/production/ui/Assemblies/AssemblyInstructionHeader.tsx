// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  Input,
  MENU_ITEM_SHORTCUTS,
  useDisclosure,
  useViewport
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuBlocks, LuRefreshCw, LuTrash } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { DateTime, VersionMenu } from "~/components";
import { usePanels } from "~/components/Layout";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
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

function useInstruction() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  const routeData = useRouteData<{
    instruction: AssemblyInstruction;
    versions: AssemblyInstructionVersion[];
  }>(path.to.assemblyInstruction(id));
  return {
    id,
    instruction: routeData?.instruction,
    versions: routeData?.versions ?? []
  };
}

function useNewVersion() {
  const { id, instruction } = useInstruction();
  const newVersionFetcher = useFetcher<{}>();
  const onNewVersion = () => {
    if (!instruction) return;
    const formData = new FormData();
    formData.append("copyFromId", instruction.id);
    newVersionFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionVersionNew(id)
    });
  };
  return {
    onNewVersion,
    isCreatingVersion: newVersionFetcher.state !== "idle"
  };
}

function InstructionNameInput() {
  const { id, instruction } = useInstruction();
  const permissions = usePermissions();
  const nameFetcher = useFetcher<{}>();
  const [name, setName] = useState(instruction?.name ?? "");
  const isEditable =
    instruction?.status === "Draft" && permissions.can("update", "production");

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

  return (
    <Input
      className="mr-2 w-auto min-w-0 max-w-[320px] font-semibold text-foreground field-sizing-content"
      value={name}
      borderless
      onChange={isEditable ? (e) => setName(e.target.value) : undefined}
      onBlur={isEditable ? (e) => onUpdateName(e.target.value) : undefined}
    />
  );
}

function InstructionStatus() {
  const { instruction } = useInstruction();
  const user = useUser();
  if (!instruction) return null;
  return (
    <>
      <AssemblyInstructionStatus status={instruction.status} />
      <Badge variant="outline" className="shrink-0 tabular-nums">
        <Trans>Version {instruction.version}</Trans>
      </Badge>
      <span className="hidden whitespace-nowrap text-xs text-muted-foreground lg:inline">
        {instruction.createdBy === user.id ? (
          <Trans>
            By you · edited{" "}
            <DateTime
              value={instruction.updatedAt ?? instruction.createdAt}
              variant="relative"
            />
          </Trans>
        ) : (
          <Trans>
            edited{" "}
            <DateTime
              value={instruction.updatedAt ?? instruction.createdAt}
              variant="relative"
            />
          </Trans>
        )}
      </span>
    </>
  );
}

/** The next step: New Version on a published instruction, else Make Active. */
function InstructionPrimaryAction() {
  const { t } = useLingui();
  const { id, instruction } = useInstruction();
  const permissions = usePermissions();
  const activateDisclosure = useDisclosure();
  const { onNewVersion, isCreatingVersion } = useNewVersion();
  if (!instruction) return null;

  if (instruction.status === "Published") {
    if (!permissions.can("create", "production")) return null;
    return (
      <RecordAction slot="primary">
        <Button
          isDisabled={isCreatingVersion}
          isLoading={isCreatingVersion}
          onClick={onNewVersion}
        >
          <Trans>New Version</Trans>
        </Button>
      </RecordAction>
    );
  }

  return (
    <>
      <RecordAction slot="primary">
        <Button
          isDisabled={!permissions.can("update", "production")}
          onClick={activateDisclosure.onOpen}
        >
          <Trans>Make Active</Trans>
        </Button>
      </RecordAction>
      {activateDisclosure.isOpen && (
        <Confirm
          isOpen
          title={t`Make Active`}
          text={t`Make version ${instruction.version} active? This publishes it, archives the currently active version, and repoints in-flight job operations to it.`}
          confirmText={t`Make Active`}
          action={path.to.assemblyInstructionActivate(id)}
          onCancel={activateDisclosure.onClose}
          onSubmit={activateDisclosure.onClose}
        />
      )}
    </>
  );
}

/**
 * Phones: the name, status and next step at the top of the Overview tab, so
 * Steps and Properties get the full height.
 */
export function AssemblyInstructionOverviewHero() {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-card px-4 py-3">
      <InstructionNameInput />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
        <InstructionStatus />
      </div>
      <InstructionPrimaryAction />
    </div>
  );
}

const AssemblyInstructionHeader = () => {
  const { id, instruction, versions } = useInstruction();
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const permissions = usePermissions();
  const { toggleExplorer, toggleProperties } = usePanels();
  const deleteDisclosure = useDisclosure();
  const invalidateFetcher = useFetcher<{ success: boolean }>();
  const { onNewVersion, isCreatingVersion } = useNewVersion();
  const canCreate = permissions.can("create", "production");

  const [items] = useItems();
  const item = instruction?.itemId
    ? items.find((i) => i.id === instruction.itemId)
    : undefined;

  const menuItems = (
    <>
      {item && itemTypesWithDetails.includes(item.type) && (
        <DropdownMenuItem shortcut={MENU_ITEM_SHORTCUTS.view} asChild>
          <Link to={getLinkToItemDetails(item.type as MethodItemType, item.id)}>
            <DropdownMenuIcon icon={<LuBlocks />} />
            <Trans>View Item Master</Trans>
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
        <Trans>Re-convert Model</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        disabled={
          !permissions.can("delete", "production") ||
          !permissions.is("employee")
        }
        destructive
        onClick={deleteDisclosure.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Instruction</Trans>
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      {/* Phones show the name, status and next step on the Overview tab
          (AssemblyInstructionOverviewHero), not above the tab row. */}
      <RecordHeader
        title={isPhone ? null : <InstructionNameInput />}
        titleInHero
        menu={menuItems}
        status={isPhone ? undefined : <InstructionStatus />}
        onToggleExplorer={toggleExplorer}
        onToggleProperties={toggleProperties}
        actions={
          <>
            {instruction && (
              <RecordAction slot="overflow">
                <VersionMenu
                  versions={versions}
                  currentVersionId={id}
                  getKey={(v) => v.id}
                  getHref={(v) => path.to.assemblyInstruction(v.id)}
                  renderLabel={(v) => (
                    <>
                      <Badge variant="outline" className="tabular-nums">
                        V{v.version}
                      </Badge>
                      <span>{v.name}</span>
                    </>
                  )}
                  renderStatus={(v) => (
                    <AssemblyInstructionStatus status={v.status} />
                  )}
                  onNewVersion={canCreate ? onNewVersion : undefined}
                  isNewVersionDisabled={isCreatingVersion}
                />
              </RecordAction>
            )}
            {isPhone ? null : <InstructionPrimaryAction />}
          </>
        }
      />
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteAssemblyInstruction(id)}
          isOpen={deleteDisclosure.isOpen}
          name={instruction?.name ?? t`assembly instruction`}
          text={t`Are you sure you want to delete ${instruction?.name}? This cannot be undone.`}
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

export default AssemblyInstructionHeader;
