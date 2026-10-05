// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  finalizeSupplierQuote,
  getSupplierQuote,
  getSupplierQuoteLinePricesByQuoteId,
  getSupplierQuoteLines
} from "~/modules/purchasing";
import { checkPartyContactRequirement } from "~/modules/settings/party-contact.server";
import { upsertExternalLink } from "~/modules/shared";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find supplier quote id");

  // bypassRls hands back the service role and every read/write below is keyed
  // on the URL's id.
  await requireCompanyRecord(client, "supplierQuote", companyId, { id });

  const quote = await getSupplierQuote(client, id);
  if (quote.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(quote.error, "Failed to get supplier quote"))
    );
  }

  // A supplier with no reachable contact cannot be created as a vendor/customer at
  // a connected platform, so its documents are rejected there long after anyone
  // is watching. Gate at issue time, where the record can still be fixed. No-op
  // unless the company has turned the setting on.
  const supplierContactError = await checkPartyContactRequirement(
    client,
    companyId,
    { kind: "supplier", id: quote.data.supplierId }
  );
  if (supplierContactError) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(null, supplierContactError))
    );
  }

  // Reuse existing external link or create one if it doesn't exist
  const externalLink = await upsertExternalLink(client, {
    id: quote.data.externalLinkId ?? undefined,
    documentType: "SupplierQuote",
    documentId: id,
    supplierId: quote.data.supplierId,
    expiresAt: quote.data.expirationDate,
    companyId
  });

  if (externalLink.data && quote.data.externalLinkId !== externalLink.data.id) {
    await client
      .from("supplierQuote")
      .update({
        externalLinkId: externalLink.data.id,
        status: "Active"
      })
      .eq("id", id);
  }

  // Validate that all quantities have price and lead time
  const [quoteLines, quoteLinePrices] = await Promise.all([
    getSupplierQuoteLines(client, id),
    getSupplierQuoteLinePricesByQuoteId(client, id)
  ]);

  if (quoteLines.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(
        request,
        error(quoteLines.error, "Failed to get supplier quote lines")
      )
    );
  }

  if (quoteLinePrices.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(
        request,
        error(quoteLinePrices.error, "Failed to get supplier quote line prices")
      )
    );
  }

  // Check that each line has at least one quantity with price and lead time
  // (not all quantities need them, just at least one per line)
  const lines = quoteLines.data ?? [];
  const prices = quoteLinePrices.data ?? [];

  for (const line of lines) {
    if (!line.id) continue;
    const linePrices = prices.filter((p) => p.supplierQuoteLineId === line.id);

    // Check if at least one quantity has both valid price and lead time
    const hasValidPriceAndLeadTime = linePrices.some(
      (price) =>
        price.supplierUnitPrice !== null &&
        price.supplierUnitPrice !== 0 &&
        price.leadTime !== null &&
        price.leadTime !== 0
    );

    if (!hasValidPriceAndLeadTime) {
      throw redirect(
        path.to.supplierQuote(id),
        await flash(
          request,
          error(
            null,
            `Line ${line.itemReadableId} must have at least one quantity with price and lead time`
          )
        )
      );
    }
  }

  // TODO: Add PDF generation for supplier quotes when available
  // TODO: Add document creation for supplier quotes when PDF is available

  const finalize = await finalizeSupplierQuote(client, getDatabaseClient(), {
    supplierQuoteId: id,
    companyId,
    userId
  });
  if (finalize.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(
        request,
        error(
          finalize.error,
          finalize.error.message || "Failed to finalize supplier quote"
        )
      )
    );
  }

  throw redirect(
    path.to.supplierQuote(id),
    await flash(request, success("Supplier quote finalized successfully"))
  );
}
