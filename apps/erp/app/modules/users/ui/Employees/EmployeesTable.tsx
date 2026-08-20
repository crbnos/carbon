import {
  Badge,
  Checkbox,
  DropdownMenuContent,
  DropdownMenuItem,
  MenuIcon,
  MenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBan,
  LuBriefcase,
  LuMail,
  LuMailCheck,
  LuPencil,
  LuShield,
  LuShieldCheck,
  LuShieldOff,
  LuToggleRight,
  LuUser,
  LuUserCheck
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import type { Employee } from "~/modules/users";
import {
  BulkEditPermissionsForm,
  DeactivateUsersModal,
  ResendInviteModal,
  RevokeInviteModal
} from "~/modules/users";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type EmployeesTableProps = {
  data: Employee[];
  count: number;
  employeeTypes: ListItem[];
  unrevokedInviteEmails: string[];
  mfaEnrolledUserIds: string[];
};

const defaultColumnVisibility = {
  user_firstName: false,
  user_lastName: false
};

const EmployeesTable = memo(
  ({
    data,
    count,
    employeeTypes,
    unrevokedInviteEmails,
    mfaEnrolledUserIds
  }: EmployeesTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const settings = useSettings();
    const [params] = useUrlParams();
    const { id: currentUserId } = useUser();

    const employeeTypesById = useMemo(
      () =>
        employeeTypes.reduce<Record<string, ListItem>>((acc, type) => {
          acc[type.id] = type;
          return acc;
        }, {}),
      [employeeTypes]
    );

    const unrevokedInviteSet = useMemo(
      () => new Set(unrevokedInviteEmails),
      [unrevokedInviteEmails]
    );

    const requireMfa = settings.requireMfa === true;

    const mfaEnrolledSet = useMemo(
      () => new Set(mfaEnrolledUserIds),
      [mfaEnrolledUserIds]
    );

    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    const bulkEditDrawer = useDisclosure();
    const deactivateEmployeeModal = useDisclosure();
    const resendInviteModal = useDisclosure();
    const revokeInviteModal = useDisclosure();

    const canEdit = permissions.can("update", "users");

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      return [
        {
          header: t`User`,
          cell: ({ row }) => (
            <Hyperlink
              className={row.original.active === true ? "" : "opacity-70"}
              to={`${path.to.employeeAccount(
                row.original.id!
              )}?${params.toString()}`}
            >
              <EmployeeAvatar size="sm" employeeId={row.original.id} />
            </Hyperlink>
          ),

          meta: {
            icon: <LuUser />
          }
        },

        {
          accessorKey: "firstName",
          header: t`First Name`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />
          }
        },
        {
          accessorKey: "lastName",
          header: t`Last Name`,
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuUserCheck />
          }
        },
        {
          accessorKey: "email",
          header: t`Email`,
          cell: (item) => {
            const email = item.getValue<string>();
            if (email?.endsWith("@console.internal")) {
              return (
                <Badge variant="secondary">
                  <Trans>Console Operator</Trans>
                </Badge>
              );
            }
            return email;
          },
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
                employeeTypesById[row.original.employeeTypeId!]?.name ?? ""
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: employeeTypes.map((type) => ({
                value: type.id,
                label: <Enumerable value={type.name} />
              }))
            },
            icon: <LuBriefcase />
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
        // Only meaningful once the company enforces it; otherwise the column
        // is a wall of "Not set up" for a policy nobody opted into.
        ...(requireMfa
          ? ([
              {
                id: "mfa",
                header: t`Two-Factor`,
                cell: ({ row }) => {
                  // Console operators cannot sign in, so 2FA is not applicable.
                  if (row.original.email?.endsWith("@console.internal")) {
                    return null;
                  }
                  return mfaEnrolledSet.has(row.original.id!) ? (
                    <Badge variant="green">{t`Enabled`}</Badge>
                  ) : (
                    <Badge variant="secondary">{t`Not set up`}</Badge>
                  );
                },
                meta: {
                  icon: <LuShieldCheck />,
                  exportValue: (row: (typeof data)[number]) =>
                    mfaEnrolledSet.has(row.id!) ? "Enabled" : "Not set up"
                }
              }
            ] as ColumnDef<(typeof data)[number]>[])
          : []),
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => {
            const isActive = item.getValue<boolean>();
            const status = item.row.original.status;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-fit">
                    <Checkbox isChecked={isActive} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {isActive ? (
                    <Trans>
                      To deactivate, use the row menu and choose Deactivate
                      Account.
                    </Trans>
                  ) : status === "Invited" ? (
                    <Trans>
                      An invitation is pending. They become active once they
                      accept it.
                    </Trans>
                  ) : (
                    <Trans>
                      To reactivate, use the row menu and choose Send Invite.
                      The employee becomes active once they accept.
                    </Trans>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          },
          meta: {
            icon: <LuToggleRight />
          }
        }
      ];
    }, [params, mfaEnrolledSet, requireMfa]);

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
              <span>
                <Trans>Edit Permissions</Trans>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter(
                      (row) =>
                        row.active === false &&
                        !!row.email &&
                        !unrevokedInviteSet.has(row.email)
                    )
                    .map((row) => row.id!)
                );
                resendInviteModal.onOpen();
              }}
              disabled={
                !permissions.can("create", "users") ||
                !selectedRows.some(
                  (row) =>
                    row.active === false &&
                    !!row.email &&
                    !unrevokedInviteSet.has(row.email)
                )
              }
            >
              <LuMailCheck className="mr-2 h-4 w-4" />
              <span>
                <Trans>Send Invite</Trans>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSelectedUserIds(
                  selectedRows
                    .filter(
                      (row) => row.active === true && row.id !== currentUserId
                    )
                    .map((row) => row.id!)
                );
                deactivateEmployeeModal.onOpen();
              }}
              disabled={
                !permissions.can("delete", "users") ||
                !selectedRows.some(
                  (row) => row.active === true && row.id !== currentUserId
                )
              }
            >
              <LuBan className="mr-2 h-4 w-4" />
              <span>
                <Trans>Deactivate Users</Trans>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        );
      },
      [
        permissions,
        bulkEditDrawer,
        deactivateEmployeeModal,
        resendInviteModal,
        unrevokedInviteSet,
        currentUserId
      ]
    );

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        const hasUnrevokedInvite =
          !!row.email && unrevokedInviteSet.has(row.email);
        const isSelf = row.id === currentUserId;
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
                  <Trans>Edit Permissions</Trans>
                </MenuItem>
                {settings.consoleEnabled && (
                  <MenuItem
                    onClick={() =>
                      navigate(
                        `${path.to.operatorResetPin(row.id!)}?${params.toString()}`
                      )
                    }
                  >
                    <MenuIcon icon={<LuShield />} />
                    <Trans>Set Console PIN</Trans>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() =>
                    navigate(
                      `${path.to.employeeResetMfa(row.id!)}?${params.toString()}`
                    )
                  }
                >
                  <MenuIcon icon={<LuShieldOff />} />
                  <Trans>Reset Two-Factor Auth</Trans>
                </MenuItem>
                {!isSelf && (
                  <MenuItem
                    onClick={(e) => {
                      setSelectedUserIds([row.id!]);
                      deactivateEmployeeModal.onOpen();
                    }}
                    destructive
                  >
                    <MenuIcon icon={<LuBan />} />
                    <Trans>Deactivate Account</Trans>
                  </MenuItem>
                )}
              </>
            ) : hasUnrevokedInvite ? (
              permissions.can("delete", "users") && (
                <MenuItem
                  onClick={() => {
                    setSelectedUserIds([row.id!]);
                    revokeInviteModal.onOpen();
                  }}
                  destructive
                >
                  <MenuIcon icon={<LuBan />} />
                  <Trans>Revoke Invite</Trans>
                </MenuItem>
              )
            ) : (
              <MenuItem
                onClick={() => {
                  setSelectedUserIds([row.id!]);
                  resendInviteModal.onOpen();
                }}
              >
                <MenuIcon icon={<LuMailCheck />} />
                <Trans>Send Invite</Trans>
              </MenuItem>
            )}
          </>
        );
      },
      [
        currentUserId,
        deactivateEmployeeModal,
        navigate,
        params,
        permissions,
        resendInviteModal,
        revokeInviteModal,
        settings.consoleEnabled,
        unrevokedInviteSet
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
              <New label={t`Account`} to={`new?${params.toString()}`} />
            )
          }
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          title={t`Employee Accounts`}
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
