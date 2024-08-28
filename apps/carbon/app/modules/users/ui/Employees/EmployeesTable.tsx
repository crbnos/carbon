import {
  Checkbox,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { BsEnvelope, BsShieldLock } from "react-icons/bs";
import { FaBan } from "react-icons/fa";
import { LuPencil } from "react-icons/lu";
import { Avatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Employee } from "~/modules/users";
import {
  BulkEditPermissionsForm,
  DeactivateUsersModal,
  ResendInviteModal,
} from "~/modules/users";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type EmployeesTableProps = {
  data: Employee[];
  count: number;
  employeeTypes: ListItem[];
};

const defaultColumnVisibility = {
  user_firstName: false,
  user_lastName: false,
};

const EmployeesTable = memo(
  ({ data, count, employeeTypes }: EmployeesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [params] = useUrlParams();

    const employeeTypesById = useMemo(
      () =>
        employeeTypes.reduce<Record<string, ListItem>>((acc, type) => {
          acc[type.id] = type;
          return acc;
        }, {}),
      [employeeTypes]
    );

    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    const bulkEditDrawer = useDisclosure();
    const deactivateEmployeeModal = useDisclosure();
    const resendInviteModal = useDisclosure();

    const canEdit = permissions.can("update", "users");

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      return [
        {
          header: "User",
          cell: ({ row }) => (
            <HStack>
              <Avatar
                size="sm"
                name={row.original.name ?? undefined}
                path={row.original.avatarUrl ?? undefined}
              />

              <Hyperlink
                to={`${path.to.employeeAccount(
                  row.original.id!
                )}?${params.toString()}`}
              >
                {`${row.original.firstName} ${row.original.lastName}`}
              </Hyperlink>
            </HStack>
          ),
        },

        {
          accessorKey: "firstName",
          header: "First Name",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "lastName",
          header: "Last Name",
          cell: (item) => item.getValue(),
        },
        {
          accessorKey: "email",
          header: "Email",
          cell: (item) => item.getValue(),
        },
        {
          id: "employeeTypeId",
          header: "Employee Type",
          cell: ({ row }) => (
            <Enumerable
              value={
                employeeTypesById[row.original.employeeTypeId!]?.name ?? ""
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: employeeTypes.map((type) => ({
                value: type.id,
                label: <Enumerable value={type.name} />,
              })),
            },
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
                {
                  value: "true",
                  label: "Active",
                },
                {
                  value: "false",
                  label: "Inactive",
                },
              ],
            },
          },
        },
      ];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    const actions = useMemo(() => {
      return [
        {
          label: "Edit Permissions",
          icon: <BsShieldLock />,
          disabled: !permissions.can("update", "users"),
          onClick: (selected: typeof data) => {
            setSelectedUserIds(selected.map((row) => row.id!));
            bulkEditDrawer.onOpen();
          },
        },
        {
          label: "Send Account Invite",
          icon: <BsEnvelope />,
          disabled: !permissions.can("create", "users"),
          onClick: (selected: typeof data) => {
            setSelectedUserIds(selected.map((row) => row.id!));
            resendInviteModal.onOpen();
          },
        },
        {
          label: "Deactivate Users",
          icon: <FaBan />,
          disabled: !permissions.can("delete", "users"),
          onClick: (selected: typeof data) => {
            setSelectedUserIds(selected.map((row) => row.id!));
            deactivateEmployeeModal.onOpen();
          },
        },
      ];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              onClick={() =>
                navigate(
                  `${path.to.employeeAccount(row.id!)}?${params.toString()}`
                )
              }
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Employee
            </MenuItem>
            <MenuItem
              onClick={() => {
                setSelectedUserIds([row.id!]);
                resendInviteModal.onOpen();
              }}
            >
              <MenuIcon icon={<BsEnvelope />} />
              Send Account Invite
            </MenuItem>
            {row.active === true && (
              <MenuItem
                onClick={(e) => {
                  setSelectedUserIds([row.id!]);
                  deactivateEmployeeModal.onOpen();
                }}
              >
                <MenuIcon icon={<FaBan />} />
                Deactivate Employee
              </MenuItem>
            )}
          </>
        );
      },
      [deactivateEmployeeModal, navigate, params, resendInviteModal]
    );

    return (
      <>
        <Table<(typeof data)[number]>
          actions={actions}
          count={count}
          columns={columns}
          data={data}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={
            permissions.can("create", "users") && (
              <New label="Employee" to={`new?${params.toString()}`} />
            )
          }
          renderContextMenu={renderContextMenu}
          withSelectableRows={canEdit}
        />
        {bulkEditDrawer.isOpen && (
          <BulkEditPermissionsForm
            userIds={selectedUserIds}
            isOpen={bulkEditDrawer.isOpen}
            onClose={bulkEditDrawer.onClose}
          />
        )}
        {deactivateEmployeeModal.isOpen && (
          <DeactivateUsersModal
            userIds={selectedUserIds}
            isOpen={deactivateEmployeeModal.isOpen}
            onClose={deactivateEmployeeModal.onClose}
          />
        )}
        {resendInviteModal.isOpen && (
          <ResendInviteModal
            userIds={selectedUserIds}
            isOpen={resendInviteModal.isOpen}
            onClose={resendInviteModal.onClose}
          />
        )}
      </>
    );
  }
);

EmployeesTable.displayName = "EmployeeTable";

export default EmployeesTable;
