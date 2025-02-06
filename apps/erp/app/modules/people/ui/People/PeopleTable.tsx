import { Checkbox, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBriefcase,
  LuMail,
  LuPencil,
  LuToggleRight,
  LuUser,
  LuUsers,
} from "react-icons/lu";
import { Avatar, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { DataType } from "~/modules/shared";
import type { EmployeeType } from "~/modules/users";
import { path } from "~/utils/path";
import type { AttributeCategory, Person } from "../../types";

type PeopleTableProps = {
  attributeCategories: AttributeCategory[];
  data: Person[];
  count: number;
  employeeTypes: Partial<EmployeeType>[];
};

const PeopleTable = memo(
  ({ attributeCategories, data, count, employeeTypes }: PeopleTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [params] = useUrlParams();

    const employeeTypesById = useMemo(
      () =>
        employeeTypes.reduce<Record<string, Partial<EmployeeType>>>(
          (acc, type) => {
            if (type.id) acc[type.id] = type;
            return acc;
          },
          {}
        ),
      [employeeTypes]
    );

    const renderGenericAttribute = useCallback(
      (
        value?: string | number | boolean,
        dataType?: DataType,
        user?: {
          id: string;
          fullName: string | null;
          avatarUrl: string | null;
        } | null
      ) => {
        if (!value || !dataType) return null;

        if (dataType === DataType.Boolean) {
          return value === true ? "Yes" : "No";
        }

        if (dataType === DataType.Date) {
          return new Date(value as string).toLocaleDateString();
        }

        if (dataType === DataType.Numeric) {
          return Number(value).toLocaleString();
        }

        if (dataType === DataType.Text || dataType === DataType.List) {
          return value;
        }

        if (dataType === DataType.User) {
          if (!user) return null;
          return (
            <HStack>
              <Avatar
                size="sm"
                name={user.fullName ?? undefined}
                path={user.avatarUrl}
              />
              <p>{user.fullName ?? ""}</p>
            </HStack>
          );
        }

        return "Unknown";
      },
      []
    );

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
        {
          header: "User",
          cell: ({ row }) => (
            <HStack>
              <Hyperlink to={path.to.personDetails(row?.original.id!)}>
                <EmployeeAvatar size="sm" employeeId={row?.original.id} />
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuUsers />,
          },
        },

        {
          accessorKey: "firstName",
          header: "First Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "lastName",
          header: "Last Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUser />,
          },
        },
        {
          accessorKey: "email",
          header: "Email",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuMail />,
          },
        },
        {
          id: "employeeTypeId",
          header: "Employee Type",
          cell: ({ row }) => (
            <Enumerable
              value={
                employeeTypesById[row.original.employeeTypeId!].name as string
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: employeeTypes.map((type) => ({
                value: type.id!,
                label: <Enumerable value={type.name!} />,
              })),
            },
            icon: <LuBriefcase />,
          },
        },
        {
          accessorKey: "active",
          header: "Active",
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ],
            },
            icon: <LuToggleRight />,
          },
        },
      ];

      const additionalColumns: ColumnDef<(typeof data)[number]>[] = [];

      attributeCategories.forEach((category) => {
        if (category.userAttribute && Array.isArray(category.userAttribute)) {
          category.userAttribute.forEach((attribute) => {
            additionalColumns.push({
              id: attribute.id,
              header: attribute.name,
              cell: ({ row }) =>
                renderGenericAttribute(
                  row?.original?.attributes?.[attribute?.id]?.value,
                  row?.original?.attributes?.[attribute?.id]?.dataType,
                  row?.original?.attributes?.[attribute?.id]?.user
                ),
            });
          });
        }
      });

      return [...defaultColumns, ...additionalColumns];
    }, [
      attributeCategories,
      employeeTypes,
      employeeTypesById,
      renderGenericAttribute,
    ]);

    const renderContextMenu = useMemo(() => {
      return permissions.can("update", "people")
        ? (row: (typeof data)[number]) => {
            return (
              <MenuItem
                onClick={() =>
                  navigate(
                    `${path.to.personDetails(row.id!)}?${params.toString()}`
                  )
                }
              >
                <MenuIcon icon={<LuPencil />} />
                Edit Employee
              </MenuItem>
            );
          }
        : undefined;
    }, [navigate, params, permissions]);

    return (
      <>
        <Table<(typeof data)[number]>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["Select", "User"],
          }}
          primaryAction={
            permissions.can("create", "users") && (
              <New
                label="Employee"
                to={`${path.to.newEmployee}?${params.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title="Employees"
          table="employee"
          withSavedView
        />
      </>
    );
  }
);

PeopleTable.displayName = "EmployeeTable";

export default PeopleTable;
