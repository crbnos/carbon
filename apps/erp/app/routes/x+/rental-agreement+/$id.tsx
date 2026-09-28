import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import {
  getRentableFleetAssets,
  getRentalAgreement,
  getRentalAgreementCharges,
  getRentalAgreementDeposits,
  getRentalAgreementLines,
  getRentalBillingPeriods
} from "~/modules/sales";
import type {
  RentalInvoiceLinks,
  RentalLeaseLineInputs
} from "~/modules/sales/ui/Rentals";
import {
  RentalAgreementExplorer,
  RentalAgreementHeader
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

  const rentalAgreement = await getRentalAgreement(client, id);
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

  const [lines, charges, periods, deposits, rentableAssets] = await Promise.all(
    [
      getRentalAgreementLines(client, id),
      getRentalAgreementCharges(client, id),
      getRentalBillingPeriods(client, id),
      getRentalAgreementDeposits(client, id),
      rentalAgreement.data.status === "Draft"
        ? getRentableFleetAssets(client, companyId)
        : Promise.resolve({ data: [], error: null })
    ]
  );

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
          .select("id, salesInvoice(id, invoiceId)")
          .eq("companyId", companyId)
          .in("id", invoiceLineIds)
      : null;

  // Lease classification (spec §4): the company's thresholds, and — while the
  // agreement is Draft — what activation will price each line at (the item's
  // current ladder) and derecognize it at (the fleet unit's net book value),
  // so the Activate confirmation can preview the commencement journal. One
  // query per table over the collected ids.
  const isDraft = rentalAgreement.data.status === "Draft";
  const draftLines = isDraft ? (lines.data ?? []) : [];
  const itemIds = [...new Set(draftLines.map((line) => line.itemId))];
  const assetIds = [
    ...new Set(
      draftLines
        .map((line) => line.fixedAssetId)
        .filter((assetId): assetId is string => Boolean(assetId))
    )
  ];
  const [settings, ladders, assets] = await Promise.all([
    client
      .from("companySettings")
      .select(
        "leaseMajorPartThresholdPercent, leaseSubstantiallyAllThresholdPercent"
      )
      .eq("id", companyId)
      .maybeSingle(),
    itemIds.length > 0 && rentalAgreement.data.currencyCode
      ? client
          .from("itemRentalRate")
          .select("itemId, dayRate, weekRate, monthRate")
          .eq("companyId", companyId)
          .eq("currencyCode", rentalAgreement.data.currencyCode)
          .in("itemId", itemIds)
      : Promise.resolve({ data: [], error: null }),
    assetIds.length > 0
      ? client
          .from("fixedAsset")
          .select("id, acquisitionCost, accumulatedDepreciation")
          .eq("companyId", companyId)
          .in("id", assetIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  const ladderByItem = new Map(
    (ladders.data ?? []).map((ladder) => [ladder.itemId, ladder])
  );
  const assetById = new Map(
    (assets.data ?? []).map((asset) => [asset.id, asset])
  );
  const leaseInputs: Record<string, RentalLeaseLineInputs> = {};
  for (const line of draftLines) {
    const ladder = ladderByItem.get(line.itemId);
    const asset = line.fixedAssetId ? assetById.get(line.fixedAssetId) : null;
    leaseInputs[line.id] = {
      ladder: ladder
        ? {
            dayRate: ladder.dayRate,
            weekRate: ladder.weekRate,
            monthRate: ladder.monthRate
          }
        : null,
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
        invoiceId: line.salesInvoice.invoiceId
      };
    }
  }

  return {
    rentalAgreement: rentalAgreement.data,
    lines: lines.data ?? [],
    charges: charges.data ?? [],
    periods: periods.data ?? [],
    deposits: deposits.data ?? [],
    rentableAssets: rentableAssets.data ?? [],
    invoiceLinks,
    leasePolicy: {
      majorPartPercent: settings.data?.leaseMajorPartThresholdPercent ?? 75,
      substantiallyAllPercent:
        settings.data?.leaseSubstantiallyAllThresholdPercent ?? 90
    },
    leaseInputs
  };
}

export default function RentalAgreementRoute() {
  const { rentalAgreement, lines, periods, leasePolicy, leaseInputs } =
    useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <RentalAgreementHeader
          rentalAgreement={rentalAgreement}
          lines={lines}
          periods={periods}
          leasePolicy={leasePolicy}
          leaseInputs={leaseInputs}
        />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<RentalAgreementExplorer key={id} />}
              content={
                <div className="bg-muted dark:bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={4} className="p-4">
                    <Outlet />
                  </VStack>
                </div>
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
