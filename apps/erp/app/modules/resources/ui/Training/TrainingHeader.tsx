// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTrash } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import type { Training } from "~/modules/resources";
import { useDocumentStore } from "~/stores";
import { path } from "~/utils/path";
import TrainingStatus from "./TrainingStatus";

const TrainingHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    training: Training;
  }>(path.to.training(id));

  const { t } = useLingui();
  const permissions = usePermissions();
  const { toggleExplorer, toggleProperties } = usePanels();
  // Live title from the editor's locked title block, so the header updates as
  // the user types (before the loader revalidates).
  const liveTitle = useDocumentStore((s) => s.liveTitle);
  const displayName = liveTitle ?? routeData?.training?.name ?? "";
  const deleteDisclosure = useDisclosure();

  const publishFetcher = useFetcher<{}>();
  const status = routeData?.training?.status;
  const isDraft = status === "Draft";
  const isPublishing = publishFetcher.state !== "idle";

  const onPublish = () => {
    const formData = new FormData();
    formData.append("ids", id);
    formData.append("field", "status");
    formData.append("value", "Active");
    publishFetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTraining
    });
  };

  const statusBadge = (
    // @ts-expect-error TS2322
    <TrainingStatus status={routeData?.training?.status} />
  );
  const menuItems = (
    <DropdownMenuItem
      shortcut={MENU_ITEM_SHORTCUTS.delete}
      disabled={
        !permissions.can("delete", "resources") || !permissions.is("employee")
      }
      destructive
      onClick={deleteDisclosure.onOpen}
    >
      <DropdownMenuIcon icon={<LuTrash />} />
      <Trans>Delete Training</Trans>
    </DropdownMenuItem>
  );

  return (
    <>
      <RecordHeader
        title={displayName}
        copyValue={displayName}
        menu={menuItems}
        status={statusBadge}
        onToggleExplorer={toggleExplorer}
        onToggleProperties={toggleProperties}
        actions={
          <>
            {isDraft && (
              <RecordAction slot="primary">
                <Button
                  isDisabled={
                    !permissions.can("update", "people") || isPublishing
                  }
                  isLoading={isPublishing}
                  onClick={onPublish}
                >
                  <Trans>Publish</Trans>
                </Button>
              </RecordAction>
            )}
          </>
        }
      />
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteTraining(id)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.training?.name ?? "training"}
          text={t`Are you sure you want to delete ${routeData?.training?.name}? This cannot be undone.`}
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

export default TrainingHeader;
