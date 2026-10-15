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
import { useState } from "react";
import { LuArchive, LuLoaderCircle, LuTrash } from "react-icons/lu";
import { useParams } from "react-router";
import { usePanels } from "~/components/Layout";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import { Confirm } from "~/components/Modals";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import type { Training } from "~/modules/resources";
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
  const displayName = routeData?.training?.name ?? "";
  const deleteDisclosure = useDisclosure();

  const status = routeData?.training?.status;
  const isDraft = status === "Draft";
  const canUpdate = permissions.can("update", "people");
  const [nextStatus, setNextStatus] = useState<
    "Active" | "Archived" | "Draft" | null
  >(null);

  const statusDialog = {
    Active: {
      title: t`Publish Training`,
      text: t`Employees assigned to this training can open it. The content, guide and questions can no longer change.`,
      confirmText: t`Publish`
    },
    Archived: {
      title: t`Archive Training`,
      text: t`Employees can no longer open this training.`,
      confirmText: t`Archive`
    },
    Draft: {
      title: t`Reopen Training`,
      text: t`The training goes back to Draft so you can change it. Employees cannot open it until you publish it again.`,
      confirmText: t`Reopen`
    }
  };

  const statusBadge = (
    // @ts-expect-error TS2322
    <TrainingStatus status={routeData?.training?.status} />
  );
  const menuItems = (
    <>
      <DropdownMenuItem
        disabled={isDraft || !canUpdate}
        onClick={() => setNextStatus("Draft")}
      >
        <DropdownMenuIcon icon={<LuLoaderCircle />} />
        <Trans>Reopen</Trans>
      </DropdownMenuItem>
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
    </>
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
            {status === "Active" && (
              <RecordAction slot="overflow">
                <Button
                  variant="secondary"
                  leftIcon={<LuArchive />}
                  isDisabled={!canUpdate}
                  onClick={() => setNextStatus("Archived")}
                >
                  <Trans>Archive</Trans>
                </Button>
              </RecordAction>
            )}
            {isDraft && (
              <RecordAction slot="primary">
                <Button
                  variant="primary"
                  isDisabled={!canUpdate}
                  onClick={() => setNextStatus("Active")}
                >
                  <Trans>Publish</Trans>
                </Button>
              </RecordAction>
            )}
          </>
        }
      />
      {nextStatus && (
        <Confirm
          action={path.to.bulkUpdateTraining}
          title={statusDialog[nextStatus].title}
          text={statusDialog[nextStatus].text}
          confirmText={statusDialog[nextStatus].confirmText}
          confirmVariant={nextStatus === "Archived" ? "destructive" : undefined}
          onCancel={() => setNextStatus(null)}
          onSubmit={() => setNextStatus(null)}
        >
          <input type="hidden" name="ids" value={id} />
          <input type="hidden" name="field" value="status" />
          <input type="hidden" name="value" value={nextStatus} />
        </Confirm>
      )}
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
