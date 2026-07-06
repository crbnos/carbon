import { Badge, Checkbox, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBriefcase,
  LuMail,
  LuMapPin,
  LuPencil,
  LuToggleRight,
  LuUser,
  LuUserCheck,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Avatar, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
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
    const { t } = useLingui();
    const { locale } = useLocale();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const locations = useLocations();
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
          return new Date(value as string).toLocaleDateString(locale);
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
      [locale]
    );

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
        {
          header: t`User`,
          cell: ({ row }) => (
            <HStack>
              <Hyperlink to={path.to.personDetails(row?.original.id!)}>
                <EmployeeAvatar size="sm" employeeId={row?.original.id} />
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuUsers />
          }
        },

        {
          accessorKey: "firstName",
          header: t`First Name`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUser />
          }
        },
        {
          accessorKey: "lastName",
          header: t`Last Name`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUser />
          }
        },
        {
          accessorKey: "email",
          header: t`Email`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuMail />
          }
        },
        {
          id: "employeeTypeId",
          header: t`Employee Type`,
          cell: ({ row }) => (
            <Enumerable
              value={
                employeeTypesById[row.original.employeeTypeId ?? ""]
                  ?.name as string
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: employeeTypes.map((type) => ({
                value: type.id!,
                label: <Enumerable value={type.name!} />
              }))
            },
            icon: <LuBriefcase />
          }
        },
        {
          id: "locationId",
          header: t`Location`,
          cell: ({ row }) => <Enumerable value={row.original.locationName} />,
          meta: {
            filter: {
              type: "static",
              options: locations.map((location) => ({
                value: location.value,
                label: <Enumerable value={location.label} />
              }))
            },
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: (item) => {
            const status = item.getValue<
              "Active" | "Invited" | "Inactive" | null
            >();
            if (status === "Active")
              return <Badge variant="green">{t`Active`}</Badge>;
            if (status === "Invited")
              return <Badge variant="yellow">{t`Invited`}</Badge>;
            return <Badge variant="secondary">{t`Inactive`}</Badge>;
          },
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "Active", label: t`Active` },
                { value: "Invited", label: t`Invited` },
                { value: "Inactive", label: t`Inactive` }
              ]
            },
            icon: <LuUserCheck />
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            icon: <LuToggleRight />
          }
        }
      ];

      const additionalColumns: ColumnDef<(typeof data)[number]>[] = [];

      attributeCategories.forEach((category) => {
        if (category.userAttribute && Array.isArray(category.userAttribute)) {
          category.userAttribute.forEach((attribute) => {
            additionalColumns.push({
              id: attribute.id,
              header: attribute?.name ?? "",
              cell: ({ row }) =>
                renderGenericAttribute(
                  row?.original?.attributes?.[attribute?.id]?.value,
                  row?.original?.attributes?.[attribute?.id]?.dataType,
                  row?.original?.attributes?.[attribute?.id]?.user
                )
            });
          });
        }
      });

      return [...defaultColumns, ...additionalColumns];
    }, [
      attributeCategories,
      employeeTypes,
      employeeTypesById,
      locations,
      renderGenericAttribute,
      t
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
                <Trans>Edit Employee</Trans>
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
            left: ["Select", "User"]
          }}
          primaryAction={
            permissions.can("create", "users") && (
              <New
                label={t`Employee`}
                to={`${path.to.newEmployee}?${params.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Employees`}
          table="employee"
          withSavedView
        />
      </>
    );
  }
);

PeopleTable.displayName = "EmployeeTable";

export default PeopleTable;
