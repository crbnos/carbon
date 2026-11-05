// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuFlag,
  LuHash,
  LuMapPin,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { getTaxRegistrations } from "../../accounting.service";

type TaxRegistration = NonNullable<
  Awaited<ReturnType<typeof getTaxRegistrations>>["data"]
>[number];

type TaxRegistrationsTableProps = {
  data: TaxRegistration[];
  count: number;
};

const TaxRegistrationsTable = memo(
  ({ data, count }: TaxRegistrationsTableProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const customColumns = useCustomColumns<TaxRegistration>("taxRegistration");

    const columns = useMemo<ColumnDef<TaxRegistration>[]>(() => {
      const defaultColumns: ColumnDef<TaxRegistration>[] = [
        {
          accessorKey: "registrationNumber",
          header: t`Registration Number`,
          cell: ({ row }) => (
            <Hyperlink to={`${row.original.id}?${params.toString()}`}>
              {row.original.registrationNumber}
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuHash />
          }
        },
        {
          accessorKey: "countryCode",
          header: t`Country`,
          cell: ({ row }) => (
            <Enumerable
              value={row.original.country?.name ?? row.original.countryCode}
            />
          ),
          meta: {
            mobile: "P2",
            icon: <LuFlag />
          }
        },
        {
          accessorKey: "state",
          header: t`State`,
          cell: (item) => item.getValue<string | null>() ?? "",
          meta: {
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "effectiveDate",
          header: t`Effective`,
          cell: (item) =>
            formatDate(item.getValue<string | null>(), undefined, locale),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "endDate",
          header: t`End`,
          cell: (item) =>
            formatDate(item.getValue<string | null>(), undefined, locale),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [params, customColumns, locale, t]);

    const renderContextMenu = useCallback(
      (row: TaxRegistration) => {
        return (
          <>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              disabled={!permissions.can("update", "accounting")}
              onClick={() => {
                navigate(
                  `${path.to.taxRegistration(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>Edit Tax Registration</Trans>
            </MenuItem>
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={!permissions.can("delete", "accounting")}
              onClick={() => {
                navigate(
                  `${path.to.deleteTaxRegistration(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Tax Registration</Trans>
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<TaxRegistration>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <New label={t`Tax Registration`} to={`new?${params.toString()}`} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Tax Registrations`}
      />
    );
  }
);

TaxRegistrationsTable.displayName = "TaxRegistrationsTable";
export default TaxRegistrationsTable;
