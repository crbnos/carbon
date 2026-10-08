// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useMatches, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import {
  getRentableFleetAssets,
  getRentalAgreement,
  getRentalAgreementCharges,
  getRentalAgreementDeposits,
  getRentalAgreementLines,
  getRentalAgreementRelatedDocuments,
  getRentalBillingPeriods
} from "~/modules/sales";
import type {
  RentalInvoiceLinks,
  RentalLeaseLineInputs
} from "~/modules/sales/ui/Rentals";
import {
  RentalAgreementExplorer,
  RentalAgreementHeader,
  RentalAgreementProperties
} from "~/modules/sales/ui/Rentals";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Rental Agreements`, to: path.to.rentalAgreements },
    (data) => data?.rentalAgreement?.rentalAgreementId
  ),
  module: "sales"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const rentalAgreement = await getRentalAgreement(client, id, companyId);
  if (rentalAgreement.error || !rentalAgreement.data) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(
        request,
        error(rentalAgreement.error, "Failed to load rental agreement")
      )
    );
  }
  if (rentalAgreement.data.companyId !== companyId) {
    throw redirect(path.to.rentalAgreements);
  }

  const customerContactId = rentalAgreement.data.customerContactId;
  const [lines, charges, periods, deposits, rentableAssets, contact, related] =
    await Promise.all([
      getRentalAgreementLines(client, id, companyId),
      getRentalAgreementCharges(client, id, companyId),
      getRentalBillingPeriods(client, id, companyId),
      getRentalAgreementDeposits(client, id, companyId),
      rentalAgreement.data.status === "Draft"
        ? getRentableFleetAssets(client, companyId)
        : Promise.resolve({ data: [], error: null }),
      // Whether invoices can be emailed: the contact's email.
      customerContactId
        ? client
            .from("customerContact")
            .select("contact(email)")
            .eq("id", customerContactId)
            .eq("companyId", companyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      getRentalAgreementRelatedDocuments(client, id, companyId)
    ]);

  // `salesInvoiceLineId` on periods and charges has no foreign key, so the
  // invoice behind each billed row is read in one batch rather than embedded.
  const invoiceLineIds = [
    ...new Set(
      [...(periods.data ?? []), ...(charges.data ?? [])]
        .map((row) => row.salesInvoiceLineId)
        .filter((lineId): lineId is string => Boolean(lineId))
    )
  ];
  const invoiceLines =
    invoiceLineIds.length > 0
      ? await client
          .from("salesInvoiceLine")
          .select(
            "id, salesInvoice!salesInvoiceLine_invoiceId_fkey(id, invoiceId, status, automationHoldReason)"
          )
          .eq("companyId", companyId)
          .in("id", invoiceLineIds)
      : null;

  // Lease classification (spec §4): the company's thresholds, and — while the
  // agreement is Draft — what activation will derecognize each line at (the
  // fleet unit's net book value), so the Activate confirmation can preview
  // the commencement journal. Each line is priced at its own rate.
  const isDraft = rentalAgreement.data.status === "Draft";
  const draftLines = isDraft ? (lines.data ?? []) : [];
  const assetIds = [
    ...new Set(
      draftLines
        .map((line) => line.fixedAssetId)
        .filter((assetId): assetId is string => Boolean(assetId))
    )
  ];
  const [settings, assets] = await Promise.all([
    client
      .from("companySettings")
      .select(
        "leaseMajorPartThresholdPercent, leaseSubstantiallyAllThresholdPercent"
      )
      .eq("id", companyId)
      .maybeSingle(),
    assetIds.length > 0
      ? client
          .from("fixedAsset")
          .select("id, acquisitionCost, accumulatedDepreciation")
          .eq("companyId", companyId)
          .in("id", assetIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  const assetById = new Map(
    (assets.data ?? []).map((asset) => [asset.id, asset])
  );
  const leaseInputs: Record<string, RentalLeaseLineInputs> = {};
  for (const line of draftLines) {
    const asset = line.fixedAssetId ? assetById.get(line.fixedAssetId) : null;
    leaseInputs[line.id] = {
      carryingAmount: asset
        ? (asset.acquisitionCost ?? 0) - (asset.accumulatedDepreciation ?? 0)
        : null,
      acquisitionCost: asset?.acquisitionCost ?? null,
      accumulatedDepreciation: asset?.accumulatedDepreciation ?? null
    };
  }

  const invoiceLinks: RentalInvoiceLinks = {};
  for (const line of invoiceLines?.data ?? []) {
    if (line.salesInvoice?.id) {
      invoiceLinks[line.id] = {
        id: line.salesInvoice.id,
        invoiceId: line.salesInvoice.invoiceId,
        status: line.salesInvoice.status,
        automationHoldReason: line.salesInvoice.automationHoldReason
      };
    }
  }

  return {
    rentalAgreement: rentalAgreement.data,
    lines: lines.data ?? [],
    charges: charges.data ?? [],
    periods: periods.data ?? [],
    deposits: deposits.data ?? [],
    // A failed read leaves the lists empty rather than failing the page.
    shipments: related.error ? [] : related.data.shipments,
    receipts: related.error ? [] : related.data.receipts,
    rentableAssets: rentableAssets.data ?? [],
    invoiceLinks,
    contactEmail: contact.data?.contact?.email || null,
    leasePolicy: {
      majorPartPercent: settings.data?.leaseMajorPartThresholdPercent ?? 75,
      substantiallyAllPercent:
        settings.data?.leaseSubstantiallyAllThresholdPercent ?? 90
    },
    leaseInputs
  };
}

export default function RentalAgreementRoute() {
  const {
    rentalAgreement,
    lines,
    periods,
    leasePolicy,
    leaseInputs,
    shipments,
    receipts
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
        <RentalAgreementHeader
          rentalAgreement={rentalAgreement}
          lines={lines}
          periods={periods}
          leasePolicy={leasePolicy}
          leaseInputs={leaseInputs}
          shipments={shipments}
          receipts={receipts}
        />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<RentalAgreementExplorer key={id} />}
              content={
                <div className="bg-muted dark:bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <RecordOutlet />
                  </VStack>
                </div>
              }
              properties={<RentalAgreementProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
