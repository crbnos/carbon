import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBadgeCheck,
  LuCalendarClock,
  LuCalendarX,
  LuLogIn,
  LuMail,
  LuUser
} from "react-icons/lu";
import { Table } from "~/components";

export type ItarCertificationReportRow = {
  id: string | null;
  name: string | null;
  email: string | null;
  certVersion: string | null;
  certifiedAt: string | null;
  expiresAt: string | null;
  lastLogin: string | null;
};

type ItarCertificationsTableProps = {
  data: ItarCertificationReportRow[];
  count: number;
};

const dash = "—";

const ItarCertificationsTable = memo(
  ({ data, count }: ItarCertificationsTableProps) => {
    const { t } = useLingui();

    const columns = useMemo<ColumnDef<ItarCertificationReportRow>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: (item) => item.getValue() ?? dash,
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "email",
          header: t`Email`,
          cell: (item) => item.getValue() ?? dash,
          meta: { icon: <LuMail /> }
        },
        {
          accessorKey: "lastLogin",
          header: t`Last Login`,
          cell: ({ row }) =>
            row.original.lastLogin
              ? formatDate(row.original.lastLogin)
              : t`Never`,
          meta: { icon: <LuLogIn /> }
        },
        {
          accessorKey: "certVersion",
          header: t`Cert Version`,
          cell: ({ row }) => row.original.certVersion ?? t`Not certified`,
          meta: { icon: <LuBadgeCheck /> }
        },
        {
          accessorKey: "certifiedAt",
          header: t`Certified`,
          cell: ({ row }) =>
            row.original.certifiedAt
              ? formatDate(row.original.certifiedAt)
              : dash,
          meta: { icon: <LuCalendarClock /> }
        },
        {
          accessorKey: "expiresAt",
          header: t`Expires`,
          cell: ({ row }) =>
            row.original.expiresAt ? formatDate(row.original.expiresAt) : dash,
          meta: { icon: <LuCalendarX /> }
        }
      ];
    }, [t]);

    return (
      <Table<ItarCertificationReportRow>
        data={data}
        columns={columns}
        count={count}
        title={t`ITAR Certifications`}
      />
    );
  }
);

ItarCertificationsTable.displayName = "ItarCertificationsTable";
export default ItarCertificationsTable;
