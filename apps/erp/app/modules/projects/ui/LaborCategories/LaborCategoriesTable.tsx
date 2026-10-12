// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Checkbox,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBriefcaseBusiness,
  LuCheck,
  LuCoins,
  LuFlaskConical,
  LuPencil,
  LuText
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { useCompanyToday, useCurrencyFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { LaborCategory } from "../../types";
import { useRdActivityRoleLabels } from "../RdTax/useRdTaxLabels";

type LaborCategoryRow = LaborCategory & {
  rates?: {
    costRate: number;
    billRate: number | null;
    effectiveFrom: string;
  }[];
};

type LaborCategoriesTableProps = {
  data: LaborCategoryRow[];
  count: number;
};

/** The rate in effect on a day: the latest one that started on or before it. */
function currentRate(row: LaborCategoryRow, today: string) {
  let current: NonNullable<LaborCategoryRow["rates"]>[number] | null = null;
  for (const rate of row.rates ?? []) {
    if (rate.effectiveFrom > today) continue;
    if (!current || rate.effectiveFrom > current.effectiveFrom) current = rate;
  }
  return current;
}

const LaborCategoriesTable = memo(
  ({ data, count }: LaborCategoriesTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const today = useCompanyToday();
    const formatRate = useCurrencyFormatter({ rate: true });
    const roleLabels = useRdActivityRoleLabels();

    const columns = useMemo<ColumnDef<LaborCategoryRow>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.laborCategory(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: { icon: <LuBriefcaseBusiness /> }
        },
        {
          accessorKey: "description",
          header: t`Description`,
          cell: ({ row }) => (
            <span className="line-clamp-1">
              {row.original.description ?? ""}
            </span>
          ),
          meta: { icon: <LuText /> }
        },
        {
          id: "costRate",
          header: t`Cost Rate`,
          cell: ({ row }) => {
            const rate = currentRate(row.original, today);
            return rate ? (
              <span className="tabular-nums">
                {formatRate.format(Number(rate.costRate))}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          },
          meta: {
            icon: <LuCoins />,
            exportValue: (row) => currentRate(row, today)?.costRate ?? null
          }
        },
        {
          id: "billRate",
          header: t`Bill Rate`,
          cell: ({ row }) => {
            const billRate = currentRate(row.original, today)?.billRate;
            return billRate === null || billRate === undefined ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="tabular-nums">
                {formatRate.format(Number(billRate))}
              </span>
            );
          },
          meta: {
            icon: <LuCoins />,
            exportValue: (row) => currentRate(row, today)?.billRate ?? null
          }
        },
        {
          accessorKey: "rdActivityRole",
          header: t`Research role`,
          cell: ({ row }) =>
            row.original.rdActivityRole ? (
              roleLabels[row.original.rdActivityRole]
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            icon: <LuFlaskConical />,
            exportValue: (row) =>
              row.rdActivityRole ? roleLabels[row.rdActivityRole] : null
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: { icon: <LuCheck /> }
        }
      ],
      [t, today, formatRate, roleLabels]
    );

    const renderContextMenu = useCallback(
      (row: LaborCategoryRow) => (
        <MenuItem
          shortcut={MENU_ITEM_SHORTCUTS.edit}
          disabled={!permissions.can("update", "projects")}
          onClick={() => navigate(path.to.laborCategory(row.id))}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit Labor Category</Trans>
        </MenuItem>
      ),
      [navigate, permissions]
    );

    return (
      <Table<LaborCategoryRow>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "projects") && (
            <New label={t`Labor Category`} to={path.to.newLaborCategory} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Labor Categories`}
      />
    );
  }
);

LaborCategoriesTable.displayName = "LaborCategoriesTable";
export default LaborCategoriesTable;
