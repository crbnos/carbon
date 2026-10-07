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
  useDisclosure
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

const AssemblyInstructionHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    instruction: AssemblyInstruction;
    versions: AssemblyInstructionVersion[];
  }>(path.to.assemblyInstruction(id));
  const instruction = routeData?.instruction;
  const versions = routeData?.versions ?? [];

  const { t } = useLingui();
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

  const nameInput = (
    <Input
      className="mr-2 w-auto min-w-0 max-w-[320px] font-semibold text-foreground field-sizing-content"
      value={name}
      borderless
      onChange={
        isDraft && canUpdate ? (e) => setName(e.target.value) : undefined
      }
      onBlur={
        isDraft && canUpdate ? (e) => onUpdateName(e.target.value) : undefined
      }
    />
  );
  const statusBadge = (
    <AssemblyInstructionStatus status={instruction?.status} />
  );
  const versionBadge = instruction && (
    <Badge variant="outline" className="shrink-0 tabular-nums">
      <Trans>Version {instruction.version}</Trans>
    </Badge>
  );
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

  const editedBy = instruction && (
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
  );

  return (
    <>
      <RecordHeader
        title={nameInput}
        titleInHero
        menu={menuItems}
        status={
          <>
            {statusBadge}
            {versionBadge}
            {editedBy}
          </>
        }
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
            {instruction?.status === "Published"
              ? canCreate && (
                  <RecordAction slot="primary">
                    <Button
                      isDisabled={isCreatingVersion}
                      isLoading={isCreatingVersion}
                      onClick={onNewVersion}
                    >
                      <Trans>New Version</Trans>
                    </Button>
                  </RecordAction>
                )
              : instruction && (
                  <RecordAction slot="primary">
                    <Button
                      isDisabled={!canUpdate}
                      onClick={activateDisclosure.onOpen}
                    >
                      <Trans>Make Active</Trans>
                    </Button>
                  </RecordAction>
                )}
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
      {activateDisclosure.isOpen && instruction && (
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
};

export default AssemblyInstructionHeader;
