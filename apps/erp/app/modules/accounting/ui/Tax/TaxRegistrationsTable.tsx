// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuFlag,
  LuHash,
  LuMapPin,
  LuPencil,
  LuTrash,
  LuTriangleAlert
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
  /** Countries an active tax code charges tax in, with no registration. */
  countriesWithoutRegistration: string[];
  /** Countries the company is registered in, with no active tax code. */
  countriesWithoutCode: string[];
};

/** The gaps between tax codes and registrations, behind one quiet button. */
function TaxCoverageWarnings({
  countriesWithoutRegistration,
  countriesWithoutCode
}: Pick<
  TaxRegistrationsTableProps,
  "countriesWithoutRegistration" | "countriesWithoutCode"
>) {
  const count =
    (countriesWithoutRegistration.length > 0 ? 1 : 0) +
    (countriesWithoutCode.length > 0 ? 1 : 0);
  if (count === 0) return null;

  const unregistered = countriesWithoutRegistration.join(", ");
  const uncovered = countriesWithoutCode.join(", ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuTriangleAlert className="text-orange-500" />}
        >
          <Plural value={count} one="# warning" other="# warnings" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-96">
        <PopoverHeader>
          <Trans>Tax coverage</Trans>
        </PopoverHeader>
        <div className="flex flex-col gap-3 p-4">
          {countriesWithoutRegistration.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                <Trans>No tax registration for {unregistered}</Trans>
              </span>
              <span className="text-xs text-muted-foreground">
                <Trans>
                  An active tax code charges tax in these countries, but the
                  company has no tax registration there.
                </Trans>
              </span>
            </div>
          )}
          {countriesWithoutCode.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                <Trans>No active tax code for {uncovered}</Trans>
              </span>
              <span className="text-xs text-muted-foreground">
                <Trans>
                  The company is registered in these countries, but no active
                  tax code charges tax there.
                </Trans>
              </span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const TaxRegistrationsTable = memo(
  ({
    data,
    count,
    countriesWithoutRegistration,
    countriesWithoutCode
  }: TaxRegistrationsTableProps) => {
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
              disabled={
                !permissions.has({ "accounting.taxRegistrations": "Edit" })
              }
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
              disabled={
                !permissions.has({ "accounting.taxRegistrations": "Full" })
              }
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
          permissions.has({ "accounting.taxRegistrations": "Create" }) && (
            <New label={t`Tax Registration`} to={`new?${params.toString()}`} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Tax Registrations`}
        titleBadge={
          <TaxCoverageWarnings
            countriesWithoutRegistration={countriesWithoutRegistration}
            countriesWithoutCode={countriesWithoutCode}
          />
        }
      />
    );
  }
);

TaxRegistrationsTable.displayName = "TaxRegistrationsTable";
export default TaxRegistrationsTable;
