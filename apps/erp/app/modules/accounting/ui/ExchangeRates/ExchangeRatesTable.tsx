import { MenuIcon, MenuItem } from "@carbon/react";
import { formatDate, formatExchangeRate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuEuro,
  LuGlobe,
  LuPencil,
  LuPercent
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { Currency } from "../../types";
import ExchangeRateSourceBadge from "./ExchangeRateSourceBadge";

type CurrencyWithRate = Currency & {
  rate: number | null;
  rateSource: string | null;
  rateUpdatedAt: string | null;
};

type ExchangeRatesTableProps = {
  data: CurrencyWithRate[];
  count: number;
};

const ExchangeRatesTable = memo(({ data, count }: ExchangeRatesTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { locale } = useLocale();
  const customColumns = useCustomColumns<CurrencyWithRate>("currency");

  const columns = useMemo<ColumnDef<CurrencyWithRate>[]>(() => {
    const defaultColumns: ColumnDef<CurrencyWithRate>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id as string}>
            {row.original.name}
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "code",
        header: t`Code`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuEuro />
        }
      },
      {
        accessorKey: "rate",
        header: t`Exchange Rate`,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.rate != null
            ? formatExchangeRate(row.original.rate, locale)
            : null,
        meta: {
          icon: <LuPercent />
        }
      },
      {
        accessorKey: "rateSource",
        header: t`Source`,
        enableSorting: false,
        cell: ({ row }) => (
          <ExchangeRateSourceBadge source={row.original.rateSource} />
        ),
        meta: {
          icon: <LuGlobe />,
          exportValue: (row: CurrencyWithRate) => row.rateSource
        }
      },
      {
        accessorKey: "rateUpdatedAt",
        header: t`Updated`,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.rateUpdatedAt
            ? formatDate(row.original.rateUpdatedAt, undefined, locale)
            : null,
        meta: {
          icon: <LuCalendar />,
          exportValue: (row: CurrencyWithRate) =>
            row.rateUpdatedAt
              ? formatDate(row.rateUpdatedAt, undefined, locale)
              : null
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, locale, t]);

  const renderContextMenu = useCallback(
    (row: CurrencyWithRate) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => {
              navigate(
                `${path.to.exchangeRate(row.id as string)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Currency</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<CurrencyWithRate>
      data={data}
      columns={columns}
      count={count}
      renderContextMenu={renderContextMenu}
      title={t`Exchange Rates`}
    />
  );
});

ExchangeRatesTable.displayName = "ExchangeRatesTable";
export default ExchangeRatesTable;
