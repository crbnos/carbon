// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { DocumentEdit, ValueCollector } from "@carbon/documents/template";
import {
  loadPackingSlipDocument,
  renderPackingSlipPdf
} from "@carbon/lib/packing-slip-document.server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A shipment's packing slip (a rental's delivery ticket) as a PDF response.
 * `client` reads as the caller; the source document's customer, terms and
 * tracking are read with `serviceRole`, pinned to `companyId`.
 */
export async function renderPackingSlip({
  client,
  serviceRole,
  companyId,
  shipmentId,
  locale,
  edit,
  valueCollector
}: {
  client: SupabaseClient<Database>;
  serviceRole: SupabaseClient<Database>;
  companyId: string;
  shipmentId: string;
  locale: string;
  /** Draft edits to preview; omitted, the saved ones are read. */
  edit?: DocumentEdit | null;
  valueCollector?: ValueCollector;
}): Promise<Response> {
  const { pdfProps, fileName } = await loadPackingSlipDocument({
    client,
    serviceRole,
    companyId,
    shipmentId,
    locale,
    storageUrl: SUPABASE_URL ?? "",
    edit
  });
  const body = await renderPackingSlipPdf({ ...pdfProps, valueCollector });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`
    })
  });
}
