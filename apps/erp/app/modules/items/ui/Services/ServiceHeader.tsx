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
import { LuTrash } from "react-icons/lu";
import { useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { DetailsTopbar } from "~/components/Layout";
import { RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useResolved } from "~/hooks/useResolved";
import { path } from "~/utils/path";
import type { Service } from "../../types";
import { getItemLifecycleStatus } from "../Item/ItemSupersessionForm";
import { useServiceNavigation } from "./useServiceNavigation";

const ServiceHeader = () => {
  const { t } = useLingui();
  const links = useServiceNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const { company } = useUser();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "item",
    entityId: itemId,
    companyId: company.id,
    variant: "dropdown"
  });

  const routeData = useRouteData<{
    serviceSummary: Service;
    supersession: Promise<{
      supersessionMode:
        | "Consume First"
        | "Prefer New"
        | "Stock Only"
        | "No Stock";
    } | null>;
  }>(path.to.service(itemId));

  const supersession = useResolved(routeData?.supersession, null, itemId);
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
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        disabled={
          !permissions.can("delete", "parts") || !permissions.is("employee")
        }
        destructive
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Service</Trans>
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <RecordHeader
        title={routeData?.serviceSummary?.readableIdWithRevision}
        titleTo={path.to.serviceDetails(itemId)}
        copyValue={routeData?.serviceSummary?.readableIdWithRevision ?? ""}
        menu={menuItems}
        status={statusPill}
        aside={<DetailsTopbar links={links} />}
      />
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteItem(itemId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.serviceSummary?.readableIdWithRevision ?? "service"}
          text={t`Are you sure you want to delete ${routeData?.serviceSummary?.readableIdWithRevision}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default ServiceHeader;
