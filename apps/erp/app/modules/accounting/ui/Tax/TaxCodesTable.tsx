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
  LuBookMarked,
  LuCalculator,
  LuCheck,
  LuPencil,
  LuPercent,
  LuTag,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import {
  useCompanyToday,
  usePercentFormatter,
  usePermissions,
  useUrlParams
} from "~/hooks";
import { path } from "~/utils/path";
import {
  taxCalculationTypes,
  taxReportingCategories
} from "../../accounting.models";
import type { getTaxCodes } from "../../accounting.service";
import { taxCodeRate, toTaxCodeInput } from "../../accounting.utils";

type TaxCode = NonNullable<
  Awaited<ReturnType<typeof getTaxCodes>>["data"]
>[number];

type TaxCodesTableProps = {
  data: TaxCode[];
  count: number;
};

const booleanFilterOptions = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" }
];

const TaxCodesTable = memo(({ data, count }: TaxCodesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const today = useCompanyToday();
  const percentFormatter = usePercentFormatter();

  const columns = useMemo<ColumnDef<TaxCode>[]>(() => {
    const defaultColumns: ColumnDef<TaxCode>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={`${row.original.id}?${params.toString()}`}>
            {row.original.name}
          </Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuBookMarked />
        }
      },
      {
        id: "rate",
        header: t`Rate`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {percentFormatter.format(
              taxCodeRate(toTaxCodeInput(row.original), today)
            )}
          </span>
        ),
        meta: {
          mobile: "P2",
          icon: <LuPercent />
        }
      },
      {
        accessorKey: "calculationType",
        header: t`Calculation Type`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: taxCalculationTypes.map((v) => ({
              label: <Enumerable value={v} />,
              value: v
            }))
          },
          icon: <LuCalculator />
        }
      },
      {
        accessorKey: "reportingCategory",
        header: t`Reporting Category`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          mobile: "P3",
          filter: {
            type: "static",
            options: taxReportingCategories.map((v) => ({
              label: <Enumerable value={v} />,
              value: v
            }))
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "taxesShipping",
        header: t`Taxes Shipping`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: booleanFilterOptions
          },
          icon: <LuTruck />
        }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: booleanFilterOptions
          },
          icon: <LuCheck />
        }
      }
    ];
    return defaultColumns;
  }, [params, percentFormatter, t, today]);

  const renderContextMenu = useCallback(
    (row: TaxCode) => {
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.edit}
            disabled={!permissions.can("update", "accounting")}
            onClick={() => {
              navigate(`${path.to.taxCode(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Tax Code</Trans>
          </MenuItem>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            disabled={!row.active || !permissions.can("delete", "accounting")}
            onClick={() => {
              navigate(`${path.to.deleteTaxCode(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Retire Tax Code</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<TaxCode>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "accounting") && (
          <New label={t`Tax Code`} to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Tax Codes`}
    />
  );
});

TaxCodesTable.displayName = "TaxCodesTable";
export default TaxCodesTable;
