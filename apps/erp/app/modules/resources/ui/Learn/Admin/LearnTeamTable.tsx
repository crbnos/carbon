import { BarProgress, HStack, MenuIcon, MenuItem, Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuBan, LuFileBadge } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { LearnTeamStatus } from "../../../learn";
import { learnTracks } from "../../../learn";

export type LearnTeamRow = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  trackSlug: string;
  trackTitle: string;
  dueDate: string | null;
  status: LearnTeamStatus;
  percent: number;
  certificateId: string | null;
  expiresAt: string | null;
};

const STATUS_COLOR: Record<
  LearnTeamStatus,
  "green" | "yellow" | "gray" | "red" | "orange"
> = {
  Certified: "green",
  "In progress": "yellow",
  "Not started": "gray",
  Expired: "red",
  Revoked: "red",
  Overdue: "orange"
};

type LearnTeamTableProps = {
  data: LearnTeamRow[];
  count: number;
  onRevoke: (row: LearnTeamRow) => void;
};

const LearnTeamTable = ({ data, count, onRevoke }: LearnTeamTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<LearnTeamRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Employee",
        cell: ({ row }) => <EmployeeAvatar employeeId={row.original.userId} />
      },
      {
        accessorKey: "trackTitle",
        header: "Track",
        cell: (item) => item.getValue<string>(),
        meta: {
          filter: {
            type: "static",
            options: learnTracks.map((track) => ({
              value: track.title,
              label: track.title
            }))
          }
        }
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (item) => {
          const status = item.getValue<LearnTeamStatus>();
          return <Status color={STATUS_COLOR[status]}>{status}</Status>;
        },
        meta: {
          filter: {
            type: "static",
            options: (Object.keys(STATUS_COLOR) as LearnTeamStatus[]).map(
              (status) => ({
                value: status,
                label: <Status color={STATUS_COLOR[status]}>{status}</Status>
              })
            )
          }
        }
      },
      {
        accessorKey: "percent",
        header: "Progress",
        cell: (item) => {
          const percent = item.getValue<number>();
          return <BarProgress progress={percent} value={`${percent}%`} />;
        },
        meta: {
          exportValue: (row: LearnTeamRow) => row.percent
        }
      },
      {
        accessorKey: "dueDate",
        header: "Due",
        cell: (item) => {
          const value = item.getValue<string | null>();
          return value ? formatDate(value) : "—";
        }
      },
      {
        accessorKey: "expiresAt",
        header: "Certificate",
        cell: ({ row }) =>
          row.original.certificateId ? (
            <Hyperlink
              to={path.to.file.learnCertificate(row.original.certificateId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {row.original.expiresAt
                ? formatDate(row.original.expiresAt.slice(0, 10))
                : t`View`}
            </Hyperlink>
          ) : (
            "—"
          ),
        meta: {
          exportValue: (row: LearnTeamRow) =>
            row.expiresAt ? row.expiresAt.slice(0, 10) : null
        }
      }
    ],
    [t]
  );

  const renderContextMenu = (row: LearnTeamRow) => {
    if (!row.certificateId || !permissions.can("update", "resources")) {
      return null;
    }
    return (
      <>
        <MenuItem asChild>
          <a
            href={path.to.file.learnCertificate(row.certificateId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MenuIcon icon={<LuFileBadge />} />
            {t`Open certificate`}
          </a>
        </MenuItem>
        {row.status !== "Revoked" && (
          <MenuItem onClick={() => onRevoke(row)}>
            <MenuIcon icon={<LuBan />} />
            {t`Revoke certificate`}
          </MenuItem>
        )}
      </>
    );
  };

  return (
    <Table<LearnTeamRow>
      data={data}
      columns={columns}
      count={count}
      title={t`Learn`}
      table="learnTeam"
      primaryAction={
        permissions.can("create", "resources") ? (
          <HStack>
            <New label={t`Assignment`} to={path.to.newLearnAssignment} />
          </HStack>
        ) : undefined
      }
      renderContextMenu={renderContextMenu}
      withSearch
    />
  );
};

export default LearnTeamTable;
