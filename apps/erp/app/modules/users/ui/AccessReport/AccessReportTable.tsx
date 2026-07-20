import { Badge, Checkbox, HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBriefcase,
  LuMail,
  LuShield,
  LuToggleRight,
  LuUser,
  LuUserCheck
} from "react-icons/lu";
import { Table } from "~/components";
import type { UserAccessReportRow } from "~/modules/users";

type AccessReportTableProps = {
  data: UserAccessReportRow[];
  count: number;
};

const AccessReportTable = memo(({ data, count }: AccessReportTableProps) => {
  const { t } = useLingui();

  const columns = useMemo<ColumnDef<UserAccessReportRow>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: t`User`,
        cell: (item) => item.getValue(),
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "email",
        header: t`Email`,
        cell: (item) => item.getValue(),
        meta: { icon: <LuMail /> }
      },
      {
        accessorKey: "employeeType",
        header: t`Employee Type`,
        cell: (item) => item.getValue(),
        meta: { icon: <LuBriefcase /> }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: (item) => {
          const status = item.getValue<string>();
          if (status === "Active")
            return <Badge variant="green">{status}</Badge>;
          if (status === "Invited")
            return <Badge variant="yellow">{status}</Badge>;
          return <Badge variant="secondary">{status || t`Inactive`}</Badge>;
        },
        meta: { icon: <LuUserCheck /> }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: { icon: <LuToggleRight /> }
      },
      {
        accessorKey: "permissions",
        header: t`Permissions`,
        cell: ({ row }) => {
          const permissions = row.original.permissions;
          if (!permissions.length)
            return <span className="text-muted-foreground">—</span>;
          return (
            <HStack spacing={1} className="flex-wrap">
              {permissions.map((permission) => (
                <Badge key={permission} variant="secondary">
                  {permission}
                </Badge>
              ))}
            </HStack>
          );
        },
        meta: {
          icon: <LuShield />,
          exportValue: (row: UserAccessReportRow) => row.permissions.join("; ")
        }
      }
    ];
  }, [t]);

  return (
    <Table<UserAccessReportRow>
      count={count}
      columns={columns}
      data={data}
      title={t`Access Report`}
    />
  );
});

AccessReportTable.displayName = "AccessReportTable";

export default AccessReportTable;
