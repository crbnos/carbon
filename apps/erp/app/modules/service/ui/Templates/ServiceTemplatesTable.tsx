// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuHash, LuLayoutTemplate, LuListTree, LuPencil } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Empty, Hyperlink, New, Table } from "~/components";
import { usePermissions, useQuantityFormatter, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ServiceTemplate } from "../../types";

/** The count of an embedded `(count)` relation. */
function countOf(relation: { count: number }[] | null | undefined) {
  return relation?.[0]?.count ?? 0;
}

/**
 * The service templates: a named work tree with plan lines that a new
 * service order starts from. Name, node count, and how many orders used it.
 */
const ServiceTemplatesTable = memo(
  ({ data, count }: { data: ServiceTemplate[]; count: number }) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const isFiltered = params.has("filter") || params.has("search");
    const navigate = useNavigate();
    const permissions = usePermissions();
    const formatQuantity = useQuantityFormatter();

    const columns = useMemo<ColumnDef<ServiceTemplate>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.serviceTemplate(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: { icon: <LuLayoutTemplate /> }
        },
        {
          id: "nodes",
          header: t`Elements`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatQuantity(countOf(row.original.nodes))}
            </span>
          ),
          meta: {
            icon: <LuListTree />,
            exportValue: (row) => countOf(row.nodes)
          }
        },
        {
          id: "uses",
          header: t`Service Orders`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatQuantity(countOf(row.original.uses))}
            </span>
          ),
          meta: {
            icon: <LuHash />,
            exportValue: (row) => countOf(row.uses)
          }
        }
      ],
      [t, formatQuantity]
    );

    const renderContextMenu = useCallback(
      (row: ServiceTemplate) => (
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.edit}
          onClick={() => navigate(path.to.serviceTemplate(row.id))}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Open Template</Trans>
        </MenuItem>
      ),
      [navigate]
    );

    return (
      <Table<ServiceTemplate>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "service") && (
            <New
              label={t`Service Template`}
              to={`${path.to.newServiceTemplate}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Service Templates`}
        emptyState={
          isFiltered ? undefined : (
            <Empty
              title={t`No service templates yet`}
              description={t`A template holds the elements and planned work a service order starts from.`}
            />
          )
        }
      />
    );
  }
);

ServiceTemplatesTable.displayName = "ServiceTemplatesTable";
export default ServiceTemplatesTable;
