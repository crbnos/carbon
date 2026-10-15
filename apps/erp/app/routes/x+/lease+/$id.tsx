// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useMatches, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import {
  getLease,
  getLeaseEvents,
  getLeaseLines,
  getLeasePayments,
  getLeaseRelatedDocuments,
  getLeaseSchedule
} from "~/modules/purchasing";
import { leaseOpeningAsOf } from "~/modules/purchasing/purchasing.server";
import type {
  LeaseFixedAssets,
  LeasePaymentInvoiceLinks,
  LeaseRouteData
} from "~/modules/purchasing/ui/Leases";
import {
  LeaseExplorer,
  LeaseHeader,
  LeaseProperties
} from "~/modules/purchasing/ui/Leases";
import { getDatabaseClient } from "~/services/database.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "lease");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Leases`, to: path.to.leases },
    (data) => data?.lease?.leaseId
  ),
  module: "purchasing"
};

export async function loader({
  request,
  params
}: LoaderFunctionArgs): Promise<LeaseRouteData> {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lease = await getLease(client, id, companyId);
  if (lease.error || !lease.data) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Failed to load lease"))
    );
  }
  if (lease.data.companyId !== companyId) {
    throw redirect(path.to.leases);
  }

  const [lines, payments, schedule, events, related, settings] =
    await Promise.all([
      getLeaseLines(client, id, companyId),
      getLeasePayments(client, id, companyId),
      getLeaseSchedule(client, id, companyId),
      getLeaseEvents(client, id, companyId),
      getLeaseRelatedDocuments(client, id, companyId),
      client
        .from("companySettings")
        .select(
          "leaseMajorPartThresholdPercent, leaseSubstantiallyAllThresholdPercent, leaseShortTermExpedient, accountingCutoverDate"
        )
        .eq("id", companyId)
        .maybeSingle()
    ]);

  for (const [name, result] of [
    ["assets", lines],
    ["payments", payments],
    ["schedule", schedule],
    ["events", events],
    ["related documents", related],
    ["lease policy", settings]
  ] as const) {
    if (result.error) {
      // A failed read leaves its section empty rather than failing the page.
      logger.error("Lease {section} read failed", {
        section: name,
        companyId,
        leaseId: id,
        error: result.error
      });
    }
  }

  // A Draft that commenced before the accounting cutover opens with a
  // balance on this date: its Skipped payment check needs it.
  const accountingCutoverDate = settings.data?.accountingCutoverDate ?? null;
  let openingAsOf: string | null = null;
  if (
    lease.data.status === "Draft" &&
    accountingCutoverDate &&
    lease.data.commencementDate &&
    lease.data.commencementDate < accountingCutoverDate
  ) {
    try {
      openingAsOf = await leaseOpeningAsOf(getDatabaseClient(), {
        companyId,
        cutoverDate: accountingCutoverDate
      });
    } catch (err) {
      // The UI falls back to the cutover itself.
      logger.error("Lease opening balance date read failed", {
        companyId,
        leaseId: id,
        error: err
      });
    }
  }

  const purchaseInvoices = related.data?.purchaseInvoices ?? [];
  const journals = related.data?.journals ?? [];

  // `leasePayment.purchaseInvoiceLineId` is read in one batch to name the
  // invoice behind each invoiced row.
  const invoiceLineIds = [
    ...new Set(
      (payments.data ?? [])
        .map((payment) => payment.purchaseInvoiceLineId)
        .filter((lineId): lineId is string => Boolean(lineId))
    )
  ];
  const fixedAssetIds = [
    ...new Set(
      [
        ...(lines.data ?? []).map((line) => line.fixedAssetId),
        ...(events.data ?? []).map((e) => e.fixedAssetId)
      ].filter((assetId): assetId is string => Boolean(assetId))
    )
  ];
  const [invoiceLines, assets] = await Promise.all([
    invoiceLineIds.length > 0
      ? client
          .from("purchaseInvoiceLine")
          .select("id, invoiceId")
          .eq("companyId", companyId)
          .in("id", invoiceLineIds)
      : Promise.resolve({ data: [], error: null }),
    fixedAssetIds.length > 0
      ? client
          .from("fixedAsset")
          .select("id, fixedAssetId, name")
          .eq("companyId", companyId)
          .in("id", fixedAssetIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  const invoiceById = new Map(
    purchaseInvoices.map((invoice) => [invoice.id, invoice])
  );
  const paymentInvoices: LeasePaymentInvoiceLinks = {};
  for (const line of invoiceLines.data ?? []) {
    const invoice = invoiceById.get(line.invoiceId);
    paymentInvoices[line.id] = {
      id: line.invoiceId,
      invoiceId: invoice?.invoiceId ?? null,
      status: invoice?.status ?? null
    };
  }

  const fixedAssets: LeaseFixedAssets = {};
  for (const asset of assets.data ?? []) {
    fixedAssets[asset.id] = {
      id: asset.id,
      fixedAssetId: asset.fixedAssetId,
      name: asset.name
    };
  }

  return {
    lease: lease.data,
    lines: lines.data ?? [],
    payments: payments.data ?? [],
    schedule: schedule.data ?? [],
    events: events.data ?? [],
    purchaseInvoices,
    journals,
    paymentInvoices,
    fixedAssets,
    leasePolicy: {
      majorPartPercent: Number(
        settings.data?.leaseMajorPartThresholdPercent ?? 75
      ),
      substantiallyAllPercent: Number(
        settings.data?.leaseSubstantiallyAllThresholdPercent ?? 90
      ),
      shortTermExpedient: settings.data?.leaseShortTermExpedient ?? true,
      accountingCutoverDate,
      openingAsOf
    }
  };
}

export default function LeaseShellRoute() {
  const {
    lease,
    lines,
    payments,
    schedule,
    leasePolicy,
    purchaseInvoices,
    journals
  } = useLoaderData<typeof loader>();
  const { id } = useParams();
  const matches = useMatches();
  if (!id) throw new Error("Could not find id");

  // The setup wizard (`$id.setup`) is a child of this route so it reads the
  // same loader, but it takes the whole page rather than the workspace.
  if (matches.some((match) => match.id.endsWith("$id.setup"))) {
    return <RecordOutlet />;
  }

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <LeaseHeader
          lease={lease}
          lines={lines}
          payments={payments}
          schedule={schedule}
          leasePolicy={leasePolicy}
          purchaseInvoices={purchaseInvoices}
          journals={journals}
        />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<LeaseExplorer key={id} />}
              content={
                <div className="bg-muted dark:bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<LeaseProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
