import { MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBuilding,
  LuCalendar,
  LuClock,
  LuEye,
  LuFileText,
  LuHash,
  LuTriangleAlert
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import {
  ediDocumentDirectionType,
  ediDocumentStatusType,
  ediDocumentTypeType
} from "../../sales.models";
import type { EdiDocumentListItem } from "../../types";
import EdiDocumentStatus from "./EdiDocumentStatus";

type EdiDocumentsTableProps = {
  data: EdiDocumentListItem[];
  count: number;
};

const EdiDocumentsTable = memo(({ data, count }: EdiDocumentsTableProps) => {
  const [params] = useUrlParams();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<EdiDocumentListItem>[]>(() => {
    return [
      {
        accessorKey: "id",
        header: t`Document`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.ediDocument(row.original.id)}>
            {row.original.id}
          </Hyperlink>
        ),
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "direction",
        header: t`Direction`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: ediDocumentDirectionType.map((type) => ({
              value: type,
              label: <Enumerable value={type} />
            }))
          },
          icon: <LuFileText />
        }
      },
      {
        accessorKey: "documentType",
        header: t`Type`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "static",
            options: ediDocumentTypeType.map((type) => ({
              value: type,
              label: <Enumerable value={type} />
            }))
          },
          icon: <LuFileText />
        }
      },
      {
        id: "customer",
        header: t`Customer`,
        cell: ({ row }) =>
          row.original.ediTradingPartner?.customer?.name ?? null,
        meta: {
          icon: <LuBuilding />
        }
      },
      {
        accessorKey: "partnerReference",
        header: t`Partner Reference`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: (item) => (
          <EdiDocumentStatus
            status={item.getValue<(typeof ediDocumentStatusType)[number]>()}
          />
        ),
        meta: {
          filter: {
            type: "static",
            options: ediDocumentStatusType.map((type) => ({
              value: type,
              label: <EdiDocumentStatus status={type} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuClock />
        }
      },
      {
        id: "issues",
        header: t`Issues`,
        cell: ({ row }) => {
          const issues = row.original.issues;
          const length = Array.isArray(issues) ? issues.length : 0;
          return <span className="tabular-nums">{length}</span>;
        },
        meta: {
          icon: <LuTriangleAlert />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
  }, [t, formatDate]);

  const renderContextMenu = useCallback(
    (row: EdiDocumentListItem) => {
      return (
        <MenuItem
          onClick={() => {
            navigate(`${path.to.ediDocument(row.id)}?${params.toString()}`);
          }}
        >
          <MenuIcon icon={<LuEye />} />
          {t`View Document`}
        </MenuItem>
      );
    },
    [navigate, params, t]
  );

  return (
    <Table<EdiDocumentListItem>
      data={data}
      columns={columns}
      count={count}
      defaultColumnPinning={{
        left: ["id"]
      }}
      renderContextMenu={renderContextMenu}
      title={t`EDI Documents`}
      table="ediDocument"
      withSavedView
    />
  );
});

EdiDocumentsTable.displayName = "EdiDocumentsTable";
export default EdiDocumentsTable;
