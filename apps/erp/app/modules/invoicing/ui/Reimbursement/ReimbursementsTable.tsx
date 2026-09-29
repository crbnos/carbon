import type { Database } from "@carbon/database";
import { formatDate, formatMoney } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuCircleDot,
  LuCoins,
  LuCreditCard,
  LuHash,
  LuTag,
  LuUser
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { useCurrencyDecimalsLookup } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { reimbursementStatus } from "../../invoicing.models";
import ReimbursementStatus from "./ReimbursementStatus";

type ReimbursementRow = Database["public"]["Tables"]["reimbursement"]["Row"];

type ReimbursementsTableProps = {
  data: ReimbursementRow[];
  count: number;
};

const ReimbursementsTable = memo(
  ({ data, count }: ReimbursementsTableProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    // Each reimbursement carries its own currencyCode, so the amount is
    // formatted per row from a decimals lookup rather than a single-currency
    // hook — and there is no cross-currency total, which would sum unlike
    // units into a meaningless number.
    const currencyDecimals = useCurrencyDecimalsLookup();
    const [people] = usePeople();

    const columns = useMemo<ColumnDef<ReimbursementRow>[]>(
      () => [
        {
          accessorKey: "reimbursementId",
          header: t`Reimbursement ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.reimbursement(row.original.id)}>
              {row.original.reimbursementId}
            </Hyperlink>
          ),
          meta: { icon: <LuHash /> }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <ReimbursementStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuCircleDot />,
            filter: {
              type: "static",
              options: reimbursementStatus.map((status) => ({
                value: status,
                label: <ReimbursementStatus status={status} />
              }))
            },
            pluralHeader: t`Statuses`
          }
        },
        {
          accessorKey: "employeeId",
          header: t`Employee`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.employeeId} />
          ),
          meta: {
            icon: <LuUser />,
            filter: {
              type: "static",
              options: people.map((employee) => ({
                value: employee.id,
                label: employee.name
              }))
            },
            pluralHeader: t`Employees`
          }
        },
        {
          accessorKey: "reimbursementDate",
          header: t`Date`,
          cell: (item) =>
            formatDate(item.getValue<string>(), undefined, locale),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "reference",
          header: t`Reference`,
          cell: ({ row }) => row.original.reference ?? null,
          meta: { icon: <LuTag /> }
        },
        {
          accessorKey: "amount",
          header: t`Amount`,
          cell: ({ row }) => {
            const code = row.original.currencyCode || "USD";
            return (
              <span className="tabular-nums">
                {formatMoney(
                  row.original.amount,
                  locale,
                  code,
                  currencyDecimals(code)
                )}
              </span>
            );
          },
          meta: { icon: <LuCoins /> }
        },
        {
          accessorKey: "journalId",
          header: t`Journal`,
          cell: ({ row }) => row.original.journalId ?? null,
          meta: { icon: <LuCreditCard /> }
        }
      ],
      [t, locale, currencyDecimals, people]
    );

    return (
      <Table<ReimbursementRow>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{ left: ["reimbursementId"] }}
        defaultColumnVisibility={{
          journalId: false
        }}
        title={t`Reimbursements`}
        table="reimbursement"
        withSavedView
      />
    );
  }
);

ReimbursementsTable.displayName = "ReimbursementsTable";

export default ReimbursementsTable;
