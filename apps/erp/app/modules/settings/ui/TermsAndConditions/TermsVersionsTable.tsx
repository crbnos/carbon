import { getDocumentLabel } from "@carbon/documents/template";
import { Badge, MenuIcon, MenuItem } from "@carbon/react";
import { COUNTRY_MAP } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendarArrowDown,
  LuCalendarArrowUp,
  LuGlobe,
  LuPencil,
  LuScale,
  LuTag,
  LuText,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import type { TermsVersion } from "~/modules/settings";
import { termsDocumentTypes } from "~/modules/settings";
import { path } from "~/utils/path";

type TermsVersionsTableProps = {
  data: TermsVersion[];
  count: number;
};

const TermsVersionsTable = memo(({ data, count }: TermsVersionsTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();

  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    const scopeLabel = (row: (typeof data)[number]) => {
      const parties = [...row.customerIds, ...row.supplierIds];
      if (parties.length > 0) return t`${parties.length} specific`;
      if (row.countryCodes.length > 0)
        return row.countryCodes
          .map((code) => COUNTRY_MAP[code]?.name ?? code)
          .join(", ");
      return t`Global`;
    };

    // Display only — the resolver compares against the document's own date.
    const currentDate = today(getLocalTimeZone()).toString();
    const status = (row: (typeof data)[number]) => {
      if (!row.active)
        return { label: t`Inactive`, variant: "outline" as const };
      if (row.effectiveFrom && row.effectiveFrom > currentDate)
        return { label: t`Scheduled`, variant: "secondary" as const };
      if (row.effectiveTo && row.effectiveTo < currentDate)
        return { label: t`Expired`, variant: "destructive" as const };
      return { label: t`Active now`, variant: "green" as const };
    };

    return [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.termsVersion(row.original.id)}?${params.toString()}`}
          >
            {row.original.name}
          </Hyperlink>
        ),
        meta: {
          icon: <LuText />
        }
      },
      {
        accessorKey: "documentTypes",
        header: t`Documents`,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.documentTypes.map((documentType) => (
              <Badge key={documentType} variant="secondary">
                {getDocumentLabel(documentType)}
              </Badge>
            ))}
          </div>
        ),
        meta: {
          icon: <LuTag />,
          exportValue: (row: (typeof data)[number]) =>
            row.documentTypes.map(getDocumentLabel).join(", "),
          filter: {
            type: "static",
            options: termsDocumentTypes.map((type) => ({
              value: type,
              label: getDocumentLabel(type)
            }))
          }
        }
      },
      {
        accessorKey: "countryCodes",
        header: t`Scope`,
        cell: ({ row }) => scopeLabel(row.original),
        meta: {
          icon: <LuGlobe />,
          exportValue: (row: (typeof data)[number]) => scopeLabel(row)
        }
      },
      {
        accessorKey: "effectiveFrom",
        header: t`Effective From`,
        cell: ({ row }) =>
          row.original.effectiveFrom
            ? formatDate(row.original.effectiveFrom)
            : t`Always`,
        meta: {
          icon: <LuCalendarArrowUp />
        }
      },
      {
        accessorKey: "effectiveTo",
        header: t`Effective To`,
        cell: ({ row }) =>
          row.original.effectiveTo
            ? formatDate(row.original.effectiveTo)
            : t`Open-ended`,
        meta: {
          icon: <LuCalendarArrowDown />
        }
      },
      {
        accessorKey: "active",
        header: t`Status`,
        cell: ({ row }) => {
          const s = status(row.original);
          return <Badge variant={s.variant}>{s.label}</Badge>;
        },
        meta: {
          icon: <LuScale />,
          exportValue: (row: (typeof data)[number]) => status(row).label
        }
      }
    ];
  }, [formatDate, params, t]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "settings")}
            onClick={() => {
              navigate(`${path.to.termsVersion(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "settings")}
            onClick={() => {
              navigate(
                `${path.to.deleteTermsVersion(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete</Trans>
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "settings") && (
          <New label={t`Terms Version`} to={path.to.newTermsVersion} />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Terms & Conditions`}
    />
  );
});

TermsVersionsTable.displayName = "TermsVersionsTable";
export default TermsVersionsTable;
