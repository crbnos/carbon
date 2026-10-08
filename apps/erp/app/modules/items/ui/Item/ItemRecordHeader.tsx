// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  Status,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { LuGitPullRequestArrow, LuTrash } from "react-icons/lu";
import { useAuditLog } from "~/components/AuditLog";
import { DetailsTopbar } from "~/components/Layout";
import { RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useUser } from "~/hooks";
import { useResolved } from "~/hooks/useResolved";
import { path } from "~/utils/path";
import type { SupersessionMode } from "../../items.models";
import { CreateChangeNoticeModal } from "../ChangeNotice";
import { getItemLifecycleStatus } from "./ItemSupersessionForm";

export type ItemSupersession = Promise<{
  supersessionMode: SupersessionMode;
} | null>;

type ItemRecordHeaderProps = {
  itemId: string;
  readableId?: string | null;
  subtitle?: ReactNode;
  detailsTo: string;
  links: ComponentProps<typeof DetailsTopbar>["links"];
  supersession?: ItemSupersession;
  deleteLabel: ReactNode;
  deleteFallbackName: string;
  withChangeNotice?: boolean;
};

const ItemRecordHeader = ({
  itemId,
  readableId,
  subtitle,
  detailsTo,
  links,
  supersession: supersessionPromise,
  deleteLabel,
  deleteFallbackName,
  withChangeNotice = false
}: ItemRecordHeaderProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const changeNoticeModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "item",
    entityId: itemId,
    companyId: company.id,
    variant: "dropdown"
  });

  const supersession = useResolved(supersessionPromise, null, itemId);
  const lifecycleStatus = getItemLifecycleStatus(
    supersession?.supersessionMode
  );

  const statusPill = lifecycleStatus && (
    <Status color={lifecycleStatus.color}>{lifecycleStatus.label}</Status>
  );
  const menuItems = (
    <>
      {auditLogTrigger}
      <DropdownMenuSeparator />
      {withChangeNotice && (
        <>
          <DropdownMenuItem
            disabled={!permissions.can("create", "parts")}
            onClick={changeNoticeModal.onOpen}
          >
            <DropdownMenuIcon icon={<LuGitPullRequestArrow />} />
            <Trans>Create Change Notice</Trans>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        disabled={
          !permissions.can("delete", "parts") || !permissions.is("employee")
        }
        destructive
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        {deleteLabel}
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <RecordHeader
        title={readableId}
        titleTo={detailsTo}
        copyValue={readableId ?? ""}
        menu={menuItems}
        status={statusPill}
        subtitle={subtitle}
        aside={<DetailsTopbar links={links} />}
      />
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteItem(itemId)}
          isOpen={deleteModal.isOpen}
          name={readableId ?? deleteFallbackName}
          text={t`Are you sure you want to delete ${readableId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {changeNoticeModal.isOpen && (
        <CreateChangeNoticeModal
          itemId={itemId}
          onClose={changeNoticeModal.onClose}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default ItemRecordHeader;
