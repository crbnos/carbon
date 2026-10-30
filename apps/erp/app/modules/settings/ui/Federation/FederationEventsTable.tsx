// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuCircleAlert,
  LuCircleCheck,
  LuFingerprint,
  LuGlobe,
  LuKeyRound,
  LuNetwork,
  LuTag
} from "react-icons/lu";
import { DateTime, Hyperlink, Table } from "~/components";
import type { InfiniteOptions } from "~/components/Table";
import type { FederationExchangeRow } from "~/modules/settings/types";
import { path } from "~/utils/path";

type FederationEventsTableProps = {
  data: FederationExchangeRow[];
  count: number;
  infinite: InfiniteOptions;
};

/** Every exchange attempt for a known rule, newest first, kept 30 days. */
const FederationEventsTable = memo(
  ({ data, count, infinite }: FederationEventsTableProps) => {
    const { t } = useLingui();

    const columns = useMemo<ColumnDef<FederationExchangeRow>[]>(() => {
      return [
        {
          accessorKey: "createdAt",
          header: t`Time`,
          cell: (item) => <DateTime value={item.getValue<string>()} />,
          meta: {
            mobile: "P1",
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "outcome",
          header: t`Outcome`,
          cell: ({ row }) =>
            row.original.outcome === "Succeeded" ? (
              <Badge variant="green">{t`Succeeded`}</Badge>
            ) : (
              <Badge variant="destructive">{t`Refused`}</Badge>
            ),
          meta: {
            mobile: "P2",
            icon: <LuCircleCheck />,
            filter: {
              type: "static",
              options: [
                { value: "Succeeded", label: t`Succeeded` },
                { value: "Refused", label: t`Refused` }
              ]
            }
          }
        },
        {
          accessorKey: "reason",
          header: t`Reason`,
          cell: ({ row }) => (
            <span className="font-mono text-sm">
              {row.original.reason ?? ""}
            </span>
          ),
          meta: {
            icon: <LuCircleAlert />
          }
        },
        {
          id: "rule",
          header: t`Rule`,
          cell: ({ row }) =>
            row.original.federationRule ? (
              <Hyperlink
                to={path.to.federationRule(row.original.federationRule.id)}
              >
                {row.original.federationRule.name}
              </Hyperlink>
            ) : null,
          meta: {
            icon: <LuTag />,
            exportValue: (row) => row.federationRule?.name ?? null
          }
        },
        {
          id: "issuer",
          header: t`Issuer`,
          cell: ({ row }) => row.original.federationIssuer?.name ?? "",
          meta: {
            icon: <LuGlobe />,
            exportValue: (row) => row.federationIssuer?.name ?? null
          }
        },
        {
          accessorKey: "subject",
          header: t`Subject`,
          cell: ({ row }) => (
            <span className="font-mono text-sm">
              {row.original.subject ?? ""}
            </span>
          ),
          meta: {
            icon: <LuFingerprint />
          }
        },
        {
          accessorKey: "clientIp",
          header: t`Client IP`,
          cell: ({ row }) => (
            <span className="font-mono text-sm text-muted-foreground">
              {row.original.clientIp ?? ""}
            </span>
          ),
          meta: {
            icon: <LuNetwork />
          }
        },
        {
          accessorKey: "apiKeyId",
          header: t`API Key`,
          cell: ({ row }) => (
            <span className="font-mono text-sm text-muted-foreground">
              {row.original.apiKeyId ?? ""}
            </span>
          ),
          meta: {
            icon: <LuKeyRound />
          }
        }
      ];
    }, [t]);

    return (
      <Table<FederationExchangeRow>
        data={data}
        infinite={infinite}
        columns={columns}
        count={count ?? 0}
        title={t`Authentication Events`}
      />
    );
  }
);

FederationEventsTable.displayName = "FederationEventsTable";
export default FederationEventsTable;
