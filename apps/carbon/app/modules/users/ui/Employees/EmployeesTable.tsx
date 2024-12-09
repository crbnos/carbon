import {
  Checkbox,
  DropdownMenuContent,
  DropdownMenuItem,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBan,
  LuBriefcase,
  LuMail,
  LuMailCheck,
  LuPencil,
  LuShield,
  LuToggleRight,
  LuUser,
  LuUserCheck,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Employee } from "~/modules/users";
import {
  BulkEditPermissionsForm,
  DeactivateUsersModal,
  ResendInviteModal,
  RevokeInviteModal,
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
    const revokeInviteModal = useDisclosure();

    const canEdit = permissions.can("update", "users");

    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      return [
        {
          header: "User",
          cell: ({ row }) => {
            return row.original.active === true ? (
              <Hyperlink
                to={`${path.to.employeeAccount(
                  row.original.id!
                )}?${params.toString()}`}
              >
                <EmployeeAvatar size="sm" employeeId={row.original.id} />
              </Hyperlink>
            ) : (
              <div className="opacity-70">
                <EmployeeAvatar size="sm" employeeId={row.original.id} />
              </div>
            );
          },
          meta: {
            icon: <LuUser />,
          },
        },

        {
          accessorKey: "firstName",
          header: "First Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />,
          },
        },
        {
          accessorKey: "lastName",
          header: "Last Name",
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />,
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
            icon: <LuToggleRight />,
          },
        },
      ];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    const renderActions = useCallback(
      (selectedRows: typeof data) => {
        return (
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter((row) => row.active === true)
                    .map((row) => row.id!)
                );
                bulkEditDrawer.onOpen();
              }}
              disabled={
                !permissions.can("update", "users") ||
                selectedRows.every((row) => row.active === false)
              }
            >
              <LuShield className="mr-2 h-4 w-4" />
              <span>Edit Permissions</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter((row) => row.active === false)
                    .map((row) => row.id!)
                );
                resendInviteModal.onOpen();
              }}
              disabled={
                !permissions.can("create", "users") ||
                selectedRows.every((row) => row.active === true)
              }
            >
              <LuMailCheck className="mr-2 h-4 w-4" />
              <span>Resend Invite</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter((row) => row.active === true)
                    .map((row) => row.id!)
                );
                deactivateEmployeeModal.onOpen();
              }}
              disabled={
                !permissions.can("delete", "users") ||
                selectedRows.every((row) => row.active === false)
              }
            >
              <LuBan className="mr-2 h-4 w-4" />
              <span>Deactivate Users</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        );
      },
      [permissions, bulkEditDrawer, deactivateEmployeeModal, resendInviteModal]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            {row.active === true ? (
              <>
                <MenuItem
                  onClick={() =>
                    navigate(
                      `${path.to.employeeAccount(row.id!)}?${params.toString()}`
                    )
                  }
                >
                  <MenuIcon icon={<LuPencil />} />
                  Edit Permissions
                </MenuItem>
                <MenuItem
                  onClick={(e) => {
                    setSelectedUserIds([row.id!]);
                    deactivateEmployeeModal.onOpen();
                  }}
                  className="text-destructive hover:text-destructive"
                >
                  <MenuIcon icon={<LuBan />} />
                  Deactivate Account
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem
                  onClick={() => {
                    setSelectedUserIds([row.id!]);
                    resendInviteModal.onOpen();
                  }}
                >
                  <MenuIcon icon={<LuMailCheck />} />
                  Resend Account Invite
                </MenuItem>
                {permissions.can("delete", "users") && (
                  <MenuItem
                    onClick={() => {
                      setSelectedUserIds([row.id!]);
                      revokeInviteModal.onOpen();
                    }}
                    className="text-destructive hover:text-destructive"
                  >
                    <MenuIcon icon={<LuBan />} />
                    Revoke Invite
                  </MenuItem>
                )}
              </>
            )}
          </>
        );
      },
      [
        deactivateEmployeeModal,
        navigate,
        params,
        permissions,
        resendInviteModal,
        revokeInviteModal,
      ]
    );

    return (
      <>
        <Table<(typeof data)[number]>
          count={count}
          columns={columns}
          data={data}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={
            permissions.can("create", "users") && (
              <New label="Account" to={`new?${params.toString()}`} />
            )
          }
          renderActions={renderActions}
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
        {revokeInviteModal.isOpen && (
          <RevokeInviteModal
            userIds={selectedUserIds}
            isOpen={revokeInviteModal.isOpen}
            onClose={revokeInviteModal.onClose}
          />
        )}
      </>
    );
  }
);

EmployeesTable.displayName = "EmployeeTable";

export default EmployeesTable;
