// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuArrowLeftRight,
  LuBookMarked,
  LuCalendar,
  LuClock,
  LuFolderInput,
  LuFolderOutput,
  LuMapPin,
  LuPencil,
  LuText,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  projectStockTransferStatuses,
  projectStockTransferTypes
} from "../../projects.models";
import type { ProjectStockTransfer } from "../../types";
import ProjectStockTransferStatus from "./ProjectStockTransferStatus";
import { StockOwner } from "./StockOwner";
import { useStockTransferTypeLabels } from "./useStockTransferTypeLabels";

type ProjectStockTransfersTableProps = {
  data: ProjectStockTransfer[];
  count: number;
};

/** Projects → Transfers: every project stock transfer of the company. */
const ProjectStockTransfersTable = memo(
  ({ data, count }: ProjectStockTransfersTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const locations = useLocations();
    const [people] = usePeople();
    const typeLabels = useStockTransferTypeLabels();

    const columns = useMemo<ColumnDef<ProjectStockTransfer>[]>(
      () => [
        {
          accessorKey: "projectStockTransferId",
          header: t`Transfer ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.projectStockTransfer(row.original.id)}>
              <span className="whitespace-nowrap">
                {row.original.projectStockTransferId}
              </span>
            </Hyperlink>
          ),
          meta: { icon: <LuBookMarked /> }
        },
        {
          accessorKey: "type",
          header: t`Type`,
          cell: ({ row }) => (
            <Enumerable value={typeLabels[row.original.type]} />
          ),
          meta: {
            icon: <LuArrowLeftRight />,
            filter: {
              type: "static",
              options: projectStockTransferTypes.map((type) => ({
                value: type,
                label: <Enumerable value={typeLabels[type]} />
              }))
            }
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <ProjectStockTransferStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuClock />,
            pluralHeader: t`Statuses`,
            filter: {
              type: "static",
              options: projectStockTransferStatuses.map((status) => ({
                value: status,
                label: <ProjectStockTransferStatus status={status} />
              }))
            }
          }
        },
        {
          id: "from",
          header: t`From`,
          cell: ({ row }) => <StockOwner project={row.original.fromProject} />,
          meta: { icon: <LuFolderOutput /> }
        },
        {
          id: "to",
          header: t`To`,
          cell: ({ row }) => <StockOwner project={row.original.toProject} />,
          meta: { icon: <LuFolderInput /> }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => (
            <Enumerable
              value={
                locations.find((l) => l.value === row.original.locationId)
                  ?.label ?? null
              }
            />
          ),
          meta: {
            icon: <LuMapPin />,
            filter: {
              type: "static",
              options: locations.map((location) => ({
                value: location.value,
                label: <Enumerable value={location.label} />
              }))
            }
          }
        },
        {
          accessorKey: "reason",
          header: t`Reason`,
          cell: ({ row }) => (
            <span className="line-clamp-1">{row.original.reason}</span>
          ),
          meta: { icon: <LuText /> }
        },
        {
          accessorKey: "paybackDueDate",
          header: t`Payback Due`,
          cell: (item) => (
            <DateTime value={item.getValue<string | null>()} variant="date" />
          ),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
            icon: <LuUser />,
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            }
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => (
            <DateTime value={item.getValue<string>()} variant="date" />
          ),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "postedAt",
          header: t`Posted At`,
          cell: (item) => (
            <DateTime value={item.getValue<string | null>()} variant="date" />
          ),
          meta: { icon: <LuCalendar /> }
        }
      ],
      [locations, people, t, typeLabels]
    );

    const renderContextMenu = useCallback(
      (row: ProjectStockTransfer) => (
        <MenuItem
          shortcut={
            row.status === "Draft"
              ? MENU_ITEM_SHORTCUTS.edit
              : MENU_ITEM_SHORTCUTS.view
          }
          onClick={() => navigate(path.to.projectStockTransfer(row.id))}
        >
          <MenuIcon icon={<LuPencil />} />
          {row.status === "Draft" ? (
            <Trans>Edit Transfer</Trans>
          ) : (
            <Trans>View Transfer</Trans>
          )}
        </MenuItem>
      ),
      [navigate]
    );

    return (
      <Table<ProjectStockTransfer>
        data={data}
        columns={columns}
        count={count}
        defaultColumnVisibility={{ createdAt: false, postedAt: false }}
        primaryAction={
          permissions.can("update", "projects") && (
            <New label={t`Transfer`} to={path.to.newProjectStockTransfer} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Project Stock Transfers`}
      />
    );
  }
);

ProjectStockTransfersTable.displayName = "ProjectStockTransfersTable";
export default ProjectStockTransfersTable;
