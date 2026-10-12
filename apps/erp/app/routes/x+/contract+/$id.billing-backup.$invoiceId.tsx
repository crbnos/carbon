// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmployeeAvatar, Empty, Table } from "~/components";
import { useLaborCategories } from "~/components/Form";
import {
  useDateFormatter,
  usePercentFormatter,
  useQuantityFormatter,
  useRouteData
} from "~/hooks";
import type { ProjectCostType } from "~/modules/projects";
import { getProjectBillingBackup } from "~/modules/sales";
import type { ContractRouteData } from "~/modules/sales/ui/Contracts";
import { ContractMoney } from "~/modules/sales/ui/Contracts";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-billing-backup");

/** The backup of one project billing invoice: every billable item it
 *  billed, traced to its ledger row, or to its pool, fiscal year, rate and
 *  base for a burden item. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id, invoiceId } = params;
  if (!id) throw new Error("Could not find id");
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const [invoice, items] = await Promise.all([
    client
      .from("salesInvoice")
      .select("id, invoiceId, customerContractId")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .single(),
    getProjectBillingBackup(client, { companyId, salesInvoiceId: invoiceId })
  ]);
  if (invoice.error || invoice.data.customerContractId !== id || items.error) {
    logger.error("Failed to load a project billing backup", {
      companyId,
      invoiceId,
      error: invoice.error ?? items.error
    });
    throw redirect(
      path.to.contractDetails(id),
      await flash(
        request,
        error(invoice.error ?? items.error, "Failed to load the backup")
      )
    );
  }

  return { invoice: invoice.data, items: items.data };
}

type BackupRow = Awaited<ReturnType<typeof loader>>["items"][number];

export default function ContractBillingBackupRoute() {
  const { invoice, items } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const percentFormatter = usePercentFormatter();
  const categories = useLaborCategories();
  const [people] = usePeople();
  const routeData = useRouteData<ContractRouteData>(
    path.to.contract(invoice.customerContractId ?? "")
  );
  const currencyCode = routeData?.contract.currencyCode;

  const columns = useMemo<ColumnDef<BackupRow>[]>(() => {
    const categoryName = new Map(
      categories.map((category) => [category.value, category.label])
    );
    const personName = new Map(
      people.map((person) => [person.id, person.name])
    );
    const costTypeLabels: Record<ProjectCostType, string> = {
      Material: t`Material`,
      Labor: t`Labor`,
      Machine: t`Machine`,
      Overhead: t`Overhead`,
      "Outside Processing": t`Outside Processing`,
      "Purchased Service": t`Purchased Service`,
      "Other Direct": t`Other Direct`,
      "Material Variance": t`Material Variance`,
      "Payback Variance": t`Payback Variance`,
      Burden: t`Burden`
    };
    return [
      {
        id: "postingDate",
        header: t`Posted`,
        cell: ({ row }) => {
          const postingDate =
            row.original.ledger?.postingDate ?? row.original.postingDate;
          return postingDate ? formatDate(postingDate) : "—";
        },
        meta: {
          exportValue: (row) =>
            row.ledger?.postingDate ?? row.postingDate ?? null
        }
      },
      {
        id: "element",
        header: t`Element`,
        cell: ({ row }) =>
          row.original.element ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 whitespace-nowrap font-medium">
                {row.original.element.readableId}
              </span>
              <span className="truncate">{row.original.element.name}</span>
            </span>
          ) : (
            "—"
          ),
        meta: {
          exportValue: (row) =>
            row.element ? `${row.element.readableId} ${row.element.name}` : null
        }
      },
      {
        id: "costType",
        header: t`Cost Type`,
        cell: ({ row }) =>
          row.original.ledger
            ? costTypeLabels[row.original.ledger.costType]
            : row.original.pool
              ? costTypeLabels.Burden
              : "—",
        meta: {
          exportValue: (row) =>
            row.ledger
              ? costTypeLabels[row.ledger.costType]
              : row.pool
                ? costTypeLabels.Burden
                : null
        }
      },
      {
        id: "pool",
        header: t`Pool`,
        cell: ({ row }) =>
          row.original.pool
            ? `${row.original.pool.name} · FY${row.original.fiscalYear}`
            : "—",
        meta: {
          exportValue: (row) =>
            row.pool ? `${row.pool.name} FY${row.fiscalYear}` : null
        }
      },
      {
        id: "burdenRate",
        header: t`Rate`,
        cell: ({ row }) => {
          const { pool, burdenRate } = row.original;
          if (!pool || burdenRate === null) return "—";
          return pool.baseType === "Direct Labor Hours"
            ? t`${formatQuantity(Number(burdenRate))} per hour`
            : percentFormatter.format(Number(burdenRate));
        },
        meta: { exportValue: (row) => row.burdenRate ?? null }
      },
      {
        id: "burdenBase",
        header: t`Base`,
        cell: ({ row }) => {
          const { pool, burdenBase } = row.original;
          if (!pool || burdenBase === null) return "—";
          return pool.baseType === "Direct Labor Hours" ? (
            formatQuantity(Number(burdenBase))
          ) : (
            <ContractMoney
              value={Number(burdenBase)}
              currencyCode={currencyCode}
            />
          );
        },
        meta: { exportValue: (row) => row.burdenBase ?? null }
      },
      {
        id: "employee",
        header: t`Employee`,
        cell: ({ row }) =>
          row.original.ledger?.employeeId ? (
            <EmployeeAvatar employeeId={row.original.ledger.employeeId} />
          ) : (
            "—"
          ),
        meta: {
          exportValue: (row) =>
            row.ledger?.employeeId
              ? (personName.get(row.ledger.employeeId) ?? row.ledger.employeeId)
              : null
        }
      },
      {
        id: "laborCategory",
        header: t`Labor Category`,
        cell: ({ row }) =>
          row.original.ledger?.laborCategoryId
            ? (categoryName.get(row.original.ledger.laborCategoryId) ??
              row.original.ledger.laborCategoryId)
            : "—",
        meta: {
          exportValue: (row) =>
            row.ledger?.laborCategoryId
              ? (categoryName.get(row.ledger.laborCategoryId) ??
                row.ledger.laborCategoryId)
              : null
        }
      },
      {
        id: "hours",
        header: t`Hours`,
        cell: ({ row }) =>
          row.original.ledger?.costType === "Labor" &&
          row.original.ledger.quantity !== null
            ? formatQuantity(Number(row.original.ledger.quantity))
            : "—",
        meta: {
          exportValue: (row) =>
            row.ledger?.costType === "Labor" ? row.ledger.quantity : null
        }
      },
      {
        accessorKey: "description",
        header: t`Description`,
        cell: ({ row }) => (
          <span className="truncate">{row.original.description}</span>
        )
      },
      {
        accessorKey: "unitPrice",
        header: t`Unit Price`,
        cell: ({ row }) => (
          <ContractMoney
            value={row.original.unitPrice}
            currencyCode={currencyCode}
            rate
          />
        )
      },
      {
        accessorKey: "amount",
        header: t`Amount`,
        cell: ({ row }) => (
          <ContractMoney
            value={row.original.amount}
            currencyCode={currencyCode}
          />
        )
      },
      {
        id: "document",
        header: t`Document`,
        cell: ({ row }) =>
          row.original.ledger ? (
            <span className="whitespace-nowrap">
              {row.original.ledger.documentType} ·{" "}
              {row.original.ledger.documentId}
            </span>
          ) : (
            "—"
          ),
        meta: {
          exportValue: (row) =>
            row.ledger
              ? `${row.ledger.documentType} ${row.ledger.documentId}`
              : null
        }
      }
    ];
  }, [
    t,
    categories,
    people,
    currencyCode,
    formatDate,
    percentFormatter,
    formatQuantity
  ]);

  return (
    <Table<BackupRow>
      compact
      title={t`Backup for ${invoice.invoiceId}`}
      columns={columns}
      data={items}
      count={items.length}
      withPagination={false}
      withSearch={false}
      withSimpleSorting={false}
      withSidebarTrigger={false}
      emptyState={
        <Empty
          title={t`No billable items on this invoice`}
          description={null}
        />
      }
    />
  );
}
