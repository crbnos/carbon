// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { finalizeSupplierQuote, getSupplierQuote } from "~/modules/purchasing";
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
      .update({ externalLinkId: externalLink.data.id })
      .eq("id", id);
  }

  // The function checks that every line is priced, marks the quote Active and
  // writes the supplier's price list, in one transaction.
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
